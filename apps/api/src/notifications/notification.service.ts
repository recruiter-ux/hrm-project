import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel, NotificationDeliveryStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  renderNotificationEmail,
  type EmailDetailRow,
  type StatusTone,
} from './email/email-templates';
import { EmailService } from './email/email.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';

/** Prisma's "unique constraint failed" code — how a duplicate is detected. */
const PG_UNIQUE_VIOLATION = 'P2002';

export interface NotifyEmailInput {
  subject: string;
  heading: string;
  intro: string;
  status?: { label: string; tone: StatusTone };
  details: EmailDetailRow[];
  quote?: { label: string; text: string };
  ctaLabel: string;
}

export interface NotifyInput {
  recipientId: string;
  /** Module-namespaced event key, e.g. `leave.request.submitted`. */
  type: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  /** Path inside the web app, e.g. `/leave/approvals`. The deep link. */
  link?: string;
  /**
   * Stable, derived from the EVENT rather than the clock. Two calls carrying
   * the same key produce one notification. Omit only for something genuinely
   * repeatable, like a daily digest.
   */
  dedupeKey?: string;
  /** Omit for in-app only. Provide to also queue an email. */
  email?: NotifyEmailInput;
}

export interface NotifyResult {
  notificationId: string | null;
  /** True when the dedupe key had already been used — nothing was created. */
  duplicate: boolean;
  emailQueued: boolean;
}

