'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth-provider';
import { formatDateRange, LeaveStatusBadge } from '@/components/leave-status-badge';
import { buttonClass, EmptyState, ErrorBanner, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { LeaveBalancesResponse, LeaveRequestsResponse } from '@/lib/types';

/**
 * "My leave" — balances at the top, request history below.
 *
 * Deliberately shows only the signed-in person's own leave, whatever their
 * access level. A manager reviewing their team goes to /leave/approvals; an HR
 * admin browsing everyone uses the employee directory. Mixing "mine" and
 * "everyone's" into one list made it unclear whose leave you were looking at.
 */
export default function MyLeavePage() {
  const { user, can } = useAuth();
  const myEmployeeId = user?.employee?.id ?? null;

  const [balances, setBalances] = useState<LeaveBalancesResponse | null>(null);
  const [requests, setRequests] = useState<LeaveRequestsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!myEmployeeId) return;
    setError(null);
    try {
      const [b, r] = await Promise.all([
        api<LeaveBalancesResponse>('/api/leave/balances'),
        api<LeaveRequestsResponse>(
          `/api/leave/requests?employeeId=${myEmployeeId}&pageSize=100`,
        ),
      ]);
      setBalances(b);
      setRequests(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your leave.');
    }
  }, [myEmployeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string) {
    if (!window.confirm('Withdraw this leave request?')) return;
    setBusyId(id);
    try {
      await api(`/api/leave/requests/${id}/cancel`, { method: 'POST', body: {} });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel the request.');
    } finally {
      setBusyId(null);
    }
  }

  if (!myEmployeeId) {
    return (
      <EmptyState
        title="No employee record linked to your login"
        hint="Leave is tracked against an employee record. Ask HR to link your account."
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My leave</h1>
          {balances && (
            <p className="mt-1 text-sm text-[var(--muted)]">
              Entitlement for {balances.year}. Pending requests already reserve part of your
              balance.
            </p>
          )}
        </div>
        {can('leave_request:create') && (
          <Link href="/leave/new" className={buttonClass}>
            Request leave
          </Link>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!balances && !error && <Spinner />}

      {balances && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Balances</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {balances.balances.map((b) => (
              <div key={b.leaveTypeId} className="rounded-lg border border-[var(--border)] p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{b.name}</span>
                  {!b.requiresBalance && (
                    <span className="text-xs text-[var(--muted)]">no balance needed</span>
                  )}
                </div>

                {b.requiresBalance ? (
                  <>
                    <div className="mt-2 text-3xl font-semibold">{b.remainingDays}</div>
                    <div className="text-xs text-[var(--muted)]">days remaining</div>
                    <dl className="mt-3 space-y-0.5 text-xs text-[var(--muted)]">
                      <div className="flex justify-between">
                        <dt>Entitled</dt>
                        <dd>{b.entitledDays}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Taken (approved)</dt>
                        <dd>{b.approvedDays}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Reserved (pending)</dt>
                        <dd>{b.pendingDays}</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Can be requested without an entitlement.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">My requests</h2>

        {requests?.items.length === 0 && (
          <EmptyState title="No leave requests yet" hint="Use “Request leave” to submit one." />
        )}

        {requests && requests.items.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-xs tracking-wide text-[var(--muted)] uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Dates</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Days</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Decision</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {requests.items.map((req) => {
                  const canWithdraw =
                    req.status === 'PENDING' ||
                    (req.status === 'APPROVED' && new Date(req.startDate) > new Date());
                  return (
                    <tr key={req.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatDateRange(req.startDate, req.endDate)}
                        <div className="text-xs text-[var(--muted)]">{req.reason}</div>
                      </td>
                      <td className="px-4 py-3">{req.leaveType.name}</td>
                      <td className="px-4 py-3">{req.days}</td>
                      <td className="px-4 py-3">
                        <LeaveStatusBadge status={req.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        {req.status === 'PENDING' && req.approver && (
                          <>with {req.approver.firstName} {req.approver.lastName}</>
                        )}
                        {req.status === 'PENDING' && !req.approver && (
                          <span className="text-amber-700 dark:text-amber-400">
                            no manager assigned — HR must decide
                          </span>
                        )}
                        {req.decidedBy && (
                          <>
                            {req.decidedBy.firstName} {req.decidedBy.lastName}
                            {req.decisionComment && (
                              <div className="mt-0.5 italic">“{req.decisionComment}”</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canWithdraw && can('leave_request:cancel') && (
                          <button
                            onClick={() => void cancel(req.id)}
                            disabled={busyId === req.id}
                            className="rounded-md border border-[var(--border)] px-3 py-1 text-xs transition-opacity hover:opacity-70 disabled:opacity-40"
                          >
                            {busyId === req.id ? 'Withdrawing…' : 'Withdraw'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
