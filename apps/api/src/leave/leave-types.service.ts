import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProrationMethod } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { CreateLeaveTypeDto, UpdateLeaveTypeDto } from './dto/leave.dto';
import { LeavePolicyService } from './leave-policy.service';
import { toDateOnly } from './working-days';

/**
 * Leave types — the IDENTITY of a kind of leave.
 *
 * All the rules (quota, notice, approval) live on LeaveTypePolicy. Creating a
 * type therefore also creates its first policy version, in one transaction: a
 * type with no policy would have no quota and no rules, which is not a state
 * worth allowing to exist.
 */
@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: LeavePolicyService,
  ) {}

  /**
   * Types with their CURRENT policy attached.
   *
   * The current policy is resolved per type rather than stored on the type,
   * which is what lets a quota change take effect on its date without anyone
   * editing the type row.
   */
  async findAll(includeInactive = false) {
    const types = await this.prisma.leaveType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return Promise.all(
      types.map(async (type) => {
        const current = await this.policies.getCurrentPolicy(type.id);
        const versionCount = await this.prisma.leaveTypePolicy.count({
          where: { leaveTypeId: type.id },
        });
        return {
          ...type,
          currentPolicy: current ? this.policies.shape(current) : null,
          versionCount,
        };
      }),
    );
  }

  async findOne(id: string) {
    const type = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!type) throw new NotFoundException('Leave type not found.');

    const [current, versions, usage] = await Promise.all([
      this.policies.getCurrentPolicy(id),
      this.policies.listVersions(id),
      this.getUsage(id),
    ]);

    return {
      ...type,
      currentPolicy: current ? this.policies.shape(current) : null,
      versions,
      usage,
    };
  }

  /** How many records depend on this type — drives whether it can be retired. */
  private async getUsage(leaveTypeId: string) {
    const [requests, balances] = await Promise.all([
      this.prisma.leaveRequest.count({ where: { leaveTypeId } }),
      this.prisma.leaveBalance.count({ where: { leaveTypeId } }),
    ]);
    return { requests, balances };
  }

  /**
   * Creates a leave type AND its opening policy version, together.
   *
   * Both or neither — a type with no policy has no quota, no notice period,
   * and no approval rule, so it could not be requested against.
   */
  async create(dto: CreateLeaveTypeDto, actorEmployeeId: string | null) {
    const existing = await this.prisma.leaveType.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException(`A leave type with code ${dto.code} already exists.`);

    const effectiveFrom = toDateOnly(
      dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const type = await tx.leaveType.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          isPaid: dto.isPaid ?? true,
          requiresBalance: dto.requiresBalance ?? true,
          prorationMethod: dto.prorationMethod ?? ProrationMethod.PRORATED_BY_DAYS,
        },
      });

      await tx.leaveTypePolicy.create({
        data: {
          leaveTypeId: type.id,
          quotaDays: dto.quotaDays,
          approvalRequired: dto.approvalRequired ?? true,
          carryForwardEnabled: dto.carryForwardEnabled ?? false,
          carryForwardMaxDays: dto.carryForwardMaxDays ?? null,
          minNoticeDays: dto.minNoticeDays ?? 0,
          effectiveFrom,
          effectiveTo: null,
          notes: dto.policyNotes ?? 'Initial policy.',
          createdById: actorEmployeeId,
          updatedById: actorEmployeeId,
        },
      });

      return type;
    });

    return this.findOne(created.id);
  }

  /**
   * Edits the type's IDENTITY only — name, description, paid flag, proration
   * method, active flag.
   *
   * Quota, notice period, and the approval rule are NOT here: changing those
   * means creating a new policy version, so history survives.
   */
  async update(id: string, dto: UpdateLeaveTypeDto) {
    const existing = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Leave type not found.');

    await this.prisma.leaveType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isPaid !== undefined && { isPaid: dto.isPaid }),
        ...(dto.requiresBalance !== undefined && { requiresBalance: dto.requiresBalance }),
        ...(dto.prorationMethod !== undefined && { prorationMethod: dto.prorationMethod }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    return this.findOne(id);
  }

  /**
   * Archives a type. There is no hard delete.
   *
   * Historical requests and balances reference it and must keep resolving its
   * name; the foreign keys use `onDelete: Restrict` so the database refuses a
   * delete even if someone tried. Archiving hides it from the request form
   * while leaving every historical record intact and readable.
   */
  async archive(id: string) {
    const existing = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Leave type not found.');
    if (!existing.isActive) throw new BadRequestException('That leave type is already archived.');

    await this.prisma.leaveType.update({ where: { id }, data: { isActive: false } });
    return this.findOne(id);
  }

  async restore(id: string) {
    const existing = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Leave type not found.');

    await this.prisma.leaveType.update({ where: { id }, data: { isActive: true } });
    return this.findOne(id);
  }
}
