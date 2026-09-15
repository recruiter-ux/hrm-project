'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  buttonClass,
  ErrorBanner,
  Field,
  inputClass,
  secondaryButtonClass,
  Spinner,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { LeaveBalancesResponse, LeaveType } from '@/lib/types';

/**
 * Counts working days the same way the API does (weekends excluded, no holiday
 * calendar yet), purely so the form can preview the number before submitting.
 *
 * The API recalculates it server-side and that value is what gets stored — this
 * is a convenience, never the source of truth.
 */
function countWorkingDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  if (to < from) return 0;

  let count = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export default function NewLeaveRequestPage() {
  const router = useRouter();

  const [types, setTypes] = useState<LeaveType[] | null>(null);
  const [balances, setBalances] = useState<LeaveBalancesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [t, b] = await Promise.all([
          api<LeaveType[]>('/api/leave/types'),
          api<LeaveBalancesResponse>('/api/leave/balances'),
        ]);
        setTypes(t);
        setBalances(b);
        if (t.length > 0) setLeaveTypeId(t[0].id);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load leave types.');
      }
    })();
  }, []);

  const days = useMemo(() => countWorkingDays(startDate, endDate), [startDate, endDate]);
  const selectedType = types?.find((t) => t.id === leaveTypeId);
  const balance = balances?.balances.find((b) => b.leaveTypeId === leaveTypeId);

  const overBalance =
    selectedType?.requiresBalance && balance ? days > balance.remainingDays : false;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDetails([]);
    setSubmitting(true);
    try {
      await api('/api/leave/requests', {
        method: 'POST',
        body: {
          leaveTypeId,
          startDate: new Date(`${startDate}T00:00:00Z`).toISOString(),
          endDate: new Date(`${endDate}T00:00:00Z`).toISOString(),
          reason: reason.trim(),
        },
      });
      router.push('/leave');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? []);
      } else {
        setError('Could not submit the request.');
      }
      setSubmitting(false);
    }
  }

  if (!types && !error) return <Spinner />;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/leave" className="text-sm text-[var(--muted)] underline-offset-2 hover:underline">
          ← My leave
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Request leave</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          This goes to your manager for approval. Weekends are not counted.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}
      {details.length > 1 && (
        <ul className="list-inside list-disc rounded-md border border-[var(--border)] p-3 text-sm text-[var(--muted)]">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}

      {types && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Leave type" required>
            <select
              value={leaveTypeId}
              onChange={(e) => setLeaveTypeId(e.target.value)}
              required
              className={inputClass}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>

          {selectedType && balance && (
            <p className="text-sm text-[var(--muted)]">
              {selectedType.requiresBalance ? (
                <>
                  You have <strong>{balance.remainingDays}</strong> day
                  {balance.remainingDays === 1 ? '' : 's'} of {selectedType.name} remaining for{' '}
                  {balance.year}.
                </>
              ) : (
                <>{selectedType.name} does not draw from a balance.</>
              )}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" required>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (endDate < e.target.value) setEndDate(e.target.value);
                }}
                required
                className={inputClass}
              />
            </Field>
            <Field label="To" required>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className={inputClass}
              />
            </Field>
          </div>

          <div className="rounded-md border border-[var(--border)] p-3 text-sm">
            <span className="font-medium">
              {days} working day{days === 1 ? '' : 's'}
            </span>
            {days === 0 && (
              <span className="ml-2 text-[var(--muted)]">
                — that range has no working days in it.
              </span>
            )}
            {overBalance && (
              <span className="ml-2 text-red-700 dark:text-red-400">
                — more than your remaining balance.
              </span>
            )}
          </div>

          <Field label="Reason" required hint="Your manager sees this.">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              rows={3}
              className={inputClass}
              placeholder="Family holiday"
            />
          </Field>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting || days === 0 || overBalance}
              className={buttonClass}
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
            <Link href="/leave" className={secondaryButtonClass}>
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