/**
 * =============================================================================
 * NOTIFICATIONS — the reusable service every module calls
 *
 * Usage from anywhere:
 *
 *   await this.notifications.notify({
 *     recipientId: managerId,
 *     type: 'leave.request.submitted',
 *     title: 'Zara Ahmed requested Annual Leave',
 *     body: '3 days, 9–11 November 2026. Waiting for your decision.',
 *     entityType: 'leave_request',
 *     entityId: request.id,
 *     link: '/leave/approvals',
 *     dedupeKey: `leave_request:${request.id}:submitted:${managerId}`,
 *     email: { ... },
 *   });
 *
 * THREE RULES THIS SERVICE ENFORCES, SO CALLERS DO NOT HAVE TO:
 *
 * 1. IT NEVER THROWS AT THE CALLER. Notifying is a side effect of a business
 *    event, never a precondition for it. If the notification write fails, the
 *    leave request is still approved and the failure is logged. `notify()`
 *    returns a result object rather than raising.
 *
 * 2. IT IS IDEMPOTENT. `dedupeKey` is unique in the database, so a retried
 *    API call, a double-clicked button, or a replayed job produces exactly one
 *    notification and one email — enforced by Postgres, not by a check that
 *    could race.
 *
 * 3. EMAIL IS QUEUED, NEVER SENT INLINE. A NotificationDelivery row is written
 *    as PENDING and a background dispatcher sends it. Nothing in a request
 *    handler waits on a mail server.
 * =============================================================================
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly config: ConfigService,
  ) {}

  private get webUrl(): string {
    return this.config.get<string>('app.webUrl', 'http://localhost:3000');
  }

  /**
   * Raise one notification.
   *
   * ⚠️ CALL THIS AFTER YOUR TRANSACTION COMMITS, never inside it. Two reasons:
   * a notification about a change that then rolls back is a lie, and holding a
   * database transaction open across a side effect is how deadlocks start.
   */
  async notify(input: NotifyInput): Promise<NotifyResult> {
    const failed: NotifyResult = { notificationId: null, duplicate: false, emailQueued: false };

    try {
      const recipient = await this.prisma.employee.findFirst({
        where: { id: input.recipientId, deletedAt: null },
        select: { id: true, firstName: true, preferredName: true, workEmail: true },
      });

      if (!recipient) {
        this.logger.warn(
          `Notification ${input.type} not raised: employee ${input.recipientId} does not exist or is archived.`,
        );
        return failed;
      }

      // Work out the email side BEFORE opening the transaction, so nothing
      // slow or fallible happens while a write lock is held.
      let deliveryData: {
        channel: NotificationChannel;
        status: NotificationDeliveryStatus;
        toAddress: string | null;
        subject: string;
        bodyHtml: string;
        bodyText: string;
        lastError: string | null;
        nextAttemptAt: Date | null;
      } | null = null;

      if (input.email) {
        const rendered = renderNotificationEmail({
          ...input.email,
          recipientName: recipient.preferredName ?? recipient.firstName,
          ctaUrl: `${this.webUrl}${input.link ?? '/'}`,
        });

        // SKIPPED, not FAILED and never SENT: "we did not try" must stay
        // distinguishable from "we tried and it bounced".
        const skipReason = !recipient.workEmail
          ? 'Recipient has no work email address on file.'
          : !this.email.isConfigured
            ? this.email.notConfiguredReason
            : null;

        deliveryData = {
          channel: NotificationChannel.EMAIL,
          status: skipReason
            ? NotificationDeliveryStatus.SKIPPED
            : NotificationDeliveryStatus.PENDING,
          toAddress: recipient.workEmail,
          subject: rendered.subject,
          bodyHtml: rendered.html,
          bodyText: rendered.text,
          lastError: skipReason,
          nextAttemptAt: skipReason ? null : new Date(),
        };
      }

      const notification = await this.prisma.$transaction(async (tx) => {
        const created = await tx.notification.create({
          data: {
            recipientId: recipient.id,
            type: input.type,
            title: input.title,
            body: input.body,
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
            link: input.link ?? null,
            dedupeKey: input.dedupeKey ?? null,
          },
        });

        if (deliveryData) {
          await tx.notificationDelivery.create({
            data: { notificationId: created.id, ...deliveryData },
          });
        }

        return created;
      });

      const emailQueued = deliveryData?.status === NotificationDeliveryStatus.PENDING;

      // Nudge the dispatcher so the email leaves now rather than on the next
      // poll. Deliberately NOT awaited — the caller is finishing an HTTP
      // request and must not wait on a mail server.
      if (emailQueued) this.dispatcher.kick();

      return { notificationId: notification.id, duplicate: false, emailQueued };
    } catch (error) {
      // The dedupe key was already used. This is the idempotency guard doing
      // its job, so it is an ordinary outcome and not an error.
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        this.logger.debug(`Duplicate notification suppressed: ${input.dedupeKey}`);
        return { notificationId: null, duplicate: true, emailQueued: false };
      }

      this.logger.error(
        `Could not raise notification ${input.type} for ${input.recipientId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return failed;
    }
  }

  /** Several recipients, same event. Failures are isolated per recipient. */
  async notifyMany(inputs: NotifyInput[]): Promise<NotifyResult[]> {
    return Promise.all(inputs.map((input) => this.notify(input)));
  }

  // ---------------------------------------------------------------------------
  // Reading — always and only the caller's own notifications
  //
  // There is no `recipientId` parameter anywhere below on purpose. A caller
  // cannot ask for someone else's notifications because there is no way to
  // express the request, which is a stronger guarantee than a permission check
  // that someone could forget to add.
  // ---------------------------------------------------------------------------

  async list(employeeId: string, options: { unreadOnly?: boolean; take?: number } = {}) {
    const take = Math.min(options.take ?? 30, 100);

    const [items, unreadCount, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: employeeId, ...(options.unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.notification.count({ where: { recipientId: employeeId, readAt: null } }),
      this.prisma.notification.count({ where: { recipientId: employeeId } }),
    ]);

    return { items, unreadCount, total };
  }

  async unreadCount(employeeId: string): Promise<{ unreadCount: number }> {
    const unreadCount = await this.prisma.notification.count({
      where: { recipientId: employeeId, readAt: null },
    });
    return { unreadCount };
  }

  /**
   * Marks one as read.
   *
   * The `recipientId` in the WHERE clause is the authorisation check: marking
   * somebody else's notification read updates zero rows and 404s, rather than
   * succeeding silently.
   */
  async markRead(employeeId: string, notificationId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: employeeId, readAt: null },
      data: { readAt: new Date() },
    });

    if (result.count === 0) {
      const exists = await this.prisma.notification.findFirst({
        where: { id: notificationId, recipientId: employeeId },
        select: { id: true },
      });
      // Already read is not an error; belonging to someone else is.
      if (!exists) throw new NotFoundException('Notification not found.');
    }

    return this.unreadCount(employeeId);
  }

  async markAllRead(employeeId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId: employeeId, readAt: null },
      data: { readAt: new Date() },
    });
    return { markedRead: result.count, unreadCount: 0 };
  }

  /**
   * Delivery rows for one notification — the answer to "was the email
   * actually sent?". Scoped to the caller's own notifications.
   */
  async deliveries(employeeId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, recipientId: employeeId },
      select: { id: true },
    });
    if (!notification) throw new NotFoundException('Notification not found.');

    return this.prisma.notificationDelivery.findMany({
      where: { notificationId },
      select: {
        channel: true,
        status: true,
        attempts: true,
        lastError: true,
        sentAt: true,
        nextAttemptAt: true,
      },
    });
  }
}
