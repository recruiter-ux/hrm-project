import type { NotifyInput } from '../notifications/notification.service';

/**
 * =============================================================================
 * WHAT EACH LEAVE NOTIFICATION SAYS
 *
 * Content only. This file builds the payloads; LeaveService decides when to
 * send them and NotificationService decides how. Keeping the wording here
 * means the business logic stays readable and a change of phrasing never
 * risks touching the approval rules.
 *
 * IN-APP AND EMAIL ARE BUILT TOGETHER, from the same facts, in the same
 * function. That is what guarantees the bell and the inbox never disagree
 * about what happened.
 *
 * EVERY PAYLOAD CARRIES A dedupeKey derived from the request id, the event,
 * and the recipient — never from the clock. Submitting the same request twice
 * because a browser retried produces one notification and one email.
 * =============================================================================
 */

export const LEAVE_EVENTS = {
  SUBMITTED: 'leave.request.submitted',
  APPROVED: 'leave.request.approved',
  REJECTED: 'leave.request.rejected',
  CANCELLED: 'leave.request.cancelled',
  AUTO_APPROVED: 'leave.request.auto_approved',
  UNROUTED: 'leave.request.unrouted',
} as const;

const ENTITY = 'leave_request';

export interface LeaveNotificationContext {
  requestId: string;
  employeeName: string;
  leaveTypeName: string;
  startDate: Date;
  endDate: Date;
  days: number;
  reason: string;
}

/** "9 November 2026", or "9–11 November 2026" for a range. */
export function formatDateRange(start: Date, end: Date): string {
  const long = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  if (start.getTime() === end.getTime()) return long.format(start);

  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();

  return sameMonth
    ? `${start.getUTCDate()}–${long.format(end)}`
    : `${long.format(start)} – ${long.format(end)}`;
}

