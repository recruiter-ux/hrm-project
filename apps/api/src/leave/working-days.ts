/**
 * Working-day arithmetic for leave requests.
 *
 * SCOPE OF THIS PHASE: weekends (Saturday and Sunday) are excluded; public
 * holidays are NOT, because there is no holiday calendar yet. A request over
 * Eid or Christmas will currently consume those days.
 *
 * When a `PublicHoliday` table arrives, this is the only file that changes —
 * and because `LeaveRequest.days` is stored rather than recomputed, already
 * approved requests keep the number they were approved with.
 */

/** Strips the time portion, in UTC, to match Postgres `date` columns. */
export function toDateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** Saturday (6) and Sunday (0) in UTC. */
export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Working days between two dates, inclusive of both.
 *
 * Returns 0 if the range is backwards — callers validate the order separately
 * and give a clearer message than a silent zero.
 */
export function countWorkingDays(start: Date, end: Date): number {
  const from = toDateOnly(start);
  const to = toDateOnly(end);
  if (to < from) return 0;

  let count = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/** `2026-04-01` — used in user-facing messages. */
export function formatDate(date: Date): string {
  return toDateOnly(date).toISOString().slice(0, 10);
}

/**
 * The year a request counts against.
 *
 * Attributed to the START date, so a request spanning New Year draws entirely
 * from the year it began in. That is the simple rule; splitting across two
 * balances is a real-world refinement for later.
 */
export function leaveYearOf(startDate: Date): number {
  return toDateOnly(startDate).getUTCFullYear();
}
