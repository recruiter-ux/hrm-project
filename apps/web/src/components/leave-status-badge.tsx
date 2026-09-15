import type { LeaveRequestStatus } from '@/lib/types';

const STYLES: Record<LeaveRequestStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  APPROVED: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  CANCELLED: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

/**
 * REJECTED and CANCELLED are styled differently on purpose — one is a
 * manager's decision, the other the employee withdrawing. Collapsing them into
 * a single grey "closed" would lose that distinction at a glance.
 */
export function LeaveStatusBadge({ status }: { status: LeaveRequestStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}

export function formatDateRange(start: string, end: string): string {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const from = new Date(start).toLocaleDateString(undefined, options);
  const to = new Date(end).toLocaleDateString(undefined, options);
  return from === to ? from : `${from} → ${to}`;
}
