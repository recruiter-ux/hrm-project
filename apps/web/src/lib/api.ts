const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Turns the API's error body into something worth showing a person.
 *
 * NestJS validation failures arrive as `{ message: string[] }`; everything
 * else as `{ message: string }`. Both are flattened here so callers never have
 * to care which they got.
 */
async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiError(response.status, `Request failed (HTTP ${response.status}).`);
  }

  const message = (body as { message?: unknown }).message;

  if (Array.isArray(message)) {
    return new ApiError(response.status, message[0] ?? 'Validation failed.', message as string[]);
  }
  if (typeof message === 'string') {
    return new ApiError(response.status, message);
  }
  return new ApiError(response.status, `Request failed (HTTP ${response.status}).`);
}

/**
 * Shared promise for an in-flight token refresh.
 *
 * Without this, a page that fires five requests at once would trigger five
 * refreshes — and because refresh tokens ROTATE, four of them would present an
 * already-revoked token and log the user out. Everyone waits on the same one.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers all observe the same
      // result before a fresh attempt becomes possible.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Internal: prevents an infinite refresh loop. */
  _isRetry?: boolean;
}

/**
 * The single way the app talks to the API.
 *
 * `credentials: 'include'` is essential — the auth tokens are httpOnly cookies
 * and the browser only attaches them cross-origin when this is set.
 *
 * On a 401 it silently refreshes the token once and retries. The user only
 * sees a login redirect if that refresh also fails.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, _isRetry, headers, ...rest } = options;

  const isFormData = body instanceof FormData;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && !_isRetry && !path.startsWith('/api/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, { ...options, _isRetry: true });
  }

  if (!response.ok) throw await toApiError(response);

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Builds a download URL. The browser sends the auth cookie automatically. */
export function downloadUrl(documentId: string): string {
  return `${API_URL}/api/documents/${documentId}/download`;
}

export { API_URL };
