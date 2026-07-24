/**
 * useAdminApi — thin hook that exposes an apiFetch helper authenticated via
 * the httpOnly session cookie (credentials: "include").
 *
 * The static VITE_ADMIN_API_KEY has been removed.  Authentication is now
 * handled exclusively through the internal_session cookie issued by
 * POST /api/internal/auth/login.  The adminAuth middleware on the backend
 * checks the session cookie first (Path 1) before the API key (Path 2).
 */
export function useAdminApi() {
  async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(opts?.headers as Record<string, string>),
    };
    const res = await fetch(url, { ...opts, headers, credentials: "include" });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status} ${text}`);
    }
    return res;
  }

  return { apiFetch };
}
