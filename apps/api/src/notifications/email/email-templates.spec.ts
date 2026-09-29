import { renderNotificationEmail } from './email-templates';

/**
 * Email rendering.
 *
 * Two things here genuinely matter and are easy to get wrong:
 *
 *   ESCAPING. Every value is interpolated into an HTML string. An employee
 *   whose reason is "<script>" or whose surname contains an apostrophe must
 *   not be able to break — or inject into — the message a manager receives.
 *
 *   THE PLAIN-TEXT PART. Some clients show it instead of the HTML, and a
 *   message without one is more likely to be filtered as spam. It is easy to
 *   add a field to the HTML and forget the text.
 */

const base = {
  subject: 'Leave request from Zara Ahmed — 9–11 November 2026',
  recipientName: 'Omar',
  heading: 'Zara Ahmed has requested Annual Leave',
  intro: 'This request is waiting for your decision.',
  status: { label: 'Pending approval', tone: 'pending' as const },
  details: [
    { label: 'Employee', value: 'Zara Ahmed' },
    { label: 'Leave type', value: 'Annual Leave' },
    { label: 'Working days', value: '3 days' },
  ],
  ctaUrl: 'http://localhost:3000/leave/approvals?request=abc123',
  ctaLabel: 'Review this request',
};

describe('renderNotificationEmail', () => {
  it('produces a subject, an HTML part and a text part', () => {
    const email = renderNotificationEmail(base);

    expect(email.subject).toBe(base.subject);
    expect(email.html).toContain('<!doctype html>');
    expect(email.text.length).toBeGreaterThan(0);
    expect(email.text).not.toContain('<');
  });

  it('carries every detail row into both parts', () => {
    const email = renderNotificationEmail(base);

    for (const row of base.details) {
      expect(email.html).toContain(row.label);
      expect(email.html).toContain(row.value);
      expect(email.text).toContain(`${row.label}: ${row.value}`);
    }
  });

  it('includes the deep link as a button and as pasteable text', () => {
    const email = renderNotificationEmail(base);

    // The href, for a client that renders HTML…
    expect(email.html).toContain(`href="${base.ctaUrl}"`);
    // …and the bare URL, for one that does not.
    expect(email.text).toContain(base.ctaUrl);
  });

  it('escapes HTML in every interpolated value', () => {
    const email = renderNotificationEmail({
      ...base,
      details: [{ label: 'Employee', value: '<script>alert(1)</script>' }],
      quote: { label: 'Reason given', text: 'Family "emergency" & travel <b>urgent</b>' },
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&quot;emergency&quot;');
    expect(email.html).toContain('&amp; travel');
    expect(email.html).not.toContain('<b>urgent</b>');
  });

  it('shows a manager comment as a quote when there is one', () => {
    const email = renderNotificationEmail({
      ...base,
      quote: { label: 'Reason from Omar Farooq', text: 'Please provide a medical note.' },
    });

    expect(email.html).toContain('Please provide a medical note.');
    expect(email.text).toContain('Reason from Omar Farooq: "Please provide a medical note."');
  });

  it('omits the quote block entirely when there is no comment', () => {
    const email = renderNotificationEmail(base);
    expect(email.html).not.toContain('border-left');
  });

  it('addresses the recipient by name and identifies the sender', () => {
    const email = renderNotificationEmail(base);

    expect(email.html).toContain('Hi Omar,');
    expect(email.text.startsWith('Hi Omar,')).toBe(true);
    expect(email.html).toContain('Velixa HR');
    expect(email.html).toContain('Hazel Mobile');
  });

  it('keeps the plain-text part readable, with blank lines between sections', () => {
    const email = renderNotificationEmail(base);
    expect(email.text).toContain('\n\n');
  });
});
