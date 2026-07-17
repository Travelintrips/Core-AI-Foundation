/**
 * ssrfFetchValidator.test.ts — Team 14  (P0 SSRF)
 *
 * Required test cases per remediation spec:
 *   ✓ metadata URL ditolak
 *   ✓ redirect SSRF ditolak
 *   ✓ oversized response ditolak
 *   ✓ forbidden MIME ditolak
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateAssetUrl,
  scanSvgForBlockedUrls,
  secureFetch,
} from "../ssrfFetchValidator.js";
import { RenderError } from "../errors.js";

// ── validateAssetUrl ──────────────────────────────────────────────────────────

describe("validateAssetUrl — SSRF block rules", () => {
  it("blocks localhost", () => {
    expect(() => validateAssetUrl("https://localhost/image.png")).toThrow(RenderError);
    expect(() => validateAssetUrl("https://localhost/image.png")).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("blocks 127.x loopback", () => {
    expect(() => validateAssetUrl("https://127.0.0.1/secret")).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("blocks cloud metadata endpoint 169.254.169.254", () => {
    expect(() => validateAssetUrl("https://169.254.169.254/latest/meta-data/")).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("blocks Google metadata endpoint", () => {
    expect(() => validateAssetUrl("https://metadata.google.internal/computeMetadata/v1/")).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("blocks private 10.x network", () => {
    expect(() => validateAssetUrl("https://10.0.0.1/admin")).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("blocks private 192.168.x network", () => {
    expect(() => validateAssetUrl("https://192.168.1.1/logo.png")).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("blocks private 172.16-31.x network", () => {
    expect(() => validateAssetUrl("https://172.20.0.5/internal")).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("blocks IPv6 loopback ::1", () => {
    expect(() => validateAssetUrl("https://[::1]/admin")).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("blocks non-http(s) protocol (ftp://)", () => {
    expect(() => validateAssetUrl("ftp://example.com/file.png")).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("allows a legitimate public HTTPS URL", () => {
    expect(() => validateAssetUrl("https://cdn.example.com/logo.png")).not.toThrow();
  });

  it("blocks an empty string", () => {
    expect(() => validateAssetUrl("")).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });
});

// ── scanSvgForBlockedUrls ─────────────────────────────────────────────────────

describe("scanSvgForBlockedUrls — SVG URL scanning", () => {
  it("throws SSRF_BLOCKED for http:// href in SVG", () => {
    const svg = '<svg><image href="http://example.com/img.png"/></svg>';
    expect(() => scanSvgForBlockedUrls(svg)).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("throws SSRF_BLOCKED for http:// xlink:href", () => {
    const svg = '<svg><image xlink:href="http://attacker.com/evil.png"/></svg>';
    expect(() => scanSvgForBlockedUrls(svg)).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("throws SSRF_BLOCKED for https:// URL pointing to private network", () => {
    const svg = '<svg><image href="https://192.168.1.1/internal.png"/></svg>';
    expect(() => scanSvgForBlockedUrls(svg)).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("throws SSRF_BLOCKED for metadata URL in CSS url()", () => {
    const svg = '<svg><style>rect { fill: url("https://169.254.169.254/secret"); }</style></svg>';
    expect(() => scanSvgForBlockedUrls(svg)).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("returns { urlCount: 0 } for SVG with no external URLs", () => {
    const svg = '<svg><rect width="100" height="100"/></svg>';
    const { urlCount } = scanSvgForBlockedUrls(svg);
    expect(urlCount).toBe(0);
  });

  it("returns { urlCount: 1 } for SVG with one valid https:// URL", () => {
    const svg = '<svg><image href="https://cdn.example.com/logo.png"/></svg>';
    const { urlCount } = scanSvgForBlockedUrls(svg);
    expect(urlCount).toBe(1);
  });

  it("deduplicates same URL references", () => {
    const svg = '<svg><image href="https://cdn.example.com/a.png"/><image href="https://cdn.example.com/a.png"/></svg>';
    const { urlCount } = scanSvgForBlockedUrls(svg);
    expect(urlCount).toBe(1); // same URL counted once
  });

  it("throws SSRF_BLOCKED when asset count exceeds MAX_ASSET_COUNT", () => {
    // Build SVG with 51 unique external URLs
    const refs = Array.from({ length: 51 }, (_, i) =>
      `<image href="https://cdn.example.com/img${i}.png"/>`,
    ).join("");
    const svg = `<svg>${refs}</svg>`;
    expect(() => scanSvgForBlockedUrls(svg)).toThrowError(
      expect.objectContaining({ code: "SSRF_BLOCKED" }),
    );
  });

  it("does not throw for data: URIs (not external URL)", () => {
    const svg = '<svg><image href="data:image/png;base64,abc123"/></svg>';
    expect(() => scanSvgForBlockedUrls(svg)).not.toThrow();
  });
});

// ── secureFetch ───────────────────────────────────────────────────────────────

// Mock global fetch for secureFetch tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeOkResponse(body: Buffer, headers: Record<string, string> = {}) {
  return {
    ok:     true,
    status: 200,
    headers: {
      get: (h: string) => headers[h.toLowerCase()] ?? null,
    },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}

function makeRedirectResponse(location: string, status = 301) {
  return {
    ok:     false,
    status,
    headers: {
      get: (h: string) => h.toLowerCase() === "location" ? location : null,
    },
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe("secureFetch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns buffer + mimeType for a valid public URL", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(PNG_MAGIC));
    const { buffer, mimeType } = await secureFetch("https://cdn.example.com/logo.png");
    expect(buffer).toBeInstanceOf(Buffer);
    expect(mimeType).toBe("image/png");
  });

  it("throws SSRF_BLOCKED for localhost before fetch", async () => {
    await expect(secureFetch("https://localhost/img.png")).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws SSRF_BLOCKED for metadata URL before fetch", async () => {
    await expect(secureFetch("https://169.254.169.254/latest/meta-data/")).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws SSRF_BLOCKED when redirect target is a private network (open-redirect SSRF)", async () => {
    // First response: 301 → private IP
    mockFetch.mockResolvedValueOnce(makeRedirectResponse("https://192.168.1.1/secret"));
    await expect(secureFetch("https://cdn.example.com/img.png")).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });

  it("throws SSRF_BLOCKED when redirect count exceeds limit", async () => {
    // 4 redirects in a row (limit is 3)
    const chain = (n: number): string => `https://cdn.example.com/hop${n}.png`;
    mockFetch
      .mockResolvedValueOnce(makeRedirectResponse(chain(1)))
      .mockResolvedValueOnce(makeRedirectResponse(chain(2)))
      .mockResolvedValueOnce(makeRedirectResponse(chain(3)))
      .mockResolvedValueOnce(makeRedirectResponse(chain(4)));
    await expect(secureFetch("https://cdn.example.com/start.png")).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });

  it("throws ASSET_TOO_LARGE when Content-Length exceeds maxBytes", async () => {
    mockFetch.mockResolvedValueOnce({
      ok:     true,
      status: 200,
      headers: { get: (h: string) => h.toLowerCase() === "content-length" ? "999999999" : null },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await expect(secureFetch("https://cdn.example.com/huge.png", { maxBytes: 1024 })).rejects.toMatchObject({
      code: "ASSET_TOO_LARGE",
    });
  });

  it("throws ASSET_TOO_LARGE when body exceeds maxBytes", async () => {
    const bigBuf = Buffer.alloc(2048, 0x89); // not valid PNG but large
    bigBuf[0] = 0x89; bigBuf[1] = 0x50; bigBuf[2] = 0x4e; bigBuf[3] = 0x47;
    mockFetch.mockResolvedValueOnce(makeOkResponse(bigBuf));
    await expect(secureFetch("https://cdn.example.com/img.png", { maxBytes: 512 })).rejects.toMatchObject({
      code: "ASSET_TOO_LARGE",
    });
  });

  it("throws ASSET_TYPE_INVALID for a non-image MIME (e.g. HTML)", async () => {
    const htmlBuf = Buffer.from("<!DOCTYPE html><html><body>evil</body></html>");
    mockFetch.mockResolvedValueOnce(makeOkResponse(htmlBuf));
    await expect(secureFetch("https://cdn.example.com/img.png")).rejects.toMatchObject({
      code: "ASSET_TYPE_INVALID",
    });
  });

  it("throws ASSET_FETCH_FAILED for HTTP 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(secureFetch("https://cdn.example.com/missing.png")).rejects.toMatchObject({
      code: "ASSET_FETCH_FAILED",
    });
  });

  it("throws ASSET_FETCH_TIMEOUT on AbortError", async () => {
    mockFetch.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(secureFetch("https://cdn.example.com/slow.png", { timeoutMs: 1 })).rejects.toMatchObject({
      code: "ASSET_FETCH_TIMEOUT",
    });
  });
});
