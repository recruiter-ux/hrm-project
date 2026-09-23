'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/components/auth-provider';
import { Spinner } from '@/components/ui';

/**
 * Shell for every signed-in page.
 *
 * The redirect here is a CONVENIENCE, not a security boundary — it stops
 * signed-out users staring at an empty screen. Actual enforcement is on the
 * API, which re-checks the token and permissions on every single request.
 * Hiding a nav link protects nobody.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }

  const employee = user.employee;
  const displayName = employee
    ? `${employee.preferredName ?? employee.firstName} ${employee.lastName}`
    : user.email;

  const accessRoles = employee?.accessRoles.map((r) => r.accessRole.name).join(', ') ?? 'No access';

  const navItems = [
    { href: '/employees', label: 'Employees', show: can('employee:read') },
    { href: '/org-chart', label: 'Org chart', show: can('employee:read') },
    { href: '/leave', label: 'My leave', show: can('leave_request:create') },
    // Only shown to people who can actually decide something — an ordinary
    // employee has no leave_request:approve permission at any scope.
    { href: '/leave/approvals', label: 'Approvals', show: can('leave_request:approve') },
    // HR-only. No manager or employee AccessRole grants leave_policy:read.
    { href: '/leave/policies', label: 'Leave policy', show: can('leave_policy:read') },
  ].filter((item) => item.show);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
          <Link href="/employees" className="font-semibold">
            Velixa HR
          </Link>

          <nav className="flex gap-1">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-neutral-200 font-medium dark:bg-neutral-800'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <div className="text-right">
              <div className="font-medium">{displayName}</div>
              <div className="text-xs text-[var(--muted)]" title="Your AccessRoles">
                {accessRoles}
              </div>
            </div>
            <button
              onClick={() => void handleLogout()}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm transition-opacity hover:opacity-70"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
