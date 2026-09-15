'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { formatDateRange, LeaveStatusBadge } from '@/components/leave-status-badge';
import { EmptyState, ErrorBanner, inputClass, ScopeNotice, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { LeaveRequestsResponse } from '@/lib/types';

/**
 * The manager's queue.
 *
 * "Awaiting my decision" asks the API for PENDING requests routed to this
 * person, excluding their own — the server applies that filter, so this page
 * cannot accidentally show something the viewer may not act on.
 */
export default function LeaveApprovalsPage() {
  const [data, setData] = useState<LeaveRequestsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query = showAll
        ? 'pageSize=100'
        : 'awaitingMyDecision=true&pageSize=100';
      setData(await api<LeaveRequestsResponse>(`/api/leave/requests?${query}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load leave requests.');
    }
  }, [showAll]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusyId(id);
    setError(null);
    try {
      await api(`/api/leave/requests/${id}/${action}`, {
        method: 'POST',
        body: { comment: comments[id]?.trim() || undefined },
      });
      setComments((prev) => ({ ...prev, [id]: '' }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${action} the request.`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Leave approvals</h1>
        {data && <ScopeNotice scope={data.scope} total={data.total} />}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        Show all requests I can see, not just those awaiting my decision
      </label>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!data && !error && <Spinner />}

      {data?.items.length === 0 && (
        <EmptyState
          title={showAll ? 'No leave requests' : 'Nothing awaiting your decision'}
          hint={
            showAll
              ? 'Nobody in your team has requested leave.'
              : 'Requests from your direct reports appear here.'
          }
        />
      )}

      {data && data.items.length > 0 && (
        <ul className="space-y-3">
          {data.items.map((req) => {
            const actionable = req.status === 'PENDING';
            return (
              <li key={req.id} className="rounded-lg border border-[var(--border)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/employees/${req.employee.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {req.employee.firstName} {req.employee.lastName}
                      </Link>
                      <span className="text-xs text-[var(--muted)]">
                        {req.employee.employeeNumber}
                      </span>
                      <LeaveStatusBadge status={req.status} />
                    </div>
                    <div className="mt-1 text-sm">
                      <strong>{req.days}</strong> day{req.days === 1 ? '' : 's'}{' '}
                      {req.leaveType.name} · {formatDateRange(req.startDate, req.endDate)}
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">{req.reason}</p>
                    {req.decidedBy && (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {req.status.toLowerCase()} by {req.decidedBy.firstName}{' '}
                        {req.decidedBy.lastName}
                        {req.decisionComment && ` — “${req.decisionComment}”`}
                      </p>
                    )}
                  </div>
                </div>

                {actionable && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      value={comments[req.id] ?? ''}
                      onChange={(e) =>
                        setComments((prev) => ({ ...prev, [req.id]: e.target.value }))
                      }
                      placeholder="Comment (optional)"
                      className={`${inputClass} max-w-xs flex-1`}
                    />
                    <button
                      onClick={() => void decide(req.id, 'approve')}
                      disabled={busyId === req.id}
                      className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40"
                    >
                      {busyId === req.id ? 'Working…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => void decide(req.id, 'reject')}
                      disabled={busyId === req.id}
                      className="rounded-md border border-red-700 px-4 py-2 text-sm font-medium text-red-700 transition-opacity hover:opacity-85 disabled:opacity-40 dark:border-red-500 dark:text-red-400"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
