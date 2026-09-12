'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuth } from '@/components/auth-provider';
import { buttonClass, Field, inputClass, Spinner } from '@/components/ui';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in (e.g. opened /login in a second tab) — go straight in.
  useEffect(() => {
    if (!loading && user) router.replace('/employees');
  }, [user, loading, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace('/employees');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not reach the server. Is the API running?',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-8">
          <p className="text-sm font-medium tracking-wide text-[var(--muted)] uppercase">
            Hazel Mobile
          </p>
          <h1 className="mt-1 text-2xl font-semibold">[PROJECT_NAME]</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Sign in to continue.</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Work email" required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              className={inputClass}
              placeholder="you@hazelmobile.com"
            />
          </Field>

          <Field label="Password" required>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </Field>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className={`${buttonClass} w-full`}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-8 rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
          <p className="mb-1 font-medium">Development accounts</p>
          <p>
            Password for all: <code>Password123!</code>
          </p>
          <ul className="mt-1 space-y-0.5">
            <li>sana.iqbal@hazelmobile.com — HR admin (sees everyone)</li>
            <li>omar.farooq@hazelmobile.com — manager (sees his team)</li>
            <li>zara.ahmed@hazelmobile.com — employee (sees only herself)</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
