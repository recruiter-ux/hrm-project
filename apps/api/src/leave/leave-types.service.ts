import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { CreateLeaveTypeDto, UpdateLeaveTypeDto } from './dto/leave.dto';

/**
 * Reference data for leave. Small, admin-editable, and read by everyone.
 */
@Injectable()
export class LeaveTypesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Decimal → number, so the API speaks plain JSON. */
  private shape<T extends { defaultAnnualDays: unknown }>(type: T) {
    return {
      ...type,
      defaultAnnualDays: Number(type.defaultAnnualDays),
    };
  }

  async findAll(includeInactive = false) {
    const types = await this.prisma.leaveType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return types.map((t) => this.shape(t));
  }

  async create(dto: CreateLeaveTypeDto) {
    const existing = await this.prisma.leaveType.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException(`A leave type with code ${dto.code} already exists.`);

    const created = await this.prisma.leaveType.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        isPaid: dto.isPaid ?? true,
        requiresBalance: dto.requiresBalance ?? true,
        defaultAnnualDays: dto.defaultAnnualDays ?? 0,
      },
    });
    return this.shape(created);
  }

  async update(id: string, dto: UpdateLeaveTypeDto) {
    const existing = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Leave type not found.');

    const updated = await this.prisma.leaveType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isPaid !== undefined && { isPaid: dto.isPaid }),
        ...(dto.requiresBalance !== undefined && { requiresBalance: dto.requiresBalance }),
        ...(dto.defaultAnnualDays !== undefined && { defaultAnnualDays: dto.defaultAnnualDays }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    return this.shape(updated);
  }

  /**
   * Retires a type rather than deleting it.
   *
   * Historical requests reference it and must still resolve its name, so there
   * is deliberately no hard delete — the foreign key uses `onDelete: Restrict`
   * to make that impossible by accident.
   */
  async deactivate(id: string) {
    const existing = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Leave type not found.');
    if (!existing.isActive) throw new BadRequestException('That leave type is already retired.');

    const updated = await this.prisma.leaveType.update({
      where: { id },
      data: { isActive: false },
    });
    return this.shape(updated);
  }
}
