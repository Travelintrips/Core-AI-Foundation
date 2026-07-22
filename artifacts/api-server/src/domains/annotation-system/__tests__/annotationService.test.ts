/**
 * annotationService.test.ts — Team 18 / Annotation Service
 *
 * Required tests: 5 (create pin), 6 (create rectangle), 8 (resolve),
 *   9 (reopen), 11 (version anchoring), 12 (frame anchoring), 13 (selected annotation)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── db mock must be hoisted before any imports that reference @workspace/db ──
vi.mock("@workspace/db", () => {
  const mockDb = {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  };
  return { db: mockDb, aiAnnotationsTable: {}, aiAnnotationCommentsTable: {} };
});

import { db } from "@workspace/db";
import {
  createAnnotation,
  getAnnotation,
  listAnnotations,
  resolveAnnotation,
  reopenAnnotation,
} from "../annotationService.js";
import type { AnnotationActorContext, CreateAnnotationInput } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const adminCtx: AnnotationActorContext = {
  tenantId:        "default",
  actorId:         "admin-1",
  actorName:       "Admin User",
  authorType:      "admin",
  isPlatformAdmin: true,
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id:             1,
    tenantId:       "default",
    artifactId:     "project-abc",
    artifactType:   "creative_project",
    versionId:      null,
    frameId:        null,
    annotationType: "point_pin",
    geometry:       { type: "point_pin", nx: 0.5, ny: 0.5 },
    elementId:      null,
    title:          null,
    description:    null,
    status:         "open",
    priority:       "normal",
    assigneeId:     null,
    assigneeName:   null,
    createdBy:      "admin-1",
    createdByName:  "Admin User",
    authorType:     "admin",
    isDeleted:      false,
    deletedAt:      null,
    metadata:       null,
    createdAt:      new Date("2026-01-01T00:00:00Z"),
    updatedAt:      new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// Fluent mock builder for drizzle chains
function mockInsertChain(row: ReturnType<typeof makeRow>) {
  const chain = { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([row]) };
  (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

function mockSelectChain(rows: ReturnType<typeof makeRow>[]) {
  // Chain must be thenable so that patterns ending at .where() (getAnnotation)
  // and patterns ending at .offset() (listAnnotations) both resolve correctly.
  const chain = {
    from:    vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    limit:   vi.fn().mockReturnThis(),
    offset:  vi.fn().mockResolvedValue(rows),
    then(
      onFulfilled: (v: ReturnType<typeof makeRow>[]) => unknown,
      onRejected: (e: unknown) => unknown,
    ) {
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

function mockUpdateChain(row: ReturnType<typeof makeRow>) {
  const chain = {
    set:       vi.fn().mockReturnThis(),
    where:     vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([row]),
  };
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Test 5: create pin ───────────────────────────────────────────────────────

describe("createAnnotation — point_pin", () => {
  it("creates a point_pin with normalized coordinates", async () => {
    const row = makeRow({ annotationType: "point_pin" });
    mockInsertChain(row);

    const input: CreateAnnotationInput = {
      artifactId:     "project-abc",
      artifactType:   "creative_project",
      annotationType: "point_pin",
      geometry:       { type: "point_pin", nx: 0.5, ny: 0.5 },
      priority:       "normal",
    };
    const result = await createAnnotation(input, adminCtx);

    expect(result.annotationType).toBe("point_pin");
    expect(result.geometry.nx).toBeCloseTo(0.5);
    expect(result.geometry.ny).toBeCloseTo(0.5);
    expect(result.status).toBe("open");
  });

  it("sets actor identity from context, not from input", async () => {
    const row = makeRow({ createdBy: "admin-1", createdByName: "Admin User" });
    const chain = mockInsertChain(row);

    await createAnnotation(
      { artifactId: "x", artifactType: "t", annotationType: "point_pin", geometry: { type: "point_pin", nx: 0.1, ny: 0.1 }, priority: "normal" },
      adminCtx,
    );

    const valuesCall = chain.values.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(valuesCall?.["createdBy"]).toBe("admin-1");
    expect(valuesCall?.["createdByName"]).toBe("Admin User");
  });

  it("rejects invalid geometry (out-of-range)", async () => {
    await expect(
      createAnnotation(
        { artifactId: "x", artifactType: "t", annotationType: "point_pin", geometry: { type: "point_pin", nx: 2.0, ny: 0.5 }, priority: "normal" },
        adminCtx,
      ),
    ).rejects.toThrow(/geometry/i);
  });
});

// ─── Test 6: create rectangle ─────────────────────────────────────────────────

describe("createAnnotation — rectangle", () => {
  it("creates a rectangle annotation with width and height", async () => {
    const row = makeRow({
      annotationType: "rectangle",
      geometry: { type: "rectangle", nx: 0.1, ny: 0.2, nw: 0.4, nh: 0.3 },
    });
    mockInsertChain(row);

    const result = await createAnnotation(
      {
        artifactId:     "project-abc",
        artifactType:   "creative_project",
        annotationType: "rectangle",
        geometry:       { type: "rectangle", nx: 0.1, ny: 0.2, nw: 0.4, nh: 0.3 },
        priority:       "normal",
      },
      adminCtx,
    );

    expect(result.annotationType).toBe("rectangle");
    expect(result.geometry.nw).toBeCloseTo(0.4);
    expect(result.geometry.nh).toBeCloseTo(0.3);
  });

  it("rejects a zero-area rectangle", async () => {
    await expect(
      createAnnotation(
        {
          artifactId:     "x",
          artifactType:   "t",
          annotationType: "rectangle",
          geometry:       { type: "rectangle", nx: 0.1, ny: 0.1, nw: 0, nh: 0 },
          priority:       "normal",
        },
        adminCtx,
      ),
    ).rejects.toThrow(/geometry/i);
  });
});

// ─── Test 8: resolve ──────────────────────────────────────────────────────────

describe("resolveAnnotation", () => {
  it("transitions open annotation to resolved", async () => {
    const openRow     = makeRow({ status: "open" });
    const resolvedRow = makeRow({ status: "resolved" });

    // getAnnotation select → open row
    mockSelectChain([openRow]);
    // update → resolved row
    mockUpdateChain(resolvedRow);

    const result = await resolveAnnotation(1, adminCtx);
    expect(result.status).toBe("resolved");
  });

  it("refuses to resolve an already-resolved annotation", async () => {
    mockSelectChain([makeRow({ status: "resolved" })]);
    await expect(resolveAnnotation(1, adminCtx)).rejects.toThrow(/cannot resolve/i);
  });

  it("refuses to resolve an archived annotation", async () => {
    mockSelectChain([makeRow({ status: "archived" })]);
    await expect(resolveAnnotation(1, adminCtx)).rejects.toThrow(/cannot resolve/i);
  });
});

// ─── Test 9: reopen ───────────────────────────────────────────────────────────

describe("reopenAnnotation", () => {
  it("transitions resolved annotation to reopened", async () => {
    const resolvedRow = makeRow({ status: "resolved" });
    const reopenedRow = makeRow({ status: "reopened" });

    mockSelectChain([resolvedRow]);
    mockUpdateChain(reopenedRow);

    const result = await reopenAnnotation(1, adminCtx);
    expect(result.status).toBe("reopened");
  });

  it("refuses to reopen an open annotation", async () => {
    mockSelectChain([makeRow({ status: "open" })]);
    await expect(reopenAnnotation(1, adminCtx)).rejects.toThrow(/cannot reopen/i);
  });
});

// ─── Test 11: version anchoring ───────────────────────────────────────────────

describe("version anchoring", () => {
  it("stores and retrieves versionId on an annotation", async () => {
    const row = makeRow({ versionId: "v-20260101-abc" });
    mockInsertChain(row);

    const result = await createAnnotation(
      {
        artifactId:     "project-abc",
        artifactType:   "creative_project",
        versionId:      "v-20260101-abc",
        annotationType: "point_pin",
        geometry:       { type: "point_pin", nx: 0.3, ny: 0.3 },
        priority:       "normal",
      },
      adminCtx,
    );

    expect(result.versionId).toBe("v-20260101-abc");
  });

  it("filters list by versionId", async () => {
    const rows = [makeRow({ versionId: "v-001" }), makeRow({ id: 2, versionId: "v-001" })];
    mockSelectChain(rows);

    const results = await listAnnotations({ versionId: "v-001", limit: 50, offset: 0, includeDeleted: false }, "default");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.versionId === "v-001")).toBe(true);
  });
});

// ─── Test 12: frame anchoring ─────────────────────────────────────────────────

describe("frame anchoring", () => {
  it("stores and retrieves frameId on an annotation", async () => {
    const row = makeRow({ frameId: "page-3" });
    mockInsertChain(row);

    const result = await createAnnotation(
      {
        artifactId:     "project-abc",
        artifactType:   "creative_project",
        frameId:        "page-3",
        annotationType: "point_pin",
        geometry:       { type: "point_pin", nx: 0.5, ny: 0.5 },
        priority:       "normal",
      },
      adminCtx,
    );

    expect(result.frameId).toBe("page-3");
  });

  it("filters list by frameId", async () => {
    mockSelectChain([makeRow({ frameId: "slide-1" })]);
    const results = await listAnnotations({ frameId: "slide-1", limit: 50, offset: 0, includeDeleted: false }, "default");
    expect(results[0]?.frameId).toBe("slide-1");
  });
});

// ─── Test 13: selected annotation (filter by status) ─────────────────────────

describe("listAnnotations — status filter", () => {
  it("returns only open annotations when status=open", async () => {
    const rows = [makeRow({ status: "open" }), makeRow({ id: 2, status: "open" })];
    mockSelectChain(rows);

    const results = await listAnnotations({ status: "open", limit: 50, offset: 0, includeDeleted: false }, "default");
    expect(results.every((r) => r.status === "open")).toBe(true);
  });

  it("returns empty array when no annotations match", async () => {
    mockSelectChain([]);
    const results = await listAnnotations({ status: "resolved", limit: 50, offset: 0, includeDeleted: false }, "default");
    expect(results).toHaveLength(0);
  });
});
