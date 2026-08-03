'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Phase 0 status page.
 *
 * Its only job is to prove the whole chain works end to end:
 *   browser -> Next.js -> NestJS API -> Postgres + Redis
 *
 * This page gets replaced by the real dashboard in a later phase. It is not a
 * template for how feature pages should be written.
 */

interface DependencyStatus {
  status: 'up' | 'down';
  error?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/health`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`API responded with HTTP ${response.status}`);
      }
      setHealth((await response.json()) as HealthResponse);
    } catch (err) {
      setHealth(null);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header>
        <p className="text-sm font-medium tracking-wide text-[var(--muted)] uppercase">
          Hazel Mobile
        </p>
        <h1 className="mt-1 text-3xl font-semibold">[PROJECT_NAME]</h1>
        <p className="mt-2 text-[var(--muted)]">
          Phase 0 — scaffolding. This page checks that every piece of the stack is running.
        </p>
      </header>

      <section className="rounded-lg border border-[var(--border)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">System status</h2>
          <button
            onClick={() => void checkHealth()}
            disabled={loading}
            className="rounded-md border border-[var(--border)] px-3 py-1 text-sm transition-opacity hover:opacity-70 disabled:opacity-40"
          >
            {loading ? 'Checking…' : 'Re-check'}
          </button>
        </div>

        <ul className="space-y-1">
          <StatusRow label="Web (Next.js)" ok={true} detail="You are looking at it" />
          <StatusRow
            label="API (NestJS)"
            ok={health !== null}
            detail={health ? `up ${health.uptimeSeconds}s` : (error ?? 'unreachable')}
            loading={loading}
          />
          <StatusRow
            label="Database (Postgres)"
            ok={health?.dependencies.database.status === 'up'}
            detail={health?.dependencies.database.error ?? (health ? 'connected' : '—')}
            loading={loading}
          />
          <StatusRow
            label="Cache (Redis)"
            ok={health?.dependencies.redis.status === 'up'}
            detail={health?.dependencies.redis.error ?? (health ? 'connected' : '—')}
            loading={loading}
          />
        </ul>

        {error && (
          <div className="mt-4 rounded-md border border-[var(--border)] p-3 text-sm">
            <p className="font-medium">Could not reach the API at {API_URL}</p>
            <p className="mt-1 text-[var(--muted)]">
              Check that the API is running (<code>npm run dev</code>) and that Docker is up (
              <code>npm run db:up</code>).
            </p>
          </div>
        )}
      </section>

      <footer className="text-sm text-[var(--muted)]">
        No authentication or business logic exists yet — that is the next phase. See{' '}
        <code>PROJECT_NOTES.md</code> for what was decided and why.
      </footer>
    </main>
  );
}

function StatusRow({
  label,
  ok,
  detail,
  loading = false,
}: {
  label: string;
  ok: boolean | undefined;
  detail: string;
  loading?: boolean;
}) {
  const symbol = loading ? '…' : ok ? '●' : '○';
  const color = loading ? 'text-[var(--muted)]' : ok ? 'text-green-600' : 'text-red-600';

  return (
    <li className="flex items-baseline justify-between gap-4 py-1">
      <span className="flex items-center gap-2">
        <span className={`${color} text-xs`} aria-hidden="true">
          {symbol}
        </span>
        <span>{label}</span>
      </span>
      <span className="truncate text-sm text-[var(--muted)]">{detail}</span>
    </li>
  );
}
