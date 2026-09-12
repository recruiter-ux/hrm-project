'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth-provider';
import { DocumentsSection } from '@/components/documents-section';
import { Badge, buttonClass, ErrorBanner, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { EmployeeDetail } from '@/lib/types';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-[var(--muted)] uppercase">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { can } = useAuth();

  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setEmployee(await api<EmployeeDetail>(`/api/employees/${id}`));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 404
            ? 'This employee does not exist, or is outside what your access level lets you see.'
            : err.message
          : 'Could not load this employee.',
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error} onRetry={() => void load()} />
        <Link href="/employees" className="text-sm underline underline-offset-2">
          Back to employees
        </Link>
      </div>
    );
  }

  if (!employee) return <Spinner />;

  const displayName = `${employee.preferredName ?? employee.firstName} ${employee.lastName}`;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/employees"
            className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
          >
            ← Employees
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{displayName}</h1>
          <p className="mt-1 text-[var(--muted)]">
            {employee.workingTitle ?? employee.role?.title ?? 'No job title'}
            {employee.department && ` · ${employee.department.name}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge value={employee.status} />
            <Badge value={employee.employmentType} tone="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" />
            <Badge value={employee.workLocationType} tone="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" />
          </div>
        </div>

        {can('employee:update') && (
          <Link href={`/employees/${employee.id}/edit`} className={buttonClass}>
            Edit
          </Link>
        )}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Details</h2>
        <dl className="grid gap-4 rounded-lg border border-[var(--border)] p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <DetailRow label="Employee number" value={employee.employeeNumber} />
          <DetailRow label="Work email" value={employee.workEmail} />
          <DetailRow label="Personal email" value={employee.personalEmail ?? '—'} />
          <DetailRow label="Phone" value={employee.phoneNumber ?? '—'} />
          <DetailRow label="Job title (Role)" value={employee.role?.title ?? '—'} />
          <DetailRow label="Department" value={employee.department?.name ?? '—'} />
          <DetailRow
            label="Manager"
            value={
              employee.manager ? (
                <Link
                  href={`/employees/${employee.manager.id}`}
                  className="underline underline-offset-2"
                >
                  {employee.manager.firstName} {employee.manager.lastName}
                </Link>
              ) : (
                '—'
              )
            }
          />
          <DetailRow label="Timezone" value={employee.timezone} />
          <DetailRow label="Hired" value={formatDate(employee.hiredAt)} />
          <DetailRow label="Probation ends" value={formatDate(employee.probationEndsAt)} />
          <DetailRow
            label="Access roles"
            value={
              employee.accessRoles.length > 0
                ? employee.accessRoles.map((r) => r.accessRole.name).join(', ')
                : 'None'
            }
          />
        </dl>
      </section>

      {employee.reports.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            Direct reports ({employee.reports.length})
          </h2>
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {employee.reports.map((report) => (
              <li key={report.id} className="px-4 py-3">
                <Link
                  href={`/employees/${report.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {report.firstName} {report.lastName}
                </Link>
                <span className="ml-2 text-sm text-[var(--muted)]">
                  {report.role?.title ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-lg font-semibold">Employment history</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          Every job change, kept as a dated record. This is why the system can answer &ldquo;which
          department was this person in last March?&rdquo;
        </p>

        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs tracking-wide text-[var(--muted)] uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Job title</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Manager</th>
                <th className="px-4 py-3 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {employee.assignmentHistory.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDate(entry.effectiveFrom)}
                    {' → '}
                    {entry.effectiveTo ? (
                      formatDate(entry.effectiveTo)
                    ) : (
                      <span className="font-medium text-green-700 dark:text-green-400">current</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{entry.role.title}</td>
                  <td className="px-4 py-3">{entry.department.name}</td>
                  <td className="px-4 py-3">
                    {entry.manager ? `${entry.manager.firstName} ${entry.manager.lastName}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      value={entry.reason}
                      tone="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                    />
                    {entry.notes && (
                      <div className="mt-1 text-xs text-[var(--muted)]">{entry.notes}</div>
                    )}
                    {entry.recordedBy && (
                      <div className="mt-0.5 text-xs text-[var(--muted)]">
                        recorded by {entry.recordedBy.firstName} {entry.recordedBy.lastName}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {can('document:read') && <DocumentsSection employeeId={employee.id} />}
    </div>
  );
}
