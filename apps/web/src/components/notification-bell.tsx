'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '@/lib/api';
import type { NotificationItem, NotificationsResponse } from '@/lib/types';

/**
 * =============================================================================
 * THE NOTIFICATION CENTRE
 *
 * A bell in the header with an unread count, and a dropdown listing what has
 * happened. Every module raises notifications the same way, so this screen
 * never needs to know that Leave exists — it renders a title, a body, a time,
 * and a link.
 *
 * WHY POLLING RATHER THAN A LIVE CONNECTION
 * A WebSocket or server-sent events would update instantly, but both need
 * connection handling, reconnection, and auth on a second channel. For an
 * internal HR tool where "within half a minute" is soon enough, one cheap
 * count query on a timer is the honest trade. The endpoint it polls returns a
 * single number, not the list.
 * =============================================================================
 */

const POLL_INTERVAL_MS = 30_000;

/** "just now", "12 min ago", "3 hours ago", "5 Nov". */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** A coloured dot per event family, so the list is scannable at a glance. */
function toneOf(type: string): string {
  if (type.endsWith('.approved') || type.endsWith('.auto_approved')) return 'bg-green-500';
  if (type.endsWith('.rejected')) return 'bg-red-500';
  if (type.endsWith('.cancelled')) return 'bg-neutral-400';
  if (type.endsWith('.unrouted')) return 'bg-orange-500';
  return 'bg-blue-500';
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // The cheap half: just the number, on a timer.
  const refreshCount = useCallback(async () => {
    try {
      const result = await api<{ unreadCount: number }>('/api/notifications/unread-count');
      setUnreadCount(result.unreadCount);
    } catch {
      // A failed poll is not worth interrupting anyone over — the next one in
      // thirty seconds will very likely succeed.
    }
  }, []);

  // The expensive half: only when the dropdown is actually opened.
  const loadList = useCallback(async () => {
    setError(null);
    try {
      const result = await api<NotificationsResponse>('/api/notifications?take=20');
      setData(result);
      setUnreadCount(result.unreadCount);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load notifications.');
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const timer = setInterval(() => void refreshCount(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  // Clicking anywhere else, or pressing Escape, closes the dropdown.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void loadList();
  }

  /**
   * Opening a notification marks it read AND follows its deep link.
   *
   * The link carries `?request=<id>`, so the destination page can highlight
   * the exact record rather than dropping the person on a list to find it
   * themselves.
   */
  async function openNotification(notification: NotificationItem) {
    setOpen(false);
    if (!notification.readAt) {
      setUnreadCount((count) => Math.max(0, count - 1));
      try {
        await api(`/api/notifications/${notification.id}/read`, { method: 'POST', body: {} });
      } catch {
        void refreshCount();
      }
    }
    if (notification.link) router.push(notification.link);
  }

  async function markAllRead() {
    setBusy(true);
    try {
      await api('/api/notifications/read-all', { method: 'POST', body: {} });
      await loadList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark everything as read.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggle}
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications, none unread'
        }
        aria-expanded={open}
        className="relative rounded-md border border-[var(--border)] px-2.5 py-1.5 transition-opacity hover:opacity-70"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] rounded-full bg-red-600 px-1 text-[11px] leading-[18px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={() => void markAllRead()}
                disabled={busy}
                className="text-xs underline underline-offset-2 hover:opacity-70 disabled:opacity-40"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {error && <p className="px-4 py-6 text-sm text-red-700 dark:text-red-400">{error}</p>}

            {!error && !data && <p className="px-4 py-6 text-sm text-[var(--muted)]">Loading…</p>}

            {data?.items.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                Nothing yet. Leave requests and decisions will appear here.
              </p>
            )}

            {data?.items.map((notification) => (
              <button
                key={notification.id}
                onClick={() => void openNotification(notification)}
                className={`flex w-full gap-3 border-b border-[var(--border)] px-4 py-3 text-left transition-colors last:border-0 hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
                  notification.readAt ? '' : 'bg-blue-50/60 dark:bg-blue-950/30'
                }`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    notification.readAt ? 'bg-transparent' : toneOf(notification.type)
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{notification.title}</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">
                    {notification.body}
                  </span>
                  <span className="mt-1 block text-[11px] text-[var(--muted)]">
                    {relativeTime(notification.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
