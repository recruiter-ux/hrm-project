import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationDeliveryStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { EmailSendError, EmailService } from './email/email.service';

export interface DrainResult {
  attempted: number;
  sent: number;
  retrying: number;
  failed: number;
}

/**
 * =============================================================================
 * THE OUTBOX DISPATCHER
 *
 * Picks up PENDING NotificationDelivery rows and sends them. Runs on a plain
 * interval inside the API process.
 *
 * WHY NOT A PROPER JOB QUEUE (BullMQ / Redis)?
 * There is no queue infrastructure in this project yet — Redis is running but
 * nothing uses it. A database-backed outbox needs no new moving parts, and it
 * already gives the three things that matter:
 *
 *   durability  the intent to send is a committed table row, so a restart
 *               mid-send loses nothing
 *   retries     attempts and nextAttemptAt live on the row
 *   visibility  "was this email sent?" is a SELECT, not a hunt through logs
 *
 * What it does not give is throughput or cross-process coordination. At Hazel
 * Mobile's size — tens of emails a day — that is not a real constraint. When
 * it becomes one, or when the API runs as more than one instance, swap this
 * class for a BullMQ worker: the delivery table stays exactly as it is, and
 * nothing else in the codebase changes.
 *
 * ⚠️ RUNNING MORE THAN ONE API INSTANCE TODAY COULD SEND AN EMAIL TWICE, as
 * both would claim the same row. The claim below is a single conditional
 * UPDATE, which narrows the window a great deal but does not close it. Noted
 * in PROJECT_NOTES §12 as the trigger for moving to a real queue.
 * =============================================================================
 */
@Injectable()
export class NotificationDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Stops a slow drain from overlapping the next tick. */
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private get intervalMs(): number {
    return this.config.get<number>('notifications.dispatchIntervalMs', 15_000);
  }

  private get maxAttempts(): number {
    return this.config.get<number>('notifications.maxAttempts', 5);
  }

  private get batchSize(): number {
    return this.config.get<number>('notifications.batchSize', 25);
  }

  onModuleInit(): void {
    // 0 disables the timer. Tests set it to 0 and call drain() directly, so a
    // test never races a background tick.
    if (this.intervalMs <= 0) {
      this.logger.log('Dispatcher timer disabled (notifications.dispatchIntervalMs = 0).');
      return;
    }

    this.timer = setInterval(() => void this.drain(), this.intervalMs);
    // Do not hold the process open just for this timer.
    this.timer.unref?.();
    this.logger.log(`Notification dispatcher polling every ${this.intervalMs}ms.`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Called right after queuing, so an email goes out now rather than on the
   * next poll.
   *
   * Does nothing when the background timer is switched off. "Disabled" has to
   * mean disabled: a kick that still fired would make the automated tests
   * race — one would assert a delivery is still PENDING while a background
   * drain was halfway through sending it — and would produce failures that
   * come and go depending on machine speed.
   */
  kick(): void {
    if (this.intervalMs <= 0) return;
    void this.drain();
  }

  /**
   * Sends everything due. Safe to call at any time; overlapping calls return
   * immediately rather than double-sending.
   */
  async drain(): Promise<DrainResult> {
    const result: DrainResult = { attempted: 0, sent: 0, retrying: 0, failed: 0 };
    if (this.draining) return result;
    this.draining = true;

    try {
      const now = new Date();
      const due = await this.prisma.notificationDelivery.findMany({
        where: {
          status: NotificationDeliveryStatus.PENDING,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: this.batchSize,
      });

      for (const delivery of due) {
        // ⚠️ ONE BAD ROW MUST NOT ABANDON THE REST OF THE BATCH. Everything
        // per-delivery is wrapped, so a notification whose recipient was
        // deleted a moment ago does not stop the other twenty emails going
        // out. Learned the hard way: an unguarded `update` on a
        // since-deleted row threw and took the whole drain down with it.
        try {
          // Claim it: only the writer that flips attempts from N to N+1
          // proceeds. A second process reading the same row updates 0 rows and
          // skips it.
          const claim = await this.prisma.notificationDelivery.updateMany({
            where: {
              id: delivery.id,
              status: NotificationDeliveryStatus.PENDING,
              attempts: delivery.attempts,
            },
            data: { attempts: delivery.attempts + 1 },
          });
          if (claim.count === 0) continue;

          result.attempted += 1;
          const attemptNumber = delivery.attempts + 1;

          try {
            if (!delivery.toAddress) {
              throw new EmailSendError('No recipient address on the delivery row.', false);
            }

            await this.email.send({
              to: delivery.toAddress,
              subject: delivery.subject ?? '(no subject)',
              html: delivery.bodyHtml ?? '',
              text: delivery.bodyText ?? '',
            });

            // updateMany, not update: the row can legitimately have vanished
            // (the employee was archived, cascading the notification away)
            // and that is not worth throwing over.
            await this.prisma.notificationDelivery.updateMany({
              where: { id: delivery.id },
              data: {
                status: NotificationDeliveryStatus.SENT,
                sentAt: new Date(),
                lastError: null,
                nextAttemptAt: null,
              },
            });
            result.sent += 1;
          } catch (error) {
            const retryable = error instanceof EmailSendError ? error.retryable : true;
            const message = error instanceof Error ? error.message : String(error);
            const giveUp = !retryable || attemptNumber >= this.maxAttempts;

            if (giveUp) {
              await this.prisma.notificationDelivery.updateMany({
                where: { id: delivery.id },
                data: {
                  status: NotificationDeliveryStatus.FAILED,
                  lastError: message,
                  nextAttemptAt: null,
                },
              });
              result.failed += 1;
              this.logger.error(
                `Email delivery ${delivery.id} failed permanently after ${attemptNumber} attempt(s): ${message}`,
              );
            } else {
              // Exponential back-off: 30s, 60s, 2m, 4m…
              const delayMs = 30_000 * 2 ** (attemptNumber - 1);
              await this.prisma.notificationDelivery.updateMany({
                where: { id: delivery.id },
                data: { lastError: message, nextAttemptAt: new Date(Date.now() + delayMs) },
              });
              result.retrying += 1;
              this.logger.warn(
                `Email delivery ${delivery.id} attempt ${attemptNumber} failed, retrying in ${delayMs / 1000}s: ${message}`,
              );
            }
          }
        } catch (error) {
          this.logger.error(
            `Skipping notification delivery ${delivery.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return result;
    } catch (error) {
      // A broken dispatcher must not take the API down with it.
      this.logger.error(
        'Notification dispatcher drain failed.',
        error instanceof Error ? error.stack : String(error),
      );
      return result;
    } finally {
      this.draining = false;
    }
  }
}