function dayLabel(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * The deep link.
 *
 * `?request=<id>` is what turns "go to the leave screen" into "open THIS
 * request" — the page highlights and scrolls to that row.
 */
function link(base: '/leave' | '/leave/approvals', requestId: string): string {
  return `${base}?request=${requestId}`;
}

function baseDetails(ctx: LeaveNotificationContext) {
  return [
    { label: 'Leave type', value: ctx.leaveTypeName },
    { label: 'Dates', value: formatDateRange(ctx.startDate, ctx.endDate) },
    { label: 'Working days', value: dayLabel(ctx.days) },
  ];
}

// -----------------------------------------------------------------------------
// A. Employee submits leave that needs a decision → the CURRENT manager
// -----------------------------------------------------------------------------
export function submittedToApprover(managerId: string, ctx: LeaveNotificationContext): NotifyInput {
  const dates = formatDateRange(ctx.startDate, ctx.endDate);
  return {
    recipientId: managerId,
    type: LEAVE_EVENTS.SUBMITTED,
    title: `${ctx.employeeName} requested ${ctx.leaveTypeName}`,
    body: `${dayLabel(ctx.days)}, ${dates}. Waiting for your decision.`,
    entityType: ENTITY,
    entityId: ctx.requestId,
    link: link('/leave/approvals', ctx.requestId),
    dedupeKey: `${ENTITY}:${ctx.requestId}:submitted:${managerId}`,
    email: {
      subject: `Leave request from ${ctx.employeeName} — ${dates}`,
      heading: `${ctx.employeeName} has requested ${ctx.leaveTypeName}`,
      intro: 'This request is waiting for your decision. Open Velixa HR to approve or reject it.',
      status: { label: 'Pending approval', tone: 'pending' },
      details: [{ label: 'Employee', value: ctx.employeeName }, ...baseDetails(ctx)],
      // The employee wrote this themselves and the manager needs it to decide.
      quote: { label: 'Reason given', text: ctx.reason },
      ctaLabel: 'Review this request',
    },
  };
}

// -----------------------------------------------------------------------------
// A′. Nobody could be found to approve it → HR
//
// The request is NOT auto-approved and NOT silently dropped. It stays PENDING
// and HR is told, because HR holds approval permission at GLOBAL scope and is
// the only party who can unblock it.
// -----------------------------------------------------------------------------
export function unroutedToHr(
  hrEmployeeId: string,
  ctx: LeaveNotificationContext,
  why: string,
): NotifyInput {
  const dates = formatDateRange(ctx.startDate, ctx.endDate);
  return {
    recipientId: hrEmployeeId,
    type: LEAVE_EVENTS.UNROUTED,
    title: `${ctx.employeeName}'s ${ctx.leaveTypeName} has no approver`,
    body: `${dayLabel(ctx.days)}, ${dates}. ${why} It needs an HR decision.`,
    entityType: ENTITY,
    entityId: ctx.requestId,
    link: link('/leave/approvals', ctx.requestId),
    dedupeKey: `${ENTITY}:${ctx.requestId}:unrouted:${hrEmployeeId}`,
    email: {
      subject: `Leave request needs HR: ${ctx.employeeName} — ${dates}`,
      heading: `${ctx.employeeName}'s leave request could not be routed`,
      intro: `${why} Because no manager can act on it, it is waiting for HR.`,
      status: { label: 'Needs HR decision', tone: 'pending' },
      details: [{ label: 'Employee', value: ctx.employeeName }, ...baseDetails(ctx)],
      quote: { label: 'Reason given', text: ctx.reason },
      ctaLabel: 'Review this request',
    },
  };
}

// -----------------------------------------------------------------------------
// B. Manager approves → the employee
// -----------------------------------------------------------------------------
export function approvedToEmployee(
  employeeId: string,
  ctx: LeaveNotificationContext,
  deciderName: string,
  comment: string | null,
): NotifyInput {
  const dates = formatDateRange(ctx.startDate, ctx.endDate);
  return {
    recipientId: employeeId,
    type: LEAVE_EVENTS.APPROVED,
    title: `Your ${ctx.leaveTypeName} was approved`,
    body: `${dayLabel(ctx.days)}, ${dates}. Approved by ${deciderName}.`,
    entityType: ENTITY,
    entityId: ctx.requestId,
    link: link('/leave', ctx.requestId),
    dedupeKey: `${ENTITY}:${ctx.requestId}:approved:${employeeId}`,
    email: {
      subject: `Approved: ${ctx.leaveTypeName}, ${dates}`,
      heading: `Your ${ctx.leaveTypeName} request was approved`,
      intro: `${deciderName} approved your request. The days have been taken from your balance.`,
      status: { label: 'Approved', tone: 'positive' },
      details: [...baseDetails(ctx), { label: 'Approved by', value: deciderName }],
      ...(comment ? { quote: { label: `Note from ${deciderName}`, text: comment } } : {}),
      ctaLabel: 'View your leave',
    },
  };
}

// -----------------------------------------------------------------------------
// C. Manager rejects → the employee, WITH the reason
// -----------------------------------------------------------------------------
export function rejectedToEmployee(
  employeeId: string,
  ctx: LeaveNotificationContext,
  deciderName: string,
  comment: string | null,
): NotifyInput {
  const dates = formatDateRange(ctx.startDate, ctx.endDate);
  const note = comment ?? 'No reason was given.';
  return {
    recipientId: employeeId,
    type: LEAVE_EVENTS.REJECTED,
    title: `Your ${ctx.leaveTypeName} was rejected`,
    body: `${dayLabel(ctx.days)}, ${dates}. ${deciderName} said: ${note}`,
    entityType: ENTITY,
    entityId: ctx.requestId,
    link: link('/leave', ctx.requestId),
    dedupeKey: `${ENTITY}:${ctx.requestId}:rejected:${employeeId}`,
    email: {
      subject: `Not approved: ${ctx.leaveTypeName}, ${dates}`,
      heading: `Your ${ctx.leaveTypeName} request was not approved`,
      intro: `${deciderName} rejected this request. No days have been taken from your balance.`,
      status: { label: 'Rejected', tone: 'negative' },
      details: [...baseDetails(ctx), { label: 'Decided by', value: deciderName }],
      quote: { label: `Reason from ${deciderName}`, text: note },
      ctaLabel: 'View your leave',
    },
  };
}

// -----------------------------------------------------------------------------
// D. Employee withdraws → the manager who would have decided it
//
// Only sent where a manager needed to know: a request nobody was ever asked
// about generates no cancellation notice.
// -----------------------------------------------------------------------------
export function cancelledToApprover(
  managerId: string,
  ctx: LeaveNotificationContext,
  wasApproved: boolean,
  cancelledByName: string,
): NotifyInput {
  const dates = formatDateRange(ctx.startDate, ctx.endDate);
  const wording = wasApproved
    ? 'The leave was already approved, so those days are back in their balance.'
    : 'It is no longer waiting for your decision.';

  return {
    recipientId: managerId,
    type: LEAVE_EVENTS.CANCELLED,
    title: `${ctx.employeeName} withdrew their ${ctx.leaveTypeName}`,
    body: `${dayLabel(ctx.days)}, ${dates}. ${wording}`,
    entityType: ENTITY,
    entityId: ctx.requestId,
    link: link('/leave/approvals', ctx.requestId),
    dedupeKey: `${ENTITY}:${ctx.requestId}:cancelled:${managerId}`,
    email: {
      subject: `Withdrawn: ${ctx.employeeName}'s ${ctx.leaveTypeName}, ${dates}`,
      heading: `${ctx.employeeName} withdrew a leave request`,
      intro: wording,
      status: { label: 'Cancelled', tone: 'neutral' },
      details: [
        { label: 'Employee', value: ctx.employeeName },
        ...baseDetails(ctx),
        { label: 'Withdrawn by', value: cancelledByName },
      ],
      ctaLabel: 'Open leave approvals',
    },
  };
}

// -----------------------------------------------------------------------------
// E. The policy required no approval → the employee only
//
// No manager notification is raised, because no manager action is needed.
// -----------------------------------------------------------------------------
export function autoApprovedToEmployee(
  employeeId: string,
  ctx: LeaveNotificationContext,
): NotifyInput {
  const dates = formatDateRange(ctx.startDate, ctx.endDate);
  return {
    recipientId: employeeId,
    type: LEAVE_EVENTS.AUTO_APPROVED,
    title: `Your ${ctx.leaveTypeName} was approved automatically`,
    body: `${dayLabel(ctx.days)}, ${dates}. ${ctx.leaveTypeName} does not require approval, so no manager had to act.`,
    entityType: ENTITY,
    entityId: ctx.requestId,
    link: link('/leave', ctx.requestId),
    dedupeKey: `${ENTITY}:${ctx.requestId}:auto_approved:${employeeId}`,
    email: {
      subject: `Approved automatically: ${ctx.leaveTypeName}, ${dates}`,
      heading: `Your ${ctx.leaveTypeName} request was approved automatically`,
      intro: `The current ${ctx.leaveTypeName} policy does not require approval, so this request was approved the moment you submitted it. Nobody needs to review it.`,
      status: { label: 'Approved automatically', tone: 'positive' },
      details: baseDetails(ctx),
      ctaLabel: 'View your leave',
    },
  };
}
