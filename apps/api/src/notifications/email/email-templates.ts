/**
 * =============================================================================
 * EMAIL TEMPLATES
 *
 * ONE shell, filled with data. Business logic never builds HTML — a service
 * hands over a heading, an intro sentence, some label/value rows and a link,
 * and this file turns that into a branded message.
 *
 * WHY IT MATTERS THAT THIS IS SEPARATE
 * Mail clients are a hostile rendering target: Outlook ignores most modern
 * CSS, so everything here is inline styles and tables. Keeping that ugliness
 * in one file means the Leave module (and Recruitment, and Attendance after
 * it) never has to know about it, and a rebrand is one edit rather than a
 * hunt through services.
 *
 * ⚠️ DO NOT PUT SENSITIVE DETAIL IN AN EMAIL. Email is unencrypted, forwarded,
 * and archived on servers we do not control. These messages say WHAT happened
 * and link back to the app — they deliberately carry no salary, no medical
 * note, no national ID, and no document contents. The reason field is included
 * for leave because the manager needs it to decide, and the employee wrote it
 * themselves.
 * =============================================================================
 */

export interface EmailDetailRow {
  label: string;
  value: string;
}

export type StatusTone = 'positive' | 'negative' | 'neutral' | 'pending';

export interface NotificationEmailInput {
  /** Subject line, already complete. */
  subject: string;
  /** Who is being written to, e.g. "Omar". */
  recipientName: string;
  /** The big line inside the message. */
  heading: string;
  /** One or two sentences under the heading. */
  intro: string;
  /** Status chip, e.g. "Pending approval". */
  status?: { label: string; tone: StatusTone };
  /** The facts, as a table. */
  details: EmailDetailRow[];
  /** A manager's comment or an employee's reason, shown as a quote. */
  quote?: { label: string; text: string };
  /** Absolute URL back into Velixa HR. */
  ctaUrl: string;
  ctaLabel: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** The product's identity, in one place, for every message it sends. */
const BRAND = {
  name: 'Velixa HR',
  company: 'Hazel Mobile',
  accent: '#171717',
} as const;

const TONE_COLOURS: Record<StatusTone, { bg: string; fg: string }> = {
  positive: { bg: '#dcfce7', fg: '#166534' },
  negative: { bg: '#fee2e2', fg: '#991b1b' },
  pending: { bg: '#fef3c7', fg: '#92400e' },
  neutral: { bg: '#e5e5e5', fg: '#404040' },
};

/** Email bodies are assembled as strings, so every value must be escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderNotificationEmail(input: NotificationEmailInput): RenderedEmail {
  const rows = input.details
    .map(
      (row) => `
        <tr>
          <td style="padding:6px 16px 6px 0;color:#737373;font-size:14px;white-space:nowrap;vertical-align:top;">${escapeHtml(row.label)}</td>
          <td style="padding:6px 0;color:#171717;font-size:14px;font-weight:500;">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join('');

  const statusChip = input.status
    ? `<span style="display:inline-block;border-radius:4px;padding:3px 10px;font-size:12px;font-weight:600;background:${TONE_COLOURS[input.status.tone].bg};color:${TONE_COLOURS[input.status.tone].fg};">${escapeHtml(input.status.label)}</span>`
    : '';

  const quoteBlock = input.quote
    ? `<div style="margin:20px 0;padding:12px 16px;border-left:3px solid #d4d4d4;background:#fafafa;">
         <div style="font-size:12px;color:#737373;margin-bottom:4px;">${escapeHtml(input.quote.label)}</div>
         <div style="font-size:14px;color:#171717;font-style:italic;">${escapeHtml(input.quote.text)}</div>
       </div>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;">

        <tr><td style="padding:20px 28px;border-bottom:1px solid #e5e5e5;">
          <span style="font-size:16px;font-weight:700;color:${BRAND.accent};">${BRAND.name}</span>
          <span style="font-size:13px;color:#a3a3a3;margin-left:8px;">${BRAND.company}</span>
        </td></tr>

        <tr><td style="padding:28px;">
          <p style="margin:0 0 16px;font-size:15px;color:#404040;">Hi ${escapeHtml(input.recipientName)},</p>
          <h1 style="margin:0 0 8px;font-size:19px;line-height:1.35;color:#171717;font-weight:600;">${escapeHtml(input.heading)}</h1>
          ${statusChip ? `<div style="margin:0 0 14px;">${statusChip}</div>` : ''}
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#525252;">${escapeHtml(input.intro)}</p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;padding:8px 0;margin:0 0 4px;">
            ${rows}
          </table>

          ${quoteBlock}

          <div style="margin:26px 0 8px;">
            <a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 20px;border-radius:6px;">${escapeHtml(input.ctaLabel)}</a>
          </div>
          <p style="margin:12px 0 0;font-size:12px;color:#a3a3a3;word-break:break-all;">Or paste this into your browser: ${escapeHtml(input.ctaUrl)}</p>
        </td></tr>

        <tr><td style="padding:16px 28px;border-top:1px solid #e5e5e5;background:#fafafa;border-radius:0 0 8px 8px;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#a3a3a3;">
            Sent automatically by ${BRAND.name}, the internal HR platform of ${BRAND.company}. Please do not reply to this message.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // A plain-text alternative is not optional politeness: some clients show it
  // instead of the HTML, and spam filters penalise messages without one.
  const text = [
    `Hi ${input.recipientName},`,
    '',
    input.heading,
    ...(input.status ? [`Status: ${input.status.label}`] : []),
    '',
    input.intro,
    '',
    ...input.details.map((row) => `${row.label}: ${row.value}`),
    ...(input.quote ? ['', `${input.quote.label}: "${input.quote.text}"`] : []),
    '',
    `${input.ctaLabel}: ${input.ctaUrl}`,
    '',
    '--',
    `Sent automatically by ${BRAND.name}, the internal HR platform of ${BRAND.company}.`,
    'Please do not reply to this message.',
  ].join('\n');

  return { subject: input.subject, html, text };
}
