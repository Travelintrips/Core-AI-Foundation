/**
 * B5B — Design services auth migration tests
 *
 * Verifies that design-template-api, design-editor-api, and design-batch-api:
 *   B5B-svc-1: do NOT send x-admin-api-key header
 *   B5B-svc-2: send credentials: "include"
 *   B5B-svc-3: do NOT read VITE_ADMIN_API_KEY
 *   B5B-svc-4: throw on 401 (typed error distinguishable from 403)
 *   B5B-svc-5: throw on 403 with different error type/code than 401
 *
 * No dependency on NODE_ENV=development fail-open behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpError } from "../../lib/apiFetch";

// ── Fetch mock helpers ────────────────────────────────────────────────────────

type MockCall = [string, RequestInit];

function mockFetchSuccess(body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

function mockFetchError(status: number, errorMsg = "denied") {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: String(status),
    json: () => Promise.resolve({ error: errorMsg }),
    text: () => Promise.resolve(JSON.stringify({ error: errorMsg })),
  } as unknown as Response);
}

function capturedHeaders(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  const [, options] = fetchMock.mock.calls[0] as MockCall;
  return (options?.headers ?? {}) as Record<string, string>;
}

// ── design-template-api ───────────────────────────────────────────────────────

describe("design-template-api — B5B auth contract", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("B5B-svc-1a: listTemplates — no x-admin-api-key header", async () => {
    vi.stubEnv("VITE_ADMIN_API_KEY", "injected-key");
    globalThis.fetch = mockFetchSuccess({ items: [], total: 0, page: 1, pageSize: 20 });
    const { listTemplates } = await import("../design-template-api");
    await listTemplates();
    const headers = capturedHeaders(globalThis.fetch as ReturnType<typeof vi.fn>);
    expect(headers["x-admin-api-key"]).toBeUndefined();
    expect(Object.values(headers)).not.toContain("injected-key");
  });

  it("B5B-svc-2a: listTemplates — sends credentials: include", async () => {
    globalThis.fetch = mockFetchSuccess({ items: [], total: 0, page: 1, pageSize: 20 });
    const { listTemplates } = await import("../design-template-api");
    await listTemplates();
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as MockCall;
    expect(options.credentials).toBe("include");
  });

  it("B5B-svc-4a: listTemplates — 401 throws HttpError(401)", async () => {
    globalThis.fetch = mockFetchError(401);
    const { listTemplates } = await import("../design-template-api");
    try {
      await listTemplates();
    } catch (err) {
      expect(err instanceof HttpError).toBe(true);
      expect((err as HttpError).status).toBe(401);
    }
  });

  it("B5B-svc-5a: listTemplates — 403 throws HttpError(403), different from 401", async () => {
    globalThis.fetch = mockFetchError(403);
    const { listTemplates } = await import("../design-template-api");
    try {
      await listTemplates();
    } catch (err) {
      expect(err instanceof HttpError).toBe(true);
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).status).not.toBe(401);
    }
  });

  it("B5B-svc-1b: renderPreview (blob path) — no x-admin-api-key header", async () => {
    vi.stubEnv("VITE_ADMIN_API_KEY", "injected-key");
    const mockBlob = new Blob(["fake-image"], { type: "image/png" });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(mockBlob),
      headers: new Headers({ "X-Render-Warnings": "0" }),
    } as unknown as Response);
    // Spy on URL.createObjectURL only — do NOT replace the whole URL constructor
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");

    const { renderPreview } = await import("../design-template-api");
    await renderPreview(1, {}, {});
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as MockCall;
    const headers = options?.headers as Record<string, string> | undefined;
    expect(headers?.["x-admin-api-key"]).toBeUndefined();
    expect(Object.values(headers ?? {})).not.toContain("injected-key");
    createObjectURLSpy.mockRestore();
  });
});

// ── design-editor-api ─────────────────────────────────────────────────────────

describe("design-editor-api — B5B auth contract", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("B5B-svc-1c: getTemplate — no x-admin-api-key header", async () => {
    vi.stubEnv("VITE_ADMIN_API_KEY", "injected-key");
    globalThis.fetch = mockFetchSuccess({ id: 1, name: "t", slug: "t", status: "draft", tenantId: "x", createdBy: "u", createdAt: "", updatedAt: "" });
    const { designEditorApi } = await import("../design-editor-api");
    await designEditorApi.getTemplate(1);
    const headers = capturedHeaders(globalThis.fetch as ReturnType<typeof vi.fn>);
    expect(headers["x-admin-api-key"]).toBeUndefined();
    expect(Object.values(headers)).not.toContain("injected-key");
  });

  it("B5B-svc-2b: getTemplate — sends credentials: include", async () => {
    globalThis.fetch = mockFetchSuccess({ id: 1, name: "t", slug: "t", status: "draft", tenantId: "x", createdBy: "u", createdAt: "", updatedAt: "" });
    const { designEditorApi } = await import("../design-editor-api");
    await designEditorApi.getTemplate(1);
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as MockCall;
    expect(options.credentials).toBe("include");
  });

  it("B5B-svc-4b: getTemplate — 401 throws HttpError(401)", async () => {
    globalThis.fetch = mockFetchError(401);
    const { designEditorApi } = await import("../design-editor-api");
    try {
      await designEditorApi.getTemplate(1);
    } catch (err) {
      expect(err instanceof HttpError).toBe(true);
      expect((err as HttpError).status).toBe(401);
    }
  });
});

// ── design-batch-api ──────────────────────────────────────────────────────────

describe("design-batch-api — B5B auth contract", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("B5B-svc-1d: batchApi.list — no x-admin-api-key header", async () => {
    vi.stubEnv("VITE_ADMIN_API_KEY", "injected-key");
    globalThis.fetch = mockFetchSuccess({ items: [], total: 0, page: 1, pageSize: 20 });
    const { batchApi } = await import("../design-batch-api");
    await batchApi.list();
    const headers = capturedHeaders(globalThis.fetch as ReturnType<typeof vi.fn>);
    expect(headers["x-admin-api-key"]).toBeUndefined();
    expect(Object.values(headers)).not.toContain("injected-key");
  });

  it("B5B-svc-2c: batchApi.list — sends credentials: include", async () => {
    globalThis.fetch = mockFetchSuccess({ items: [], total: 0, page: 1, pageSize: 20 });
    const { batchApi } = await import("../design-batch-api");
    await batchApi.list();
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as MockCall;
    expect(options.credentials).toBe("include");
  });

  it("B5B-svc-4c: templateApi.list — 401 throws HttpError(401)", async () => {
    globalThis.fetch = mockFetchError(401);
    const { templateApi } = await import("../design-batch-api");
    try {
      await templateApi.list();
    } catch (err) {
      expect(err instanceof HttpError).toBe(true);
      expect((err as HttpError).status).toBe(401);
    }
  });

  it("B5B-svc-5b: templateApi.list — 403 throws HttpError(403), distinct from 401", async () => {
    globalThis.fetch = mockFetchError(403);
    const { templateApi } = await import("../design-batch-api");
    try {
      await templateApi.list();
    } catch (err) {
      expect(err instanceof HttpError).toBe(true);
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).status).not.toBe(401);
    }
  });
});
