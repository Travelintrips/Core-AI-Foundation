/**
 * Fashion & Apparel Design — Comprehensive Tests (Team 18)
 *
 * Covers:
 *   - validatePanelConstraints, validateNumbering, validateMotifRepeat, checkTrademark
 *   - validateServiceType, validateStatus
 *   - authGuard: missing ADMIN_API_KEY → 503, not fail-open
 *   - generationGuard: rate limit, budget exceeded, duplicate/idempotent, token cap
 *   - migration: domain-unique function name (no shared function override)
 *   - fileSafety: malicious URL/SSRF, bad MIME, bad extension, oversized file
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";

// ── Domain service validators ─────────────────────────────────────────────────
import {
  validatePanelConstraints,
  validateNumbering,
  validateMotifRepeat,
  checkTrademark,
  validateServiceType,
  validateStatus,
} from "../../services/fashionDesignService.js";

// ── Auth guard ────────────────────────────────────────────────────────────────
import { fashionDesignAuthGuard, isAuthConfigured } from "./authGuard.js";

// ── Generation guard ──────────────────────────────────────────────────────────
import {
  checkGenerationAllowed,
  recordGenerationUsed,
  cacheIdempotencyResult,
  _resetGuardState,
  TUNABLES,
} from "./generationGuard.js";

// ── File safety ───────────────────────────────────────────────────────────────
import {
  validateUrl,
  validateMimeType,
  validateExtension,
  validateFileSize,
  MAX_FILE_SIZE_BYTES,
} from "./fileSafety.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mockResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; return this; },
  };
  return res as unknown as Response & typeof res;
}

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as unknown as Request;
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 1 — Core validators (already passing)
// ─────────────────────────────────────────────────────────────────────────────

describe("validatePanelConstraints", () => {
  it("passes valid panel sizes", () => {
    const result = validatePanelConstraints({
      front: { size: { w: 400, h: 600 } },
      "logo-area": { size: { w: 100, h: 100 } },
    });
    expect(result.violations).toHaveLength(0);
  });

  it("reports violation when width too small", () => {
    const result = validatePanelConstraints({ front: { size: { w: 100, h: 600 } } });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatch(/front.*width.*100px/);
  });

  it("reports violation when width too large", () => {
    const result = validatePanelConstraints({ "logo-area": { size: { w: 500, h: 100 } } });
    expect(result.violations).toHaveLength(1);
  });

  it("accumulates multiple violations", () => {
    const result = validatePanelConstraints({
      front: { size: { w: 10, h: 10 } },
      back: { size: { w: 1000, h: 1000 } },
    });
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  it("skips panels with no size", () => {
    const result = validatePanelConstraints({ front: { enabled: true } as any });
    expect(result.violations).toHaveLength(0);
  });

  it("skips unknown panels", () => {
    const result = validatePanelConstraints({ "unknown-panel": { size: { w: 1, h: 1 } } });
    expect(result.violations).toHaveLength(0);
  });
});

describe("validateNumbering", () => {
  it("passes valid jersey numbers 0–99", () => {
    expect(validateNumbering("0")).toEqual({ valid: true });
    expect(validateNumbering("10")).toEqual({ valid: true });
    expect(validateNumbering("99")).toEqual({ valid: true });
  });

  it("passes when no number provided", () => {
    expect(validateNumbering(undefined)).toEqual({ valid: true });
    expect(validateNumbering(null)).toEqual({ valid: true });
    expect(validateNumbering("")).toEqual({ valid: true });
  });

  it("fails for non-numeric value", () => {
    expect(validateNumbering("abc").valid).toBe(false);
  });

  it("fails for number > 99", () => {
    expect(validateNumbering("100").valid).toBe(false);
  });

  it("fails for negative number", () => {
    expect(validateNumbering("-1").valid).toBe(false);
  });
});

describe("validateMotifRepeat", () => {
  it("passes valid scale 0.5–10", () => {
    expect(validateMotifRepeat({ scale: 5 })).toEqual({ valid: true });
    expect(validateMotifRepeat({ scale: 10 })).toEqual({ valid: true });
    expect(validateMotifRepeat({ scale: 0.5 })).toEqual({ valid: true });
  });

  it("passes when no motif config", () => {
    expect(validateMotifRepeat(undefined)).toEqual({ valid: true });
    expect(validateMotifRepeat(null)).toEqual({ valid: true });
    expect(validateMotifRepeat({})).toEqual({ valid: true });
  });

  it("fails for scale > 10", () => {
    expect(validateMotifRepeat({ scale: 11 }).valid).toBe(false);
  });

  it("fails for scale <= 0", () => {
    expect(validateMotifRepeat({ scale: 0 }).valid).toBe(false);
  });
});

describe("checkTrademark", () => {
  it("passes clean names", () => {
    const result = checkTrademark({ orderName: "Jersey Tim Futsal Garuda 2026" });
    expect(result.safe).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it("flags Nike reference (case-insensitive)", () => {
    expect(checkTrademark({ orderName: "Nike Style Jersey" }).safe).toBe(false);
    expect(checkTrademark({ orderName: "NIKE inspired" }).safe).toBe(false);
  });

  it("flags Adidas reference", () => {
    expect(checkTrademark({ orderName: "Adidas hoodie" }).safe).toBe(false);
  });

  it("flags sports club names", () => {
    expect(checkTrademark({ sponsor_0: "Manchester United" }).safe).toBe(false);
  });

  it("accumulates multiple flags", () => {
    const result = checkTrademark({ orderName: "Nike hoodie", description: "Adidas inspired" });
    expect(result.flags.length).toBeGreaterThanOrEqual(2);
  });
});

describe("validateServiceType", () => {
  it("passes all 8 valid service types", () => {
    const valid = ["t-shirt", "jersey", "hoodie", "uniform", "jacket", "dress", "batik-inspired", "merchandise"];
    for (const t of valid) expect(() => validateServiceType(t)).not.toThrow();
  });

  it("throws for invalid type", () => {
    expect(() => validateServiceType("sneakers")).toThrow(/Invalid service type/);
  });
});

describe("validateStatus", () => {
  it("passes all valid statuses", () => {
    const valid = ["draft", "blueprint_ready", "generating", "review", "approved", "delivered", "trademark_flagged", "cancelled"];
    for (const s of valid) expect(() => validateStatus(s)).not.toThrow();
  });

  it("throws for invalid status", () => {
    expect(() => validateStatus("pending")).toThrow(/Invalid status/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 2 — P1 AUTH GUARD: missing config → 503, NOT fail-open
// ─────────────────────────────────────────────────────────────────────────────

describe("fashionDesignAuthGuard — P1 auth fail-open prevention", () => {
  const originalKey = process.env["ADMIN_API_KEY"];

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env["ADMIN_API_KEY"] = originalKey;
    } else {
      delete process.env["ADMIN_API_KEY"];
    }
  });

  it("blocks request with 503 when ADMIN_API_KEY is missing — not fail-open", () => {
    delete process.env["ADMIN_API_KEY"];

    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    fashionDesignAuthGuard(req, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect((res.body as any).code).toBe("AUTH_NOT_CONFIGURED");
  });

  it("blocks request with 503 when ADMIN_API_KEY is empty string — not fail-open", () => {
    process.env["ADMIN_API_KEY"] = "";

    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    fashionDesignAuthGuard(req, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  it("blocks in development mode too (NODE_ENV=development) — no fail-open bypass", () => {
    const origEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    delete process.env["ADMIN_API_KEY"];

    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    fashionDesignAuthGuard(req, res as unknown as Response, next as NextFunction);

    // Guard must block regardless of NODE_ENV — this is the key difference from adminAuth
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);

    process.env["NODE_ENV"] = origEnv;
  });

  it("calls next() when ADMIN_API_KEY is set", () => {
    process.env["ADMIN_API_KEY"] = "test-key-12345678";

    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    fashionDesignAuthGuard(req, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("isAuthConfigured() returns false when key missing", () => {
    delete process.env["ADMIN_API_KEY"];
    expect(isAuthConfigured()).toBe(false);
  });

  it("isAuthConfigured() returns true when key set", () => {
    process.env["ADMIN_API_KEY"] = "some-key";
    expect(isAuthConfigured()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 3 — P1 COST CONTROL: generationGuard
// ─────────────────────────────────────────────────────────────────────────────

describe("generationGuard — P1 cost controls", () => {
  beforeEach(() => _resetGuardState());

  // 3a. Rate limit
  it("blocks after exceeding max generations per hour", async () => {
    const callerId = "test-caller-rate";
    const limit = TUNABLES.FASHION_MAX_GENS_PER_HOUR;

    // Consume all slots
    for (let i = 0; i < limit; i++) {
      recordGenerationUsed(callerId);
    }

    const result = await checkGenerationAllowed({ callerId });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("rate_limited");
    expect(result.remainingGenerations).toBe(0);
  });

  it("allows generation when under the rate limit", async () => {
    const result = await checkGenerationAllowed({ callerId: "fresh-caller" });
    expect(result.allowed).toBe(true);
    expect(result.reason).not.toBe("rate_limited");
  });

  // 3b. Idempotency — duplicate request returns cached result
  it("returns cached result for duplicate idempotency key", async () => {
    const callerId = "test-idempotent";
    const key = "idem-key-abc-123";
    const fakeResult = { outputs: { test: true }, warnings: [] };

    cacheIdempotencyResult(key, fakeResult);

    const result = await checkGenerationAllowed({ callerId, idempotencyKey: key });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("duplicate");
    expect(result.cachedResult).toEqual(fakeResult);
  });

  it("allows generation for a new idempotency key", async () => {
    const result = await checkGenerationAllowed({
      callerId: "test-new-idem",
      idempotencyKey: "brand-new-unique-key",
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).not.toBe("duplicate");
  });

  // 3c. Token cap
  it("blocks when estimated input tokens exceed cap", async () => {
    const result = await checkGenerationAllowed({
      callerId: "test-token-cap",
      estimatedInputTokens: TUNABLES.FASHION_MAX_INPUT_TOKENS + 1,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("token_cap");
  });

  it("allows when estimated input tokens are within cap", async () => {
    const result = await checkGenerationAllowed({
      callerId: "test-within-cap",
      estimatedInputTokens: TUNABLES.FASHION_MAX_INPUT_TOKENS,
    });
    expect(result.allowed).toBe(true);
  });

  // 3d. Cancellation guard
  it("blocks generation for cancelled order", async () => {
    const result = await checkGenerationAllowed({
      callerId: "test-cancelled",
      orderStatus: "cancelled",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cancelled");
  });

  it("allows generation for blueprint_ready order", async () => {
    const result = await checkGenerationAllowed({
      callerId: "test-ready",
      orderStatus: "blueprint_ready",
    });
    expect(result.allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 4 — P1 MIGRATION: domain-unique function name
// ─────────────────────────────────────────────────────────────────────────────

describe("migration file — P1 domain-unique function name", () => {
  const migrationPath = path.resolve(
    process.cwd(),
    "../../integration/migrations/team-18.sql",
  );

  let sql: string;

  beforeEach(() => {
    try {
      sql = fs.readFileSync(migrationPath, "utf-8");
    } catch {
      // Also try from workspace root
      try {
        sql = fs.readFileSync(
          path.resolve(process.cwd(), "integration/migrations/team-18.sql"),
          "utf-8",
        );
      } catch {
        sql = "";
      }
    }
  });

  it("defines domain-unique function fashion_design_set_updated_at", () => {
    if (!sql) {
      // Skip if file not accessible from test runner CWD
      console.warn("Migration file not accessible — skipping migration content tests");
      return;
    }
    expect(sql).toMatch(/fashion_design_set_updated_at/);
  });

  it("does NOT define or execute the generic shared set_updated_at without domain prefix", () => {
    if (!sql) return;
    // Check only DDL lines (CREATE FUNCTION and EXECUTE FUNCTION), not SQL comments or prose
    const ddlLines = sql
      .split("\n")
      .filter((l) => {
        const upper = l.trim().toUpperCase();
        return (
          upper.startsWith("CREATE") ||
          upper.startsWith("EXECUTE") ||
          upper.includes("EXECUTE FUNCTION")
        );
      });

    for (const line of ddlLines) {
      // Any reference to set_updated_at in a DDL line MUST include the domain prefix
      if (/set_updated_at/i.test(line)) {
        expect(line).toMatch(/fashion_design_set_updated_at/i);
      }
    }
  });

  it("does NOT DROP TRIGGER on tables outside its own domain", () => {
    if (!sql) return;
    // All DROP TRIGGER statements should only reference fashion_design tables
    const dropTriggerLines = sql
      .split("\n")
      .filter((l) => l.trim().toUpperCase().startsWith("DROP TRIGGER"));

    for (const line of dropTriggerLines) {
      expect(line).toMatch(/fashion_design/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 5 — P2 FILE SAFETY
// ─────────────────────────────────────────────────────────────────────────────

describe("validateUrl — SSRF / malicious URL protection", () => {
  it("blocks localhost", () => {
    expect(validateUrl("http://localhost/evil").safe).toBe(false);
  });

  it("blocks 127.0.0.1", () => {
    expect(validateUrl("http://127.0.0.1/metadata").safe).toBe(false);
  });

  it("blocks AWS metadata endpoint", () => {
    expect(validateUrl("http://169.254.169.254/latest/meta-data").safe).toBe(false);
  });

  it("blocks 10.x.x.x private range", () => {
    expect(validateUrl("http://10.0.0.1/internal").safe).toBe(false);
  });

  it("blocks 192.168.x.x private range", () => {
    expect(validateUrl("http://192.168.1.1/admin").safe).toBe(false);
  });

  it("blocks 172.16–31.x.x private range", () => {
    expect(validateUrl("http://172.16.0.1/secret").safe).toBe(false);
    expect(validateUrl("http://172.31.255.255/secret").safe).toBe(false);
  });

  it("blocks non-http/https schemes", () => {
    expect(validateUrl("file:///etc/passwd").safe).toBe(false);
    expect(validateUrl("ftp://example.com/file").safe).toBe(false);
    expect(validateUrl("javascript:alert(1)").safe).toBe(false);
  });

  it("blocks malformed URL", () => {
    expect(validateUrl("not-a-url").safe).toBe(false);
    expect(validateUrl("").safe).toBe(false);
  });

  it("allows legitimate public HTTPS URL", () => {
    expect(validateUrl("https://example.com/logo.png").safe).toBe(true);
    expect(validateUrl("https://cdn.acme.co/assets/logo.svg").safe).toBe(true);
  });

  it("allows legitimate HTTP URL", () => {
    expect(validateUrl("http://example.com/img.jpg").safe).toBe(true);
  });
});

describe("validateMimeType — MIME allowlist", () => {
  it("allows permitted image MIME types", () => {
    expect(validateMimeType("image/jpeg").safe).toBe(true);
    expect(validateMimeType("image/png").safe).toBe(true);
    expect(validateMimeType("image/webp").safe).toBe(true);
    expect(validateMimeType("image/svg+xml").safe).toBe(true);
  });

  it("rejects executable MIME types", () => {
    expect(validateMimeType("application/javascript").safe).toBe(false);
    expect(validateMimeType("application/x-php").safe).toBe(false);
    expect(validateMimeType("text/html").safe).toBe(false);
  });

  it("rejects unknown MIME types", () => {
    expect(validateMimeType("application/octet-stream").safe).toBe(false);
    expect(validateMimeType("").safe).toBe(false);
  });

  it("handles MIME type with charset suffix", () => {
    // e.g. "image/png; charset=utf-8" → normalised to "image/png"
    expect(validateMimeType("image/png; charset=utf-8").safe).toBe(true);
  });
});

describe("validateExtension — extension allowlist", () => {
  it("allows permitted image extensions", () => {
    expect(validateExtension("logo.jpg").safe).toBe(true);
    expect(validateExtension("logo.PNG").safe).toBe(true);
    expect(validateExtension("icon.svg").safe).toBe(true);
    expect(validateExtension("banner.webp").safe).toBe(true);
  });

  it("rejects dangerous extensions", () => {
    expect(validateExtension("virus.exe").safe).toBe(false);
    expect(validateExtension("script.php").safe).toBe(false);
    expect(validateExtension("malware.bat").safe).toBe(false);
    expect(validateExtension("backdoor.sh").safe).toBe(false);
  });

  it("rejects files with no extension", () => {
    expect(validateExtension("noextension").safe).toBe(false);
  });
});

describe("validateFileSize", () => {
  it("passes file within 5 MB limit", () => {
    expect(validateFileSize(1024 * 1024).safe).toBe(true);       // 1 MB
    expect(validateFileSize(MAX_FILE_SIZE_BYTES).safe).toBe(true); // exactly 5 MB
  });

  it("rejects file exceeding 5 MB", () => {
    expect(validateFileSize(MAX_FILE_SIZE_BYTES + 1).safe).toBe(false);
    expect(validateFileSize(10 * 1024 * 1024).safe).toBe(false); // 10 MB
  });
});
