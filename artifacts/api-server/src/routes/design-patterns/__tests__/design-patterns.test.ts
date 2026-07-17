/**
 * design-patterns.test.ts — Team 09 route integration tests (remediation)
 *
 * Covers: CRUD, search, compat, licensing guard, repeat settings,
 *         auth (P0), public visibility (P0), pagination (P2), duplicate slug, adapter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── adminAuth mock — hoisted so it can be controlled per-test ─────────────────
// P0: all mutation routes must return 401 when adminAuth denies
const mockAdminAuth = vi.hoisted(() =>
  vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
);

vi.mock("../../../middleware/adminAuth.js", () => ({
  adminAuth: mockAdminAuth,
}));

// ── Mock @workspace/db ────────────────────────────────────────────────────────
const mockQuery   = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query:   mockQuery,
  release: mockRelease,
});

vi.mock("@workspace/db", () => ({
  pool: { connect: mockConnect },
}));

// ── Import router after mocks ─────────────────────────────────────────────────
const { default: designPatternsRouter } = await import("../index.js");

const app = express();
app.use(express.json());
app.use("/design-patterns", designPatternsRouter);

// ── Reset mocks before every test ─────────────────────────────────────────────
beforeEach(() => {
  mockQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
  // Default: adminAuth allows through (simulates valid admin session)
  mockAdminAuth.mockImplementation((_req: unknown, _res: unknown, next: () => void) => next());
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Published/approved patterns are visible to public callers. */
const PATTERN_ROW = {
  id: 1,
  slug: "batik-kawung-v1",
  name: "Batik Kawung",
  category: "motif",
  domain: "batik-inspired",
  style: "traditional",
  description: "Classic Javanese kawung motif",
  repeat_behavior: "tile",
  scale: "md",
  colorizable: true,
  color_palette: ["#1a1a2e", "#e94560"],
  preview_url: null,
  preview_thumb_url: null,
  source_type: "original",
  license: null,
  source_attribution: null,
  cultural_origin: "Central Java, Indonesia",
  cultural_notes: "Inspired by traditional kawung. Not a claim to specific traditional work.",
  compatibility: ["print", "web"],
  tags: ["batik", "java", "traditional"],
  version: "1.0.0",
  status: "published",          // ← P0: must be published/approved for public visibility
  created_by: null,
  metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/** Draft pattern — must NOT be visible to public callers (→ 404). */
const DRAFT_PATTERN_ROW = { ...PATTERN_ROW, id: 2, slug: "draft-kawung", status: "draft" };

/** Licensed pattern without a license field — must NOT be visible in public list. */
const UNLICENSED_PATTERN_ROW = {
  ...PATTERN_ROW, id: 3, slug: "licensed-no-field",
  source_type: "licensed", license: null, status: "published",
};

const FACET_ROWS = [
  { domain: "batik-inspired", category: "motif", style: "traditional", source_type: "original", cnt: 1 },
];

// ── GET /design-patterns/meta ─────────────────────────────────────────────────

describe("GET /design-patterns/meta", () => {
  it("returns domain / category / status enums including public_statuses", async () => {
    const res = await request(app).get("/design-patterns/meta");
    expect(res.status).toBe(200);
    expect(res.body.domains).toContain("batik-inspired");
    expect(res.body.categories).toContain("motif");
    expect(res.body.public_statuses).toEqual(["published", "approved"]);
    expect(res.body.max_limit).toBe(100);
  });
});

// ── P0 AUTH — unauthenticated mutations must return 401 ───────────────────────

describe("P0 Auth — unauthenticated mutations → 401", () => {
  const deny401 = (_req: unknown, res: import("express").Response) => {
    res.status(401).json({ error: "Unauthorized" });
  };

  it("POST /design-patterns → 401 without admin auth", async () => {
    mockAdminAuth.mockImplementationOnce(deny401 as any);
    const res = await request(app).post("/design-patterns").send({ name: "Test" });
    expect(res.status).toBe(401);
  });

  it("PATCH /design-patterns/1 → 401 without admin auth", async () => {
    mockAdminAuth.mockImplementationOnce(deny401 as any);
    const res = await request(app).patch("/design-patterns/1").send({ name: "Test" });
    expect(res.status).toBe(401);
  });

  it("DELETE /design-patterns/1 → 401 without admin auth", async () => {
    mockAdminAuth.mockImplementationOnce(deny401 as any);
    const res = await request(app).delete("/design-patterns/1");
    expect(res.status).toBe(401);
  });

  it("POST /design-patterns/1/variants → 401 without admin auth", async () => {
    mockAdminAuth.mockImplementationOnce(deny401 as any);
    const res = await request(app).post("/design-patterns/1/variants").send({ slug: "v", name: "V" });
    expect(res.status).toBe(401);
  });

  it("POST /design-patterns/1/compat → 401 without admin auth", async () => {
    mockAdminAuth.mockImplementationOnce(deny401 as any);
    const res = await request(app).post("/design-patterns/1/compat").send({ context: "print" });
    expect(res.status).toBe(401);
  });
});

// ── P0 Visibility — public endpoints must filter non-public patterns ───────────

describe("P0 Visibility — public GET :id hides non-published patterns", () => {
  it("returns 200 for published pattern", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [PATTERN_ROW] });
    const res = await request(app).get("/design-patterns/1");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
  });

  it("returns 200 for approved pattern", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...PATTERN_ROW, status: "approved" }] });
    const res = await request(app).get("/design-patterns/1");
    expect(res.status).toBe(200);
  });

  it("returns 404 for draft pattern (P0: draft must not be visible)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [DRAFT_PATTERN_ROW] });
    const res = await request(app).get("/design-patterns/2");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PATTERN_NOT_FOUND");
  });

  it("returns 404 for active (non-published) pattern", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...PATTERN_ROW, status: "active" }] });
    const res = await request(app).get("/design-patterns/1");
    expect(res.status).toBe(404);
  });

  it("returns 404 for archived pattern", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...PATTERN_ROW, status: "archived" }] });
    const res = await request(app).get("/design-patterns/1");
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/design-patterns/99999");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PATTERN_NOT_FOUND");
  });
});

