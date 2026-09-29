'use client';

import { useEffect, useState } from 'react';

/**
 * =============================================================================
 * DEEP LINKS FROM NOTIFICATIONS
 *
 * A notification links to `/leave/approvals?request=<id>`. Landing on a list of
 * twenty requests and being left to find the right one is not "opening the
 * request" — so the page highlights that row and scrolls it into view.
 *
 * WHY window.location RATHER THAN useSearchParams
 * Next's `useSearchParams` forces the page into a Suspense boundary or the
 * production build fails on prerendering. These pages already fetch their data
 * in the browser, so reading the query string once on mount is simpler and has
 * no build-time consequences.
 * =============================================================================
 */
export function useDeepLinkTarget(param = 'request'): string | null {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    setTarget(new URLSearchParams(window.location.search).get(param));
  }, [param]);

  return target;
}

/**
 * Scrolls the highlighted row into view once the list has rendered.
 *
 * `dependency` is whatever proves the data has arrived — pass the loaded
 * response. Without it this runs before the row exists and does nothing.
 */
export function useScrollToTarget(target: string | null, dependency: unknown): void {
  useEffect(() => {
    if (!target || !dependency) return;
    // A frame's delay so the browser has actually laid the list out.
    const timer = setTimeout(() => {
      document
        .getElementById(`record-${target}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => clearTimeout(timer);
  }, [target, dependency]);
}

/** A ring around the row the notification pointed at. */
export function highlightClass(id: string, target: string | null): string {
  return id === target ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[var(--background)]' : '';
}

/** Explains the highlight, and offers a way out of it. */
export function DeepLinkNotice({ target, label }: { target: string | null; label: string }) {
  if (!target) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm dark:border-blue-900 dark:bg-blue-950">
      <span>Showing the {label} from your notification, highlighted below.</span>
      <button
        onClick={() => {
          window.history.replaceState(null, '', window.location.pathname);
          window.location.reload();
        }}
        className="shrink-0 underline underline-offset-2 hover:opacity-70"
      >
        Show everything
      </button>
    </div>
  );
}
