'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import type { CurrentUser, PermissionScope } from '@/lib/types';

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Does the signed-in user hold this permission at any scope? */
  can: (permissionKey: string) => boolean;
  /** At what scope, or null if not at all. */
  scopeFor: (permissionKey: string) => PermissionScope | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the signed-in user for the whole app.
 *
 * Tokens are httpOnly cookies, so JavaScript cannot read them — the only way
 * to know who is signed in is to ask the API. That is what makes session
 * persistence across a page refresh work: on mount we call /auth/me, the
 * browser attaches the cookie automatically, and the session is restored.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      setUser(await api<CurrentUser>('/api/auth/me'));
    } catch {
      // 401 here just means "not signed in" — not an error worth surfacing.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api('/api/auth/login', { method: 'POST', body: { email, password } });
      // Re-fetch rather than trusting the login response: /auth/me is the one
      // place that assembles the permission map.
      await loadUser();
    },
    [loadUser],
  );

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      // Clear locally even if the server call failed, so the user is never
      // stuck looking at a signed-in UI they cannot use.
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      refresh: loadUser,
      can: (key) => Boolean(user?.permissions?.[key]),
      scopeFor: (key) => user?.permissions?.[key] ?? null,
    }),
    [user, loading, login, logout, loadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
