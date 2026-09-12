'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth-provider';
import {
  Badge,
  buttonClass,
  EmptyState,
  ErrorBanner,
  inputClass,
  ScopeNotice,
  Spinner,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { EmployeeListResponse } from '@/lib/types';

export default function EmployeesPage() {
  const { can } = useAuth();

  const [data, setData] = useState<EmployeeListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (search.trim()) params.set('search', search.trim());
      setData(await api<EmployeeListResponse>(`/api/employees?${params}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load employees.');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Employees</h1>
          {data && <ScopeNotice scope={data.scope} total={data.total} />}
        </div>

        {can('employee:create') && (
          <Link href="/employees/new" className={buttonClass}>
            Add employee
          </Link>
        )}
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        placeholder="Search by name, email, or employee number…"
        className={`${inputClass} max-w-md`}
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {loading && !data && <Spinner />}

      {data && data.items.length === 0 && !loading && (
        <EmptyState
          title="No employees match"
          hint={search ? 'Try a different search term.' : 'Nothing is visible at your access level.'}
        />
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs tracking-wide text-[var(--muted)] uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Job title</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Manager</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((employee) => (
                <tr
                  key={employee.id}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/employees/${employee.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {employee.preferredName ?? employee.firstName} {employee.lastName}
                    </Link>
                    <div className="text-xs text-[var(--muted)]">
                      {employee.employeeNumber} · {employee.workEmail}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {employee.workingTitle ?? employee.role?.title ?? '—'}
                    {employee.workingTitle && employee.role && (
                      <div className="text-xs text-[var(--muted)]">{employee.role.title}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">{employee.department?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    {employee.manager
                      ? `${employee.manager.firstName} ${employee.manager.lastName}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={employee.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[var(--muted)]">
            Page {data.page} of {data.totalPages}
          </span>
          <button
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
