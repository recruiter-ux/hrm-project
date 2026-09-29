import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  /** Who pressed the button. Null for something the system did on its own. */
  actorId: string | null;
  /** Module-namespaced and past tense: `leave_request.approved`. */
  action: string;
  entityType: string;
  entityId: string;
  /** A readable one-liner, written now, in the words that were true now. */
  summary: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/**
 * The general "who changed what" log.
 *
 * ⚠️ RECORDING AN AUDIT ENTRY MUST NEVER BREAK THE THING BEING AUDITED.
 * Every write is wrapped: if the log insert fails, the failure is logged to the
 * console and the business operation carries on. An HR platform that refuses to
 * approve leave because its audit table is full would be worse than one with a
 * gap in the log.
 *
 * That is also why `record()` is called AFTER the business transaction commits
 * rather than inside it. The alternative — enrolling the audit write in the
 * same transaction — would let a logging bug roll back a leave approval.
 *
 * REUSE THIS. Every module writes here. Do not add a per-module history table
 * for "who did it"; effective-dated tables (EmploymentAssignment,
 * LeaveTypePolicy) answer a different question — see the schema comment.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          summary: entry.summary,
          before: entry.before ?? undefined,
          after: entry.after ?? undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not write audit entry ${entry.action} for ${entry.entityType}:${entry.entityId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Everything that has happened to one record, newest first. */
  async listForEntity(entityType: string, entityId: string, take = 50) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { actor: { select: { id: true, firstName: true, lastName: true } } },
    });
  }
}
