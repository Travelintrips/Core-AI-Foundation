/**
 * apiFetch — centralized session-based fetch for the admin panel.
 *
 * Session auth contract (browser requests):
 *   - credentials: "include" — sends the internal_session cookie on every request
 *   - x-admin-api-key is NEVER injected by this helper; the cookie is the
 *     sole browser credential. API key auth is for server-to-server only.
 *
 * Auth response semantics:
 *   - 401 → session expired / not logged in → callers should redirect to /login
 *     (this function does NOT redirect automatically; use useAdminApi for hooks
 *     that need automatic 401 handling)
 *   - 403 → authenticated but not authorized → show an error, do NOT logout
 *
 * Callers distinguish auth errors via the `status` property on the thrown HttpError.
 *
 * Note: FormData bodies are passed as-is (no Content-Type override — browser
 * sets multipart/form-data with boundary automatically).
 */

// ── Typed error ───────────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Returns true when the error is an HttpError with status 401 */
export function isUnauthorized(err: unknown): err is HttpError {
  return err instanceof HttpError && err.status === 401;
}

/** Returns true when the error is an HttpError with status 403 */
export function isForbidden(err: unknown): err is HttpError {
  return err instanceof HttpError && err.status === 403;
}

// ── Core helper ───────────────────────────────────────────────────────────────

/**
 * apiFetch<T> — session-based JSON fetch.
 *
 * Always uses credentials: "include" and never injects x-admin-api-key.
 * Throws HttpError on non-2xx responses; callers should catch and check `.status`.
 */
export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const hasBody =
    opts?.body != null && !(opts.body instanceof FormData);

  const res = await fetch(path, {
    ...opts,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(opts?.headers ?? {}),
      // x-admin-api-key intentionally omitted — browser auth uses session cookie only
    },
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (typeof b?.error === "string") msg = b.error;
    } catch {
      /* ignore JSON parse error — keep the generic HTTP status message */
    }
    throw new HttpError(res.status, msg);
  }

  return res.json() as Promise<T>;
}
