'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, ErrorBanner, ScopeNotice, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { OrgChartNode, PermissionScope } from '@/lib/types';

interface OrgChartResponse {
  roots: OrgChartNode[];
  total: number;
  scope: PermissionScope;
}

/**
 * One person and everyone beneath them, drawn recursively.
 *
 * Indentation plus a connecting rail rather than a canvas-drawn chart: it
 * stays readable at any depth, works on a phone, and needs no charting
 * library.
 */
function Node({ node, depth }: { node: OrgChartNode; depth: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <li className="relative">
      <div className="flex items-start gap-2 py-1.5">
        {hasChildren ? (
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--border)] text-xs leading-none transition-opacity hover:opacity-70"
          >
            {collapsed ? '+' : '−'}
          </button>
        ) : (
          <span className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        )}

        <div className="min-w-0">
          <Link
            href={`/employees/${node.id}`}
            className="font-medium underline-offset-2 hover:underline"
          >
            {node.name}
          </Link>
          {node.status !== 'ACTIVE' && (
            <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {node.status.replace(/_/g, ' ').toLowerCase()}
            </span>
          )}
          <div className="text-sm text-[var(--muted)]">
            {node.title ?? 'No job title'}
            {node.department && ` · ${node.department}`}
            {node.workLocationType === 'REMOTE' && ' · remote'}
            {hasChildren && ` · ${node.children.length} report${node.children.length === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>

      {hasChildren && !collapsed && (
        <ul className="ml-2.5 border-l border-[var(--border)] pl-5">
          {node.children.map((child) => (
            <Node key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChartPage() {
  const [data, setData] = useState<OrgChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<OrgChartResponse>('/api/employees/org-chart'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the org chart.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Org chart</h1>
        {data && <ScopeNotice scope={data.scope} total={data.total} />}
        <p className="mt-1 text-sm text-[var(--muted)]">
          Reporting lines as they stand today. Anyone whose manager is outside your access appears
          at the top level.
        </p>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!data && !error && <Spinner />}

      {data?.roots.length === 0 && (
        <EmptyState title="Nothing to show" hint="No employees are visible at your access level." />
      )}

      {data && data.roots.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] p-5">
          <ul>
            {data.roots.map((root) => (
              <Node key={root.id} node={root} depth={0} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
