'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth-provider';
import {
  buttonClass,
  EmptyState,
  ErrorBanner,
  Field,
  inputClass,
  secondaryButtonClass,
  Spinner,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { EntitlementResult, LeaveType, LeaveTypeDetail } from '@/lib/types';

function fmt(date: string | null): string {
  if (!date) return 'current';
  return new Date(date).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const CURRENT_YEAR = new Date().getUTCFullYear();

/**
 * Leave Policy Settings — HR-only.
 *
 * The point of this screen: leave rules are DATA, not code. HR changes the
 * Annual Leave quota here and the system honours it from the date they choose,
 * while every earlier version stays readable.
 */
export default function LeavePolicySettingsPage() {
  const { can } = useAuth();
  const canManage = can('leave_policy:manage');

  const [types, setTypes] = useState<LeaveType[] | null>(null);
  const [selected, setSelected] = useState<LeaveTypeDetail | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreateType, setShowCreateType] = useState(false);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const loadTypes = useCallback(async () => {
    setError(null);
    try {
      setTypes(await api<LeaveType[]>(`/api/leave/types?includeInactive=${includeArchived}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load leave types.');
    }
  }, [includeArchived]);

  const loadDetail = useCallback(async (id: string) => {
    setError(null);
    try {
      const [detail, ent] = await Promise.all([
        api<LeaveTypeDetail>(`/api/leave/types/${id}`),
        api<EntitlementResult>(`/api/leave/types/${id}/entitlement?year=${CURRENT_YEAR}`),
      ]);
      setSelected(detail);
      setEntitlement(ent);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load that leave type.');
    }
  }, []);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  // --- Create leave type -----------------------------------------------------
  const [newType, setNewType] = useState({
    code: '',
    name: '',
    description: '',
    quotaDays: '8',
    minNoticeDays: '2',
    approvalRequired: true,
    carryForwardEnabled: false,
    requiresBalance: true,
    effectiveFrom: `${CURRENT_YEAR}-01-01`,
  });

  async function createType(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<LeaveTypeDetail>('/api/leave/types', {
        method: 'POST',
        body: {
          code: newType.code.trim().toUpperCase(),
          name: newType.name.trim(),
          description: newType.description.trim() || undefined,
          requiresBalance: newType.requiresBalance,
          quotaDays: Number(newType.quotaDays),
          minNoticeDays: Number(newType.minNoticeDays),
          approvalRequired: newType.approvalRequired,
          carryForwardEnabled: newType.carryForwardEnabled,
          effectiveFrom: new Date(`${newType.effectiveFrom}T00:00:00Z`).toISOString(),
        },
      });
      setShowCreateType(false);
      setNewType({ ...newType, code: '', name: '', description: '' });
      await loadTypes();
      await loadDetail(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the leave type.');
    } finally {
      setBusy(false);
    }
  }

  // --- New policy version ----------------------------------------------------
  const [version, setVersion] = useState({
    quotaDays: '',
    minNoticeDays: '',
    approvalRequired: true,
    carryForwardEnabled: false,
    effectiveFrom: '',
    notes: '',
  });

  function openVersionForm(detail: LeaveTypeDetail) {
    const p = detail.currentPolicy;
    setVersion({
      quotaDays: String(p?.quotaDays ?? 0),
      minNoticeDays: String(p?.minNoticeDays ?? 0),
      approvalRequired: p?.approvalRequired ?? true,
      carryForwardEnabled: p?.carryForwardEnabled ?? false,
      effectiveFrom: '',
      notes: '',
    });
    setShowNewVersion(true);
  }

  async function createVersion(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/leave/types/${selected.id}/policies`, {
        method: 'POST',
        body: {
          quotaDays: Number(version.quotaDays),
          minNoticeDays: Number(version.minNoticeDays),
          approvalRequired: version.approvalRequired,
          carryForwardEnabled: version.carryForwardEnabled,
          effectiveFrom: new Date(`${version.effectiveFrom}T00:00:00Z`).toISOString(),
          notes: version.notes.trim() || undefined,
        },
      });
      setShowNewVersion(false);
      await loadTypes();
      await loadDetail(selected.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the policy version.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(detail: LeaveTypeDetail) {
    const action = detail.isActive ? 'archive' : 'restore';
    if (
      detail.isActive &&
      !window.confirm(
        `Archive ${detail.name}? It disappears from the request form, but all ${detail.usage.requests} existing request(s) keep working.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/api/leave/types/${detail.id}/${action}`, { method: 'POST', body: {} });
      await loadTypes();
      await loadDetail(detail.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${action} the leave type.`);
    } finally {
      setBusy(false);
    }
  }

  if (!can('leave_policy:read')) {
    return (
      <EmptyState
        title="Not available"
        hint="Leave policy settings are restricted to HR administrators."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Leave policy settings</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Quotas and rules are dated. Changing a quota creates a new version from the date you
            choose — the previous version stays on record, so the system can still say what the
            quota was on any past date.
          </p>
        </div>
        {canManage && (
          <button onClick={() => setShowCreateType((v) => !v)} className={buttonClass}>
            {showCreateType ? 'Cancel' : 'Create leave type'}
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {showCreateType && canManage && (
        <form onSubmit={createType} className="space-y-4 rounded-lg border border-[var(--border)] p-5">
          <h2 className="font-semibold">New leave type</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" required hint="Upper case, e.g. CASUAL. Never changes.">
              <input
                value={newType.code}
                onChange={(e) => setNewType({ ...newType, code: e.target.value })}
                required
                className={inputClass}
                placeholder="ANNUAL"
              />
            </Field>
            <Field label="Name" required>
              <input
                value={newType.name}
                onChange={(e) => setNewType({ ...newType, name: e.target.value })}
                required
                className={inputClass}
                placeholder="Annual Leave"
              />
            </Field>
            <Field label="Description">
              <input
                value={newType.description}
                onChange={(e) => setNewType({ ...newType, description: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Quota (days per year)" required>
              <input
                type="number"
                step="0.5"
                min="0"
                value={newType.quotaDays}
                onChange={(e) => setNewType({ ...newType, quotaDays: e.target.value })}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Minimum notice (days)" hint="0 is right for Sick Leave.">
              <input
                type="number"
                min="0"
                value={newType.minNoticeDays}
                onChange={(e) => setNewType({ ...newType, minNoticeDays: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Effective from" required hint="When this first policy starts applying.">
              <input
                type="date"
                value={newType.effectiveFrom}
                onChange={(e) => setNewType({ ...newType, effectiveFrom: e.target.value })}
                required
                className={inputClass}
              />
            </Field>
          </div>

          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newType.approvalRequired}
                onChange={(e) => setNewType({ ...newType, approvalRequired: e.target.checked })}
              />
              Requires approval — unticked means requests are approved automatically
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newType.carryForwardEnabled}
                onChange={(e) => setNewType({ ...newType, carryForwardEnabled: e.target.checked })}
              />
              Carry forward unused days to next year
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newType.requiresBalance}
                onChange={(e) => setNewType({ ...newType, requiresBalance: e.target.checked })}
              />
              Draws from a balance — untick for unpaid leave
            </label>
          </div>

          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? 'Creating…' : 'Create leave type'}
          </button>
        </form>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        Show archived types
      </label>

      {!types && <Spinner />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* --- Type list --- */}
        {types && (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-xs tracking-wide text-[var(--muted)] uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Leave type</th>
                  <th className="px-4 py-3 font-medium">Quota now</th>
                  <th className="px-4 py-3 font-medium">Notice</th>
                  <th className="px-4 py-3 font-medium">Versions</th>
                </tr>
              </thead>
              <tbody>
                {types.map((type) => (
                  <tr
                    key={type.id}
                    onClick={() => void loadDetail(type.id)}
                    className={`cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-900 ${
                      selected?.id === type.id ? 'bg-neutral-100 dark:bg-neutral-900' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium">{type.name}</span>
                      {!type.isActive && (
                        <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
                          archived
                        </span>
                      )}
                      <div className="text-xs text-[var(--muted)]">
                        {type.code}
                        {!type.requiresBalance && ' · no balance needed'}
                        {type.currentPolicy && !type.currentPolicy.approvalRequired &&
                          ' · auto-approves'}
                      </div>
                    </td>
                    <td className="px-4 py-3">{type.currentPolicy?.quotaDays ?? '—'}</td>
                    <td className="px-4 py-3">{type.currentPolicy?.minNoticeDays ?? '—'}</td>
                    <td className="px-4 py-3">{type.versionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* --- Selected type: history + new version --- */}
        {selected && (
          <div className="space-y-5 rounded-lg border border-[var(--border)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <p className="text-sm text-[var(--muted)]">
                  {selected.usage.requests} request(s) reference this type
                  {selected.usage.requests > 0 && ' — it can be archived but never deleted'}
                </p>
              </div>
              {canManage && (
                <div className="flex gap-2">
                  <button
                    onClick={() => openVersionForm(selected)}
                    disabled={busy}
                    className={buttonClass}
                  >
                    New policy version
                  </button>
                  <button
                    onClick={() => void toggleArchive(selected)}
                    disabled={busy}
                    className={secondaryButtonClass}
                  >
                    {selected.isActive ? 'Archive' : 'Restore'}
                  </button>
                </div>
              )}
            </div>

            {showNewVersion && canManage && (
              <form
                onSubmit={createVersion}
                className="space-y-4 rounded-md border border-[var(--border)] p-4"
              >
                <p className="text-sm text-[var(--muted)]">
                  This closes the current version the day before, and opens a new one. Nothing
                  earlier is changed.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Quota (days per year)" required>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={version.quotaDays}
                      onChange={(e) => setVersion({ ...version, quotaDays: e.target.value })}
                      required
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Minimum notice (days)" required>
                    <input
                      type="number"
                      min="0"
                      value={version.minNoticeDays}
                      onChange={(e) => setVersion({ ...version, minNoticeDays: e.target.value })}
                      required
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Effective from" required>
                    <input
                      type="date"
                      value={version.effectiveFrom}
                      onChange={(e) => setVersion({ ...version, effectiveFrom: e.target.value })}
                      required
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Reason for the change">
                    <input
                      value={version.notes}
                      onChange={(e) => setVersion({ ...version, notes: e.target.value })}
                      className={inputClass}
                      placeholder="Board approved reduction"
                    />
                  </Field>
                </div>
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={version.approvalRequired}
                      onChange={(e) =>
                        setVersion({ ...version, approvalRequired: e.target.checked })
                      }
                    />
                    Requires approval
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={version.carryForwardEnabled}
                      onChange={(e) =>
                        setVersion({ ...version, carryForwardEnabled: e.target.checked })
                      }
                    />
                    Carry forward enabled
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className={buttonClass}>
                    {busy ? 'Saving…' : 'Save new version'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewVersion(false)}
                    className={secondaryButtonClass}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div>
              <h3 className="mb-2 font-medium">Policy history</h3>
              <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                {selected.versions.map((v) => (
                  <li key={v.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">
                        {fmt(v.effectiveFrom)} → {fmt(v.effectiveTo)}
                      </span>
                      <span>
                        <strong>{v.quotaDays}</strong> days · {v.minNoticeDays}d notice ·{' '}
                        {v.approvalRequired ? 'approval required' : 'auto-approves'}
                      </span>
                    </div>
                    {v.notes && <p className="mt-1 text-xs text-[var(--muted)]">{v.notes}</p>}
                    {v.createdBy && (
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        set by {v.createdBy.firstName} {v.createdBy.lastName}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {entitlement && entitlement.breakdown.length > 0 && (
              <div>
                <h3 className="mb-2 font-medium">
                  {entitlement.year} entitlement: {entitlement.entitledDays} days
                </h3>
                <p className="mb-2 text-xs text-[var(--muted)]">
                  {entitlement.method === 'PRORATED_BY_DAYS'
                    ? 'Each policy period contributes in proportion to how much of the year it covers.'
                    : 'The latest policy in the year applies to the whole year.'}
                </p>
                <ul className="space-y-1 text-xs text-[var(--muted)]">
                  {entitlement.breakdown.map((row) => (
                    <li key={row.policyId}>
                      {row.from} to {row.to}: {row.quotaDays} days × {row.daysInPeriod} days ={' '}
                      <strong>{row.contribution}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!selected && types && types.length > 0 && (
          <EmptyState title="Select a leave type" hint="Its policy history appears here." />
        )}
      </div>
    </div>
  );
}
