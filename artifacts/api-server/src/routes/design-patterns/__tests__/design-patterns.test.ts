/**
 * design-patterns.test.ts — Team 09 route integration tests
 *
 * Tests: CRUD, search, compatibility check, licensing guard, repeat settings.
 * Uses vitest + supertest. Mocks @workspace/db pool.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

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

// ── Mock adminAuth — path must resolve from THIS test file ────────────────────
// Test file: src/routes/design-patterns/__tests__/design-patterns.test.ts
// adminAuth: src/middleware/adminAuth.ts → relative path: ../../../middleware/adminAuth.js
vi.mock("../../../middleware/adminAuth.js", () => ({
  adminAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
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
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
  status: "active",
  created_by: null,
  metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// ── GET /design-patterns/meta ─────────────────────────────────────────────────

describe("GET /design-patterns/meta", () => {
  it("returns domain and category enums", async () => {
    const res = await request(app).get("/design-patterns/meta");
    expect(res.status).toBe(200);
    expect(res.body.domains).toContain("batik-inspired");
    expect(res.body.categories).toContain("motif");
    expect(res.body.repeat_behaviors).toContain("tile");
    expect(res.body.scales).toContain("xl");
    expect(res.body.source_types).toContain("original");
  });
});

// ── GET /design-patterns — list ───────────────────────────────────────────────

describe("GET /design-patterns", () => {
  it("returns a list of patterns", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });
    const res = await request(app).get("/design-patterns");
    expect(res.status).toBe(200);
    expect(res.body.patterns).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.patterns[0].slug).toBe("batik-kawung-v1");
  });

  it("accepts domain filter query param", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });
    const res = await request(app).get("/design-patterns?domain=batik-inspired&limit=10");
    expect(res.status).toBe(200);
  });
});

// ── POST /design-patterns — create ───────────────────────────────────────────

describe("POST /design-patterns", () => {
  it("creates a pattern with valid payload", async () => {
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

  it("rejects batik-inspired pattern missing cultural_origin (licensing guard)", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({
        slug: "batik-test",
        name: "Test Batik",
        category: "motif",
        domain: "batik-inspired",
        // cultural_origin intentionally omitted
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("LICENSING_VIOLATION");
  });

  it("rejects non-original pattern missing license field", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({
        slug: "cc-pattern",
        name: "CC Pattern",
        category: "pattern",
        domain: "geometric",
        source_type: "creative-commons",
        // license intentionally omitted
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("LICENSING_VIOLATION");
  });

  it("rejects trademarked brand names in slug", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({
        slug: "gucci-pattern",
        name: "Gucci Pattern",
        category: "pattern",
        domain: "luxury",
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("LICENSING_VIOLATION");
  });

  it("rejects invalid domain enum", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({
        slug: "bad-domain",
        name: "Bad",
        category: "pattern",
        domain: "not-a-domain",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("rejects invalid repeat_behavior", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({
        slug: "test-repeat",
        name: "Test",
        category: "texture",
        domain: "marble",
        repeat_behavior: "invalid-repeat",
      });
    expect(res.status).toBe(400);
  });

  it("rejects non-semver version string", async () => {
    const res = await request(app)
      .post("/design-patterns")
      .send({
        slug: "ver-test",
        name: "Version Test",
        category: "texture",
        domain: "marble",
        version: "v2",
      });
    expect(res.status).toBe(400);
  });
});

// ── GET /design-patterns/:id — get by id/slug ─────────────────────────────────

describe("GET /design-patterns/:id", () => {
  it("returns pattern by id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [PATTERN_ROW] });
    const res = await request(app).get("/design-patterns/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it("returns 404 for unknown id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/design-patterns/99999");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PATTERN_NOT_FOUND");
  });

  it("returns pattern by slug", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [PATTERN_ROW] });
    const res = await request(app).get("/design-patterns/batik-kawung-v1");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("batik-kawung-v1");
  });
});

// ── PATCH /design-patterns/:id — update ──────────────────────────────────────

describe("PATCH /design-patterns/:id", () => {
  it("updates allowed fields", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...PATTERN_ROW, name: "Batik Kawung Updated" }] });
    const res = await request(app)
      .patch("/design-patterns/1")
      .send({ name: "Batik Kawung Updated", status: "active" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Batik Kawung Updated");
  });

  it("returns 400 for non-numeric id", async () => {
    const res = await request(app).patch("/design-patterns/abc").send({ name: "X" });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /design-patterns/:id — archive ────────────────────────────────────

describe("DELETE /design-patterns/:id", () => {
  it("archives a pattern", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete("/design-patterns/1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 for unknown pattern id", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete("/design-patterns/99999");
    expect(res.status).toBe(404);
  });
});

// ── GET /design-patterns/search ───────────────────────────────────────────────

const FACET_ROWS = [
  { domain: "batik-inspired", category: "motif", style: "traditional", source_type: "original", cnt: 1 },
];

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

  it("filters by repeat_behavior=tile", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [PATTERN_ROW] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] })
      .mockResolvedValueOnce({ rows: FACET_ROWS });
    const res = await request(app).get("/design-patterns/search?repeat_behavior=tile");
    expect(res.status).toBe(200);
  });

  it("rejects invalid sort column", async () => {
    const res = await request(app).get("/design-patterns/search?sort=injected_col");
    expect(res.status).toBe(400);
  });

  it("respects pagination params", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/design-patterns/search?limit=5&offset=10");
    expect(res.status).toBe(200);
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

  it("returns compatible: false when no compat record", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/design-patterns/1/compat/check?context=embroidery");
    expect(res.status).toBe(200);
    expect(res.body.compatible).toBe(false);
  });

  it("returns 400 for missing context param", async () => {
    const res = await request(app).get("/design-patterns/1/compat/check");
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric pattern id", async () => {
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
      id: 1, pattern_id: 1, slug: "batik-kawung-v1-navy", name: "Navy",
      color_palette: ["#001f3f"], scale: "md", preview_url: null,
      preview_thumb_url: null, status: "active", metadata: {},
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    };
    mockQuery.mockResolvedValueOnce({ rows: [variant] });
    const res = await request(app)
      .post("/design-patterns/1/variants")
      .send({ slug: "batik-kawung-v1-navy", name: "Navy", color_palette: ["#001f3f"] });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("batik-kawung-v1-navy");
  });

  it("rejects variant with invalid hex color", async () => {
    const res = await request(app)
      .post("/design-patterns/1/variants")
      .send({ slug: "bad-color", name: "Bad", color_palette: ["not-a-hex"] });
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
    expect(res.body.min_dpi).toBe(300);
  });

  it("rejects empty context string", async () => {
    const res = await request(app)
      .post("/design-patterns/1/compat")
      .send({ context: "" });
    expect(res.status).toBe(400);
  });
});
