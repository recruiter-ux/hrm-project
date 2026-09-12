'use client';

/**
 * Small shared presentation pieces.
 *
 * Deliberately plain. When a real design system arrives these get replaced —
 * they exist so the feature pages are not full of repeated Tailwind strings.
 */

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted)]">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  PROBATION: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  ON_LEAVE: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  NOTICE_PERIOD: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  SUSPENDED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  TERMINATED: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

export function Badge({ value, tone }: { value: string; tone?: string }) {
  const style = tone ?? STATUS_STYLES[value] ?? 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${style}`}>
      {value.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

/**
 * Explains what the signed-in person can see, based on the scope the API
 * reported. Makes permission behaviour visible rather than mysterious — if a
 * manager wonders why they only see two people, this says why.
 */
export function ScopeNotice({ scope, total }: { scope: string; total: number }) {
  const explanation: Record<string, string> = {
    GLOBAL: 'You can see everyone in the company.',
    DEPARTMENT: 'You can see your department, including any teams nested inside it.',
    TEAM: 'You can see yourself and your direct reports.',
    SELF: 'You can see your own record only.',
  };

  return (
    <p className="text-sm text-[var(--muted)]">
      Showing {total} {total === 1 ? 'person' : 'people'} · <strong>{scope}</strong> access —{' '}
      {explanation[scope] ?? ''}
    </p>
  );
}

export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500';

export const buttonClass =
  'rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900';

export const secondaryButtonClass =
  'rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-40';
