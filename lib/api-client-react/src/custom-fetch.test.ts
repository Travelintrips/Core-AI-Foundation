/**
 * custom-fetch — unit tests
 *
 * B1 focus: verify that `credentials: "include"` is forwarded so session
 * cookies are attached to every API request, and that an explicit caller
 * value is never overridden.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { customFetch, setAuthTokenGetter, setBaseUrl } from "./custom-fetch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

// ---------------------------------------------------------------------------
// B1 — credentials: "include" default
// ---------------------------------------------------------------------------

describe("customFetch — credentials", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setAuthTokenGetter(null);
    setBaseUrl(null);
  });

  it('sends credentials:"include" by default so session cookies are forwarded', async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: true }));

    await customFetch("/api/test");

    expect(spy).toHaveBeenCalledOnce();
    const [, init] = spy.mock.calls[0]!;
    expect((init as RequestInit).credentials).toBe("include");
  });

  it('does not override credentials when caller explicitly passes "omit"', async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(emptyResponse(204));

    await customFetch("/api/test", { credentials: "omit" });

    const [, init] = spy.mock.calls[0]!;
    expect((init as RequestInit).credentials).toBe("omit");
  });

  it('does not override credentials when caller explicitly passes "same-origin"', async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(emptyResponse(204));

    await customFetch("/api/test", { credentials: "same-origin" });

    const [, init] = spy.mock.calls[0]!;
    expect((init as RequestInit).credentials).toBe("same-origin");
  });

  it('sends credentials:"include" alongside a bearer token when authTokenGetter is set', async () => {
    setAuthTokenGetter(() => "tok-abc");
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: "ok" }));

    await customFetch("/api/secure");

    const [, init] = spy.mock.calls[0]!;
    const headers = new Headers((init as RequestInit).headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer tok-abc");
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("still sends credentials on POST requests with a JSON body", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ id: 1 }, 201));

    await customFetch("/api/resource", {
      method: "POST",
      body: JSON.stringify({ name: "test" }),
    });

    const [, init] = spy.mock.calls[0]!;
    expect((init as RequestInit).credentials).toBe("include");
  });
});