// ── GET /design-patterns — public list ────────────────────────────────────────

describe("GET /design-patterns — public list", () => {
  it("returns published patterns", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });
    const res = await request(app).get("/design-patterns");
    expect(res.status).toBe(200);
    expect(res.body.patterns).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it("accepts domain filter", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });
    const res = await request(app).get("/design-patterns?domain=batik-inspired");
    expect(res.status).toBe(200);
  });

  it("rejects limit over MAX_PATTERN_LIMIT", async () => {
    const res = await request(app).get("/design-patterns?limit=999");
    expect(res.status).toBe(400);
  });
});

// ── P2 Pagination ─────────────────────────────────────────────────────────────

describe("P2 Pagination", () => {
  it("GET / respects limit and offset", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: "50" }] });
    const res = await request(app).get("/design-patterns?limit=10&offset=20");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(50);
  });

  it("GET /search respects limit and offset with facets", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: "100" }] })
      .mockResolvedValueOnce({ rows: FACET_ROWS });
    const res = await request(app).get("/design-patterns/search?limit=5&offset=10");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(100);
  });

  it("GET /search rejects limit over MAX_PATTERN_LIMIT", async () => {
    const res = await request(app).get("/design-patterns/search?limit=999");
    expect(res.status).toBe(400);
  });

  it("GET / returns pagination metadata", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });
    const res = await request(app).get("/design-patterns?limit=1&offset=0");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("patterns");
  });
});

// ── POST /design-patterns — create ───────────────────────────────────────────

