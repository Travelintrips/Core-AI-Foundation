/**
 * Team 13 — Dynamic Design Composition Engine
 * Route-level security, idempotency, and terminal-state tests.
 *
 * Covers per remediation rules:
 *  P1 SECURITY
 *  - unauthorized request (missing/wrong admin key → 401)
 *  - malformed payload (invalid JSON structure → 400 with details)
 *  - missing required fields (empty body → 400)
 *  - valid minimal request (200)
 *  - extra unknown fields (stripped, not rejected)
 *
 *  P1 TERMINAL STATE (route layer)
 *  - completed session → 200 with idempotent:true, no reprocess
 *  - cancelled session → 409
 *  - failed session, no retry → 409
 *  - failed session, allowRetry=true → 200 (retry allowed)
 *  - processing session → 409
 *
 *  P1 IDOR (route layer)
 *  - tenant A session not accessible with tenant B header → 404
 *  - missing tenantId when idempotencyKey given → 400
 *
 *  P2 IDEMPOTENCY
 *  - identical idempotencyKey + tenantId → returns existing result
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import dynamicDesignComposerRouter from "../index.js";
import { clearStore, createSession, transitionSession } from "../../../services/dynamic-design-composer/compositionSessionStore.js";
import type { DesignCompositionSpec } from "../../../services/dynamic-design-composer/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_KEY = "test-admin-key-team13";

const VALID_COMPOSE_BODY = {
  blueprint: {
    name: "12-col",
    columns: 12,
    rows: 0,
    gutter: 24,
    maxWidth: 1280,
    orientation: "portrait",
    medium: "digital",
  },
  layoutPlan: {
    name: "Hero",
    strategy: "hero-content",
    flow: "vertical",
    heroWeight: 0.4,
    sectionCount: 3,
    hasSidebar: false,
    emphasis: "balanced",
  },
  components: [],
  pattern: {
    name: "None",
    type: "none",
    intensity: 0,
    placement: "background",
    tile: false,
  },
  palette: {
    name: "Blue",
    primary: "#1E3A5F",
    secondary: "#2D6A9F",
    accent: "#F4A261",
    background: "#FFFFFF",
    surface: "#F8F9FA",
    text: "#1A1A2E",
    textMuted: "#6C757D",
    mood: "neutral",
  },
  typography: {
    name: "Inter",
    headingFont: "Inter",
    bodyFont: "Inter",
    headingWeight: "700",
    bodyWeight: "400",
    baseSize: 16,
    scaleRatio: 1.25,
    lineHeight: 1.6,
    letterSpacing: "normal",
    style: "sans-serif",
  },
  decoration: {
    name: "Clean",
    borderRadius: "medium",
    borderStyle: "none",
    shadowDepth: "low",
    dividerStyle: "line",
    useGradients: false,
    overlayOpacity: 0,
  },
  material: {
    name: "Flat",
    surface: "flat",
    texture: "smooth",
    elevation: "low",
    opacity: "solid",
    blendMode: "normal",
  },
  motif: {
    name: "Abstract",
    theme: "abstract",
    repetition: "none",
    scale: "small",
    colorTreatment: "monochrome",
  },
};

const VALID_COMPATIBILITY_BODY = {
  material: VALID_COMPOSE_BODY.material,
  pattern: VALID_COMPOSE_BODY.pattern,
  palette: VALID_COMPOSE_BODY.palette,
  decoration: VALID_COMPOSE_BODY.decoration,
};

function buildTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Simulate global adminAuth (matches production middleware)
  app.use((req, res, next) => {
    const PUBLIC_PREFIXES = ["/ai/composer/health"];
    const isPublic = PUBLIC_PREFIXES.some((p) => req.path.startsWith(p));
    if (isPublic) return next();

    const key =
      req.headers["x-admin-api-key"] ||
      (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (key !== ADMIN_KEY) {
      return res.status(401).json({ error: "Unauthorized: invalid or missing admin API key" });
    }
    return next();
  });

  app.use(dynamicDesignComposerRouter);
  return app;
}

// ── Test setup ────────────────────────────────────────────────────────────────

let app: Express;
beforeAll(() => {
  app = buildTestApp();
});
beforeEach(() => {
  clearStore();
});

// ── POST /ai/composer/compose — auth ──────────────────────────────────────────

describe("POST /ai/composer/compose — authorization", () => {
  it("returns 401 when admin key is missing", async () => {
    const res = await request(app).post("/ai/composer/compose").send(VALID_COMPOSE_BODY);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it("returns 401 when admin key is wrong", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", "wrong-key")
      .send(VALID_COMPOSE_BODY);
    expect(res.status).toBe(401);
  });
});

// ── POST /ai/composer/compose — input validation ───────────────────────────────

describe("POST /ai/composer/compose — input validation", () => {
  it("returns 400 when body is empty", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
  });

  it("returns 400 when required fields have wrong types", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ blueprint: "not-an-object", layoutPlan: 42 });
    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/blueprint|layoutPlan/i);
  });

  it("returns 400 when palette has an invalid hex color", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, palette: { ...VALID_COMPOSE_BODY.palette, primary: "not-a-color" } });
    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/primary/i);
  });

  it("returns 400 when idempotencyKey is provided without tenantId", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: "key-without-tenant" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when idempotencyKey contains invalid characters", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: "key with spaces!", tenantId: "t1" });
    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/idempotencyKey/i);
  });

  it("returns 200 and valid compositionId with correct key", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send(VALID_COMPOSE_BODY);
    expect(res.status).toBe(200);
    expect(typeof res.body.compositionId).toBe("string");
    expect(res.body.compositionId).toHaveLength(64);
    expect(res.body.version).toBe("1.0");
  });

  it("is deterministic — same input produces same compositionId", async () => {
    const res1 = await request(app).post("/ai/composer/compose").set("X-Admin-Api-Key", ADMIN_KEY).send(VALID_COMPOSE_BODY);
    const res2 = await request(app).post("/ai/composer/compose").set("X-Admin-Api-Key", ADMIN_KEY).send(VALID_COMPOSE_BODY);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.compositionId).toBe(res2.body.compositionId);
  });

  it("accepts unknown extra fields without error (passthrough)", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, unknownField: "ignored" });
    expect(res.status).toBe(200);
  });
});

// ── POST /ai/composer/compose — terminal state guards (P1) ────────────────────

describe("POST /ai/composer/compose — terminal state guards", () => {
  const TENANT = "tenant-terminal-tests";
  const IKEY = "ikey-terminal";

  function seedSession(state: "completed" | "failed" | "cancelled" | "processing") {
    createSession(TENANT, IKEY);
    if (state === "processing") {
      transitionSession(TENANT, IKEY, "processing");
      return;
    }
    transitionSession(TENANT, IKEY, "processing");
    if (state === "cancelled") {
      transitionSession(TENANT, IKEY, "cancelled");
    } else if (state === "failed") {
      transitionSession(TENANT, IKEY, "failed", { failureReason: "previous timeout" });
    } else {
      // completed — need a spec; use a real compose result
      const result = { compositionId: "seed-id", version: "1.0" } as unknown as DesignCompositionSpec;
      transitionSession(TENANT, IKEY, "completed", { result });
    }
  }

  it("completed → returns 200 with idempotent:true (no reprocess)", async () => {
    seedSession("completed");
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: IKEY, tenantId: TENANT });
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    // Returns the cached spec, not a fresh one
    expect(res.body.compositionId).toBe("seed-id");
  });

  it("completed → never re-executes compose (returns same cached result)", async () => {
    seedSession("completed");
    const res1 = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: IKEY, tenantId: TENANT });
    const res2 = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: IKEY, tenantId: TENANT });
    expect(res1.body.idempotent).toBe(true);
    expect(res2.body.idempotent).toBe(true);
    expect(res1.body.compositionId).toBe(res2.body.compositionId);
  });

  it("cancelled → 409 CANCELLED", async () => {
    seedSession("cancelled");
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: IKEY, tenantId: TENANT });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CANCELLED");
  });

  it("failed without allowRetry → 409 FAILED_NO_RETRY", async () => {
    seedSession("failed");
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: IKEY, tenantId: TENANT, allowRetry: false });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("FAILED_NO_RETRY");
  });

  it("failed with allowRetry=true → 200 (official retry path)", async () => {
    seedSession("failed");
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: IKEY, tenantId: TENANT, allowRetry: true });
    expect(res.status).toBe(200);
    // Not an idempotent return — this is a fresh composition
    expect(res.body.idempotent).toBeUndefined();
  });

  it("processing (concurrent) → 409 IN_PROGRESS", async () => {
    seedSession("processing");
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: IKEY, tenantId: TENANT });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IN_PROGRESS");
  });
});

// ── POST /ai/composer/compose — IDOR (P1) ─────────────────────────────────────

describe("POST /ai/composer/compose — IDOR cross-tenant protection", () => {
  const TENANT_A = "tenant-A-idor";
  const TENANT_B = "tenant-B-idor";
  const SHARED_IKEY = "shared-idempotency-key";

  it("tenant B cannot access tenant A's completed session via body tenantId", async () => {
    // Seed a completed session for tenant A
    createSession(TENANT_A, SHARED_IKEY);
    transitionSession(TENANT_A, SHARED_IKEY, "processing");
    transitionSession(TENANT_A, SHARED_IKEY, "completed", {
      result: { compositionId: "tenant-A-secret", version: "1.0" } as unknown as DesignCompositionSpec,
    });

    // Tenant B uses the same key — must NOT get tenant A's result
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: SHARED_IKEY, tenantId: TENANT_B });

    // Should proceed as a fresh composition for tenant B, not return tenant A's cached spec
    expect(res.status).toBe(200);
    expect(res.body.compositionId).not.toBe("tenant-A-secret");
    expect(res.body.idempotent).toBeUndefined();
  });

  it("X-Tenant-Id header takes priority over body tenantId for ownership scoping", async () => {
    createSession(TENANT_A, "header-priority-key");
    transitionSession(TENANT_A, "header-priority-key", "processing");
    transitionSession(TENANT_A, "header-priority-key", "completed", {
      result: { compositionId: "cached-A", version: "1.0" } as unknown as DesignCompositionSpec,
    });

    // Header says tenant-B, body says tenant-A — header wins
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .set("X-Tenant-Id", TENANT_B)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: "header-priority-key", tenantId: TENANT_A });

    // Should be a fresh compose for tenant-B, not the cached result for tenant-A
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBeUndefined();
  });

  it("missing tenantId with idempotencyKey → 400 (not a 500 or data leak)", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ ...VALID_COMPOSE_BODY, idempotencyKey: "needs-tenant-id" });
    expect(res.status).toBe(400);
  });
});

// ── GET /ai/composer/sessions/:key — IDOR (P1) ────────────────────────────────

describe("GET /ai/composer/sessions/:key — IDOR protection", () => {
  const OWNER = "owner-tenant";
  const ATTACKER = "attacker-tenant";
  const KEY = "protected-session-key";

  beforeEach(() => {
    clearStore();
    createSession(OWNER, KEY);
    transitionSession(OWNER, KEY, "processing");
    transitionSession(OWNER, KEY, "completed", {
      result: { compositionId: "owner-secret", version: "1.0" } as unknown as DesignCompositionSpec,
    });
  });

  it("returns 401 without admin key", async () => {
    const res = await request(app)
      .get(`/ai/composer/sessions/${KEY}`)
      .set("X-Tenant-Id", OWNER);
    expect(res.status).toBe(401);
  });

  it("returns 400 when X-Tenant-Id header is missing", async () => {
    const res = await request(app)
      .get(`/ai/composer/sessions/${KEY}`)
      .set("X-Admin-Api-Key", ADMIN_KEY);
    expect(res.status).toBe(400);
  });

  it("returns 200 for the owner tenant", async () => {
    const res = await request(app)
      .get(`/ai/composer/sessions/${KEY}`)
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .set("X-Tenant-Id", OWNER);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("completed");
    expect(res.body.result.compositionId).toBe("owner-secret");
  });

  it("returns 404 for attacker tenant — same key, different tenant", async () => {
    const res = await request(app)
      .get(`/ai/composer/sessions/${KEY}`)
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .set("X-Tenant-Id", ATTACKER);
    // 404 — indistinguishable from "not found" to avoid leaking existence
    expect(res.status).toBe(404);
  });

  it("returns 404 for nonexistent key", async () => {
    const res = await request(app)
      .get("/ai/composer/sessions/no-such-key")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .set("X-Tenant-Id", OWNER);
    expect(res.status).toBe(404);
  });
});

// ── POST /ai/composer/validate ────────────────────────────────────────────────

describe("POST /ai/composer/validate", () => {
  it("returns 401 when admin key is missing", async () => {
    const res = await request(app).post("/ai/composer/validate").send(VALID_COMPOSE_BODY);
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid=false and errors for empty body", async () => {
    const res = await request(app)
      .post("/ai/composer/validate")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.errors).toBeDefined();
  });

  it("returns 200 with valid=true and fallback preview for valid input", async () => {
    const res = await request(app)
      .post("/ai/composer/validate")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send(VALID_COMPOSE_BODY);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(Array.isArray(res.body.fallbackPreview)).toBe(true);
    expect(res.body.summary.brandDnaProvided).toBe(false);
  });
});

// ── POST /ai/composer/compatibility ───────────────────────────────────────────

describe("POST /ai/composer/compatibility", () => {
  it("returns 401 when admin key is missing", async () => {
    const res = await request(app).post("/ai/composer/compatibility").send(VALID_COMPATIBILITY_BODY);
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is missing required fields", async () => {
    const res = await request(app)
      .post("/ai/composer/compatibility")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({ material: VALID_COMPOSE_BODY.material });
    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
  });

  it("returns 200 with compatibility report for valid input", async () => {
    const res = await request(app)
      .post("/ai/composer/compatibility")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send(VALID_COMPATIBILITY_BODY);
    expect(res.status).toBe(200);
    expect(typeof res.body.score).toBe("number");
    expect(res.body.score).toBeGreaterThanOrEqual(0);
    expect(res.body.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(typeof res.body.materialPatternCompatible).toBe("boolean");
    expect(typeof res.body.layoutComponentCompatible).toBe("boolean");
    expect(typeof res.body.paletteTypographyCompatible).toBe("boolean");
    expect(typeof res.body.decorationMaterialCompatible).toBe("boolean");
  });
});

// ── GET /ai/composer/health ───────────────────────────────────────────────────

describe("GET /ai/composer/health", () => {
  it("returns 200 without any auth key (public endpoint)", async () => {
    const res = await request(app).get("/ai/composer/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("dynamic-design-composer");
    expect(res.body.team).toBe("team-13");
  });
});
