'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/components/auth-provider';
import { Spinner } from '@/components/ui';

/**
 * Entry point. Sends signed-in users to the directory and everyone else to
 * the login screen.
 */
export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/employees' : '/login');
  }, [user, loading, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <Spinner />
    </main>
  );
}
