/**
 * useAdminApi — thin hook that exposes an apiFetch helper using session-cookie auth.
 *
 * B5B migration: removed VITE_ADMIN_API_KEY injection.  The admin panel now
 * relies exclusively on the internal_session cookie (credentials: "include").
 *
 * Auth response contract:
 *   - 401 → session expired; triggers a redirect to /login (safe, no history entry)
 *     Guard: no redirect if already on /login; concurrent 401s produce only one redirect.
 *   - 403 → authenticated but role/permission denied; thrown as HttpError(403)
 *            and must NOT trigger an automatic logout or redirect
 *   - AbortError → propagates unchanged so callers can distinguish cancelled requests
 *
 * Callers that need to distinguish auth errors can catch HttpError and inspect
 * its .status field (401 vs 403).
 */
import { HttpError } from "@/lib/apiFetch";

export { HttpError };

// Module-level flag: prevents multiple concurrent 401 responses from each
// triggering their own window.location.replace call.  Reset naturally on
// page reload (i.e. after the redirect lands on /login).
let redirectingToLogin = false;

export function useAdminApi() {
  /**
   * apiFetch — sends the session cookie, never an API key header.
   *
   * On 401: redirects to /login (session expired) — unless already on /login
   *         or another 401 already triggered a redirect this session.
   * On 403: throws HttpError(403) — callers must show an error, not logout.
   * On other errors: throws HttpError with the HTTP status code.
   * AbortError: propagates unchanged (not caught here).
   */
  async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
    const hasBody =
      opts?.body != null && !(opts.body instanceof FormData);

    const headers: Record<string, string> = {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(opts?.headers as Record<string, string> | undefined),
      // x-admin-api-key intentionally omitted — browser auth uses session cookie only
    };

    const res = await fetch(url, {
      ...opts,
      credentials: "include",
      headers,
    });

    if (!res.ok) {
      // 401 — session expired or not logged in
      if (res.status === 401) {
        if (
          typeof window !== "undefined" &&
          !redirectingToLogin &&
          window.location.pathname !== "/login"
        ) {
          redirectingToLogin = true;
          // replace() avoids adding the failed URL to browser history
          window.location.replace("/login");
        }
        const text = await res.text().catch(() => res.statusText);
        throw new HttpError(401, text || "Unauthorized");
      }

      // 403 — authenticated but not authorized; do NOT redirect
      const text = await res.text().catch(() => res.statusText);
      throw new HttpError(res.status, text || res.statusText);
    }

    return res;
  }

  return { apiFetch };
}
