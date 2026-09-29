import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Thrown when a send fails in a way that is worth retrying (mail server down,
 * timeout). The dispatcher backs off and tries again.
 *
 * Anything else — a malformed address, a rejected recipient — is permanent and
 * the dispatcher gives up sooner.
 */
export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/**
 * =============================================================================
 * EMAIL DELIVERY
 *
 * One interface, three transports, chosen by EMAIL_TRANSPORT:
 *
 *   file   Writes a real .eml file into EMAIL_OUTBOX_DIR. Nothing is sent over
 *          the network, but the message is genuinely produced and can be
 *          double-clicked open in any mail client. This is the DEVELOPMENT
 *          DEFAULT, and it is what makes "did the employee get an email?"
 *          answerable without buying a mail provider.
 *
 *   smtp   Real delivery through nodemailer. Needs SMTP_HOST and friends.
 *
 *   none   Nothing is attempted. Deliveries are recorded as SKIPPED with the
 *          reason, never as SENT. ⚠️ The system must never claim it delivered
 *          an email it did not send.
 *
 * CREDENTIALS ARE NEVER HARDCODED. Everything comes through ConfigService, in
 * line with the project rule that `process.env` appears only in
 * config/configuration.ts.
 * =============================================================================
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.logger.log(
      `Email transport: ${this.transport}` +
        (this.transport === 'file' ? ` (writing .eml files to ${this.outboxDir})` : '') +
        (this.transport === 'none'
          ? ' — no provider configured, emails will be recorded as SKIPPED'
          : ''),
    );
  }

  private get transport(): 'file' | 'smtp' | 'none' {
    return this.config.get<'file' | 'smtp' | 'none'>('email.transport', 'none');
  }

  private get outboxDir(): string {
    return this.config.get<string>('email.outboxDir', './outbox');
  }

  private get from(): string {
    return this.config.get<string>('email.from', 'Velixa HR <no-reply@velixa-hr.local>');
  }

  /** Whether a send would actually be attempted. Drives SKIPPED vs PENDING. */
  get isConfigured(): boolean {
    return this.transport !== 'none';
  }

  /** Shown on the delivery row so "why was this skipped?" is answerable. */
  get notConfiguredReason(): string {
    return 'No email provider configured (EMAIL_TRANSPORT=none). See PROJECT_NOTES.md §12.';
  }

  async send(email: OutboundEmail): Promise<void> {
    switch (this.transport) {
      case 'file':
        return this.sendToFile(email);
      case 'smtp':
        return this.sendOverSmtp(email);
      default:
        // Should never be reached — callers check isConfigured first — but a
        // silent success here would be a lie about delivery.
        throw new EmailSendError(this.notConfiguredReason, false);
    }
  }

  /**
   * Writes an RFC 5322 message to disk.
   *
   * Deliberately a real .eml rather than a console log: it proves the subject,
   * recipient, and both body parts were produced correctly, and you can open
   * it to see exactly what the person would have received.
   */
  private async sendToFile(email: OutboundEmail): Promise<void> {
    const dir = path.resolve(this.outboxDir);
    await fs.mkdir(dir, { recursive: true });

    const boundary = `----velixa-${Date.now().toString(36)}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTo = email.to.replace(/[^a-zA-Z0-9._-]/g, '_');
    const file = path.join(dir, `${stamp}__${safeTo}.eml`);

    const message = [
      `From: ${this.from}`,
      `To: ${email.to}`,
      `Subject: ${email.subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      email.text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      email.html,
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    await fs.writeFile(file, message, 'utf8');
    this.logger.log(`Email written to ${file} (to: ${email.to})`);
  }

  private async sendOverSmtp(email: OutboundEmail): Promise<void> {
    const host = this.config.get<string>('email.smtp.host');
    if (!host) {
      throw new EmailSendError('EMAIL_TRANSPORT=smtp but SMTP_HOST is not set.', false);
    }

    this.transporter ??= nodemailer.createTransport({
      host,
      port: this.config.get<number>('email.smtp.port', 587),
      secure: this.config.get<boolean>('email.smtp.secure', false),
      auth: this.config.get<string>('email.smtp.user')
        ? {
            user: this.config.get<string>('email.smtp.user'),
            pass: this.config.get<string>('email.smtp.password'),
          }
        : undefined,
    });

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    } catch (error) {
      const err = error as { responseCode?: number; message?: string };
      // 5xx from a mail server is a permanent rejection (bad address, blocked
      // sender). Retrying it just burns attempts.
      const permanent = typeof err.responseCode === 'number' && err.responseCode >= 500;
      throw new EmailSendError(err.message ?? 'SMTP send failed.', !permanent);
    }
  }
}