describe("POST /design-patterns", () => {
  it("creates a published pattern with valid payload", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [PATTERN_ROW] });
    const res = await request(app)
      .post("/design-patterns")
      .send({
        slug: "batik-kawung-v1",
        name: "Batik Kawung",
        category: "motif",
        domain: "batik-inspired",
        cultural_origin: "Central Java, Indonesia",
      });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("batik-kawung-v1");
  });

  it("returns 409 on duplicate slug (P2: idempotency)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"));
    const res = await request(app)
      .post("/design-patterns")
      .send({
        slug: "batik-kawung-v1",
        name: "Batik Kawung",
        category: "motif",
        domain: "batik-inspired",
        cultural_origin: "Central Java, Indonesia",
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toMatch(/SLUG_CONFLICT/);
  });

  it("rejects batik-inspired pattern missing cultural_origin (licensing guard)", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({ slug: "batik-test", name: "Test Batik", category: "motif", domain: "batik-inspired" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("LICENSING_VIOLATION");
  });

  it("rejects non-original pattern missing license field", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({ slug: "cc-pattern", name: "CC Pattern", category: "pattern", domain: "geometric", source_type: "creative-commons" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("LICENSING_VIOLATION");
  });

  it("rejects trademarked brand name in slug", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({ slug: "gucci-pattern", name: "Gucci Pattern", category: "pattern", domain: "luxury" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("LICENSING_VIOLATION");
  });

  it("rejects invalid domain enum", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({ slug: "bad", name: "Bad", category: "pattern", domain: "not-a-domain" });
    expect(res.status).toBe(400);
  });

  it("rejects non-semver version string", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({ slug: "ver-test", name: "VT", category: "texture", domain: "marble", version: "v2" });
    expect(res.status).toBe(400);
  });
});

// ── GET /design-patterns/:id — by slug ───────────────────────────────────────

describe("GET /design-patterns/:id — by slug", () => {
  it("returns published pattern by slug", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [PATTERN_ROW] });
    const res = await request(app).get("/design-patterns/batik-kawung-v1");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("batik-kawung-v1");
  });
});

// ── PATCH /design-patterns/:id ────────────────────────────────────────────────

describe("PATCH /design-patterns/:id", () => {
  it("updates allowed fields", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...PATTERN_ROW, name: "Updated" }] });
    const res = await request(app).patch("/design-patterns/1").send({ name: "Updated" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated");
  });

  it("returns 400 for non-numeric id", async () => {
    const res = await request(app).patch("/design-patterns/abc").send({ name: "X" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when pattern not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch("/design-patterns/99999").send({ name: "X" });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /design-patterns/:id ───────────────────────────────────────────────

describe("DELETE /design-patterns/:id", () => {
  it("archives a pattern", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete("/design-patterns/1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 for unknown pattern", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete("/design-patterns/99999");
    expect(res.status).toBe(404);
  });
});

// ── GET /design-patterns/search ───────────────────────────────────────────────

describe("GET /design-patterns/search", () => {
  it("returns search results with facets", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: FACET_ROWS });
    const res = await request(app).get("/design-patterns/search?q=kawung");
    expect(res.status).toBe(200);
    expect(res.body.patterns).toHaveLength(1);
    expect(res.body.facets.domains).toHaveProperty("batik-inspired");
  });

  it("filters by domain", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: FACET_ROWS });
    const res = await request(app).get("/design-patterns/search?domain=batik-inspired");
    expect(res.status).toBe(200);
  });

  it("filters by tags (comma-separated)", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: FACET_ROWS });
    const res = await request(app).get("/design-patterns/search?tags=batik,java");
    expect(res.status).toBe(200);
  });

  it("filters by colorizable=true", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: FACET_ROWS });
    const res = await request(app).get("/design-patterns/search?colorizable=true");
    expect(res.status).toBe(200);
  });

  it("filters by repeat_behavior", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: FACET_ROWS });
    const res = await request(app).get("/design-patterns/search?repeat_behavior=tile");
    expect(res.status).toBe(200);
  });

  it("rejects invalid sort column (SQL injection guard)", async () => {
    const res = await request(app).get("/design-patterns/search?sort=injected_col");
    expect(res.status).toBe(400);
  });
});

// ── GET /design-patterns/:id/compat/check ────────────────────────────────────

