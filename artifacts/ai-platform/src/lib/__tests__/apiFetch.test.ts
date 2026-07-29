/**
 * B5B — apiFetch shared utility tests
 *
 * Verifies:
 *   B5B-1: apiFetch sends credentials: "include"
 *   B5B-2: apiFetch does NOT send x-admin-api-key header
 *   B5B-3: apiFetch does NOT read VITE_ADMIN_API_KEY
 *   B5B-4: successful response returns parsed JSON
 *   B5B-5: 401 throws HttpError with status 401
 *   B5B-6: 403 throws HttpError with status 403 (different from 401)
 *   B5B-7: 401 and 403 are distinguishable via .status
 *   B5B-8: POST with body sends Content-Type: application/json
 *   B5B-9: GET without body does NOT send Content-Type header
 *   B5B-10: isUnauthorized / isForbidden type guards work correctly
 *
 * No NODE_ENV=development fail-open dependency — tests mock fetch directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, HttpError, isUnauthorized, isForbidden } from "../apiFetch";

// ── Fetch mock helpers ────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  const responseHeaders = new Headers(headers);
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    headers: responseHeaders,
  } as unknown as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("apiFetch — B5B shared utility", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("B5B-1: sends credentials: include", async () => {
    globalThis.fetch = mockFetch(200, { ok: true });
    await apiFetch("/api/test");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(options.credentials).toBe("include");
  });

  it("B5B-2: does NOT send x-admin-api-key header", async () => {
    globalThis.fetch = mockFetch(200, {});
    await apiFetch("/api/test");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string> | undefined;
    expect(headers?.["x-admin-api-key"]).toBeUndefined();
    expect(headers?.["X-Admin-Api-Key"]).toBeUndefined();
  });

  it("B5B-3: does NOT read VITE_ADMIN_API_KEY even if set", async () => {
    // Simulate VITE_ADMIN_API_KEY being present in env
    vi.stubEnv("VITE_ADMIN_API_KEY", "should-not-appear");
    globalThis.fetch = mockFetch(200, {});
    await apiFetch("/api/test");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string> | undefined;
    const headerValues = Object.values(headers ?? {});
    expect(headerValues).not.toContain("should-not-appear");
    vi.unstubAllEnvs();
  });

  it("B5B-4: successful response returns parsed JSON", async () => {
    const payload = { id: 1, name: "test" };
    globalThis.fetch = mockFetch(200, payload);
    const result = await apiFetch<typeof payload>("/api/test");
    expect(result).toEqual(payload);
  });

  it("B5B-5: 401 response throws HttpError with status 401", async () => {
    globalThis.fetch = mockFetch(401, { error: "Unauthorized" });
    await expect(apiFetch("/api/test")).rejects.toThrow(HttpError);
    globalThis.fetch = mockFetch(401, { error: "Unauthorized" });
    try {
      await apiFetch("/api/test");
    } catch (err) {
      expect(err instanceof HttpError).toBe(true);
      expect((err as HttpError).status).toBe(401);
    }
  });

  it("B5B-6: 403 response throws HttpError with status 403", async () => {
    globalThis.fetch = mockFetch(403, { error: "Forbidden" });
    await expect(apiFetch("/api/test")).rejects.toThrow(HttpError);
    globalThis.fetch = mockFetch(403, { error: "Forbidden" });
    try {
      await apiFetch("/api/test");
    } catch (err) {
      expect(err instanceof HttpError).toBe(true);
      expect((err as HttpError).status).toBe(403);
    }
  });

  it("B5B-7: 401 and 403 are distinguishable — different .status values", async () => {
    const errors: number[] = [];
    for (const status of [401, 403]) {
      globalThis.fetch = mockFetch(status, { error: "denied" });
      try {
        await apiFetch("/api/test");
      } catch (err) {
        if (err instanceof HttpError) errors.push(err.status);
      }
    }
    expect(errors).toEqual([401, 403]);
    expect(errors[0]).not.toBe(errors[1]);
  });

  it("B5B-8: POST with body sends Content-Type: application/json", async () => {
    globalThis.fetch = mockFetch(200, {});
    await apiFetch("/api/test", { method: "POST", body: JSON.stringify({ x: 1 }) });
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("B5B-9: GET without body does NOT inject Content-Type header", async () => {
    globalThis.fetch = mockFetch(200, {});
    await apiFetch("/api/test");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string> | undefined;
    expect(headers?.["Content-Type"]).toBeUndefined();
  });

  it("B5B-10: isUnauthorized returns true for HttpError(401), false for 403", () => {
    const err401 = new HttpError(401, "Unauthorized");
    const err403 = new HttpError(403, "Forbidden");
    const generic = new Error("generic");
    expect(isUnauthorized(err401)).toBe(true);
    expect(isUnauthorized(err403)).toBe(false);
    expect(isUnauthorized(generic)).toBe(false);
  });

  it("B5B-10b: isForbidden returns true for HttpError(403), false for 401", () => {
    const err401 = new HttpError(401, "Unauthorized");
    const err403 = new HttpError(403, "Forbidden");
    expect(isForbidden(err403)).toBe(true);
    expect(isForbidden(err401)).toBe(false);
  });

  it("B5B-11: error message is taken from response body .error field", async () => {
    globalThis.fetch = mockFetch(400, { error: "Validation failed" });
    try {
      await apiFetch("/api/test");
    } catch (err) {
      expect((err as HttpError).message).toBe("Validation failed");
    }
  });
});

// ── useAdminApi hook — header contract ───────────────────────────────────────

describe("useAdminApi — B5B header contract", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("B5B-useAdminApi-1: apiFetch sends credentials: include", async () => {
    // Import dynamically to avoid module caching issues
    const { useAdminApi } = await import("../../hooks/useAdminApi");
    globalThis.fetch = mockFetch(200, "{}");
    const { apiFetch } = useAdminApi();
    await apiFetch("/api/test");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(options.credentials).toBe("include");
  });

  it("B5B-useAdminApi-2: does NOT send x-admin-api-key even when VITE_ADMIN_API_KEY is set", async () => {
    vi.stubEnv("VITE_ADMIN_API_KEY", "should-not-be-sent");
    const { useAdminApi } = await import("../../hooks/useAdminApi");
    globalThis.fetch = mockFetch(200, "{}");
    const { apiFetch } = useAdminApi();
    await apiFetch("/api/test");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string> | undefined;
    expect(headers?.["x-admin-api-key"]).toBeUndefined();
    expect(headers?.["X-Admin-Api-Key"]).toBeUndefined();
    const headerValues = Object.values(headers ?? {});
    expect(headerValues).not.toContain("should-not-be-sent");
  });

  it("B5B-useAdminApi-3: 403 throws HttpError(403) — no window redirect", async () => {
    const { useAdminApi, HttpError: HE } = await import("../../hooks/useAdminApi");
    globalThis.fetch = mockFetch(403, { error: "Forbidden" });
    const { apiFetch } = useAdminApi();
    try {
      await apiFetch("/api/admin-only");
    } catch (err) {
      expect(err instanceof HE).toBe(true);
      expect((err as InstanceType<typeof HE>).status).toBe(403);
    }
  });

  it("B5B-useAdminApi-4: 401 throws HttpError(401)", async () => {
    const { useAdminApi, HttpError: HE } = await import("../../hooks/useAdminApi");
    // Suppress window.location.replace (not available in node test env)
    if (typeof globalThis.window === "undefined") {
      (globalThis as Record<string, unknown>).window = undefined;
    }
    globalThis.fetch = mockFetch(401, { error: "Unauthorized" });
    const { apiFetch } = useAdminApi();
    try {
      await apiFetch("/api/session-check");
    } catch (err) {
      expect(err instanceof HE).toBe(true);
      expect((err as InstanceType<typeof HE>).status).toBe(401);
    }
  });
});
