/**
 * useAdminApi — thin hook that exposes an apiFetch helper pre-loaded with
 * the admin API key header.  Matches the inline apiFetch pattern used across
 * the admin panel pages (affiliates.tsx, analytics.tsx, etc.).
 */
export function useAdminApi() {
  async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
    const key = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(opts?.headers as Record<string, string>),
    };
    if (key) headers["x-admin-api-key"] = key;
    const res = await fetch(url, { ...opts, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status} ${text}`);
    }
    return res;
  }

  return { apiFetch };
}
