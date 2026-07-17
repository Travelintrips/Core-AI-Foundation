/**
 * Team 13 — Dynamic Design Composition Engine
 * Route-level security and contract tests.
 *
 * Covers per remediation rules:
 *  - unauthorized request (missing/wrong admin key → 401)
 *  - malformed payload (invalid JSON structure → 400 with details)
 *  - missing required fields (empty body → 400)
 *  - valid minimal request (200)
 *  - extra unknown fields (stripped, not rejected — passthrough)
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import dynamicDesignComposerRouter from "../index.js";

// ── Minimal valid payload ─────────────────────────────────────────────────────

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

// ── Test app setup ────────────────────────────────────────────────────────────

const ADMIN_KEY = "test-admin-key-team13";

/**
 * Build a minimal Express app that replicates the real app's auth middleware.
 * The production app applies adminAuth globally in app.ts; we simulate it here
 * so route tests exercise the real security boundary.
 */
function buildTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Simulate global adminAuth middleware (matches adminAuthWithExceptions pattern)
  app.use((req, res, next) => {
    // Public exceptions mirrored from the real adminAuth config
    const PUBLIC_PREFIXES = ["/ai/composer/health"];
    const isPublic = PUBLIC_PREFIXES.some((p) => req.path.startsWith(p));
    if (isPublic) {
      return next();
    }

    const key =
      req.headers["x-admin-api-key"] ||
      (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (key !== ADMIN_KEY) {
      return res.status(401).json({
        error: "Unauthorized: invalid or missing admin API key",
      });
    }
    return next();
  });

  app.use(dynamicDesignComposerRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /ai/composer/compose", () => {
  let app: Express;
  beforeAll(() => {
    app = buildTestApp();
  });

  it("returns 401 when admin key is missing", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .send(VALID_COMPOSE_BODY);
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

  it("returns 400 when body is empty", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
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
      .send({
        ...VALID_COMPOSE_BODY,
        palette: { ...VALID_COMPOSE_BODY.palette, primary: "not-a-color" },
      });
    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/primary/i);
  });

  it("returns 200 and a valid compositionId with correct key", async () => {
    const res = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send(VALID_COMPOSE_BODY);
    expect(res.status).toBe(200);
    expect(typeof res.body.compositionId).toBe("string");
    expect(res.body.compositionId).toHaveLength(64); // SHA-256 hex
    expect(res.body.version).toBe("1.0");
  });

  it("is deterministic — same input produces same compositionId", async () => {
    const res1 = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send(VALID_COMPOSE_BODY);
    const res2 = await request(app)
      .post("/ai/composer/compose")
      .set("X-Admin-Api-Key", ADMIN_KEY)
      .send(VALID_COMPOSE_BODY);
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

// ── POST /ai/composer/validate ────────────────────────────────────────────────

describe("POST /ai/composer/validate", () => {
  let app: Express;
  beforeAll(() => {
    app = buildTestApp();
  });

  it("returns 401 when admin key is missing", async () => {
    const res = await request(app)
      .post("/ai/composer/validate")
      .send(VALID_COMPOSE_BODY);
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
  let app: Express;
  beforeAll(() => {
    app = buildTestApp();
  });

  it("returns 401 when admin key is missing", async () => {
    const res = await request(app)
      .post("/ai/composer/compatibility")
      .send(VALID_COMPATIBILITY_BODY);
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
    // CompatibilityReport has four dimension booleans, not a single `compatible`
    expect(typeof res.body.materialPatternCompatible).toBe("boolean");
    expect(typeof res.body.layoutComponentCompatible).toBe("boolean");
    expect(typeof res.body.paletteTypographyCompatible).toBe("boolean");
    expect(typeof res.body.decorationMaterialCompatible).toBe("boolean");
  });
});

// ── GET /ai/composer/health ───────────────────────────────────────────────────

describe("GET /ai/composer/health", () => {
  let app: Express;
  beforeAll(() => {
    app = buildTestApp();
  });

  it("returns 200 without any auth key (public endpoint)", async () => {
    const res = await request(app).get("/ai/composer/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("dynamic-design-composer");
    expect(res.body.team).toBe("team-13");
  });
});