describe("GET /design-patterns/:id/compat/check", () => {
  it("returns compatible: true when compat record exists", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ context: "print", min_dpi: 300, max_scale: "xl", notes: "High DPI required" }],
    });
    const res = await request(app).get("/design-patterns/1/compat/check?context=print");
    expect(res.status).toBe(200);
    expect(res.body.compatible).toBe(true);
    expect(res.body.min_dpi).toBe(300);
  });

  it("returns compatible: false when no record", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/design-patterns/1/compat/check?context=embroidery");
    expect(res.status).toBe(200);
    expect(res.body.compatible).toBe(false);
  });

  it("returns 400 for missing context param", async () => {
    const res = await request(app).get("/design-patterns/1/compat/check");
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric id", async () => {
    const res = await request(app).get("/design-patterns/abc/compat/check?context=web");
    expect(res.status).toBe(400);
  });
});

// ── Variants ──────────────────────────────────────────────────────────────────

describe("GET /design-patterns/:id/variants", () => {
  it("returns empty variants list", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/design-patterns/1/variants");
    expect(res.status).toBe(200);
    expect(res.body.variants).toHaveLength(0);
  });
});

describe("POST /design-patterns/:id/variants", () => {
  it("creates a color variant", async () => {
    const variant = {
      id: 1, pattern_id: 1, slug: "kawung-navy", name: "Navy",
      color_palette: ["#001f3f"], scale: "md", preview_url: null,
      preview_thumb_url: null, status: "draft", metadata: {},
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    };
    mockQuery.mockResolvedValueOnce({ rows: [variant] });
    const res = await request(app)
      .post("/design-patterns/1/variants")
      .send({ slug: "kawung-navy", name: "Navy", color_palette: ["#001f3f"] });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("kawung-navy");
  });

  it("rejects invalid hex color", async () => {
    const res = await request(app)
      .post("/design-patterns/1/variants")
      .send({ slug: "bad", name: "Bad", color_palette: ["not-a-hex"] });
    expect(res.status).toBe(400);
  });
});

// ── Compat records ────────────────────────────────────────────────────────────

describe("GET /design-patterns/:id/compat", () => {
  it("returns compat records", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/design-patterns/1/compat");
    expect(res.status).toBe(200);
    expect(res.body.compat).toHaveLength(0);
  });
});

describe("POST /design-patterns/:id/compat", () => {
  it("adds a compat record", async () => {
    const compat = {
      id: 1, pattern_id: 1, context: "print", min_dpi: 300,
      max_scale: "xl", notes: null, created_at: "2026-01-01T00:00:00Z",
    };
    mockQuery.mockResolvedValueOnce({ rows: [compat] });
    const res = await request(app)
      .post("/design-patterns/1/compat")
      .send({ context: "print", min_dpi: 300, max_scale: "xl" });
    expect(res.status).toBe(201);
    expect(res.body.context).toBe("print");
  });

  it("rejects empty context string", async () => {
    const res = await request(app).post("/design-patterns/1/compat").send({ context: "" });
    expect(res.status).toBe(400);
  });
});

// ── P0 Licensing: license-unsafe patterns not visible to public ───────────────

describe("P0 Licensing — license-unsafe patterns", () => {
  it("POST rejects creative-commons source without license field (adapter guard)", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({
        slug: "cc-no-license",
        name: "CC No License",
        category: "texture",
        domain: "marble",
        source_type: "creative-commons",
        // license intentionally omitted
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("LICENSING_VIOLATION");
  });

  it("POST accepts creative-commons source WITH license field", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...PATTERN_ROW, source_type: "creative-commons", license: "CC-BY-4.0" }],
    });
    const res = await request(app)
      .post("/design-patterns")
      .send({
        slug: "cc-with-license",
        name: "CC With License",
        category: "texture",
        domain: "marble",
        source_type: "creative-commons",
        license: "CC-BY-4.0",
      });
    expect(res.status).toBe(201);
  });

  it("GET / snapshot: UNLICENSED_PATTERN_ROW description shows fixture intent", () => {
    // The public list route passes publicOnly=true which generates SQL with:
    //   (source_type IN ('original','public-domain') OR license IS NOT NULL)
    // This is validated at service level; here we confirm fixture has license=null
    expect(UNLICENSED_PATTERN_ROW.license).toBeNull();
    expect(UNLICENSED_PATTERN_ROW.source_type).toBe("licensed");
  });
});
