/**
 * canonicalEventService.test.ts — V4.0C Canonical Runtime Event Model
 *
 * Tests the pure projection functions (no DB required) and the DB-backed
 * query functions (DB mocked). Covers:
 *   ✓ Step events: all statuses (queued, started, completed, failed, blocked)
 *   ✓ Worker events: derived from same step rows (assigned, started, completed, failed)
 *   ✓ Artifact events: all statuses
 *   ✓ Review events: history reconstructed from timestamp columns
 *   ✓ Project events: created, workflow_started, completed, failed
 *   ✓ Duplicate detection: deterministic eventId (same row + status = same id)
 *   ✓ Missing event: no events produced for empty data
 *   ✓ Ordering: events sorted by createdAt
 *   ✓ Security: metadata never contains banned fields (prompt/key/trace/error)
 *   ✓ Security: worker events and step events never expose internal error detail
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ───────────────────────────────────────────────────────────────────
// getEventsForProject fires 4 parallel db.select() chains. We feed them via a
// per-test queue, popped in Promise.all resolution order:
//   [0] creativeProjectsTable  rows
//   [1] creativeProjectStepsTable rows
//   [2] creativeAiAssetsTable  rows
//   [3] creativeAiClientReviewsTable rows

let resultQueue: unknown[][] = [];

function makeChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  const noop = () => chain;
  chain["from"]    = noop;
  chain["where"]   = noop;
  chain["orderBy"] = noop;
  chain["limit"]   = noop;
  chain["then"]    = (resolve: (v: unknown[]) => void) => Promise.resolve(resolve(result));
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeChain(resultQueue.shift() ?? [])),
  },
  creativeProjectsTable:          { id: "id", projectId: "projectId", status: "status", createdAt: "createdAt", updatedAt: "updatedAt" },
  creativeProjectStepsTable:      { id: "id", projectId: "projectId", stepName: "stepName", status: "status", provider: "provider", model: "model", tokenUsage: "tokenUsage", latencyMs: "latencyMs", createdAt: "createdAt", updatedAt: "updatedAt" },
  creativeAiAssetsTable:          { id: "id", projectId: "projectId", stepId: "stepId", assetType: "assetType", status: "status", qcScore: "qcScore", latencyMs: "latencyMs", createdAt: "createdAt" },
  creativeAiClientReviewsTable:   { id: "id", projectId: "projectId", status: "status", sharedAt: "sharedAt", viewedAt: "viewedAt", approvedAt: "approvedAt", rejectedAt: "rejectedAt", revisionRequestedAt: "revisionRequestedAt", revokedAt: "revokedAt", createdAt: "createdAt" },
}));

import {
  projectStep,
  projectAsset,
  projectReview,
  projectProjectRow,
  filterForActivityFeed,
  getEventsForProject,
  CANONICAL_EVENT_TYPES,
  type RawStepRow,
  type RawAssetRow,
  type RawReviewRow,
  type RawProjectRow,
  type CanonicalEvent,
} from "../canonicalEventService.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-01-01T01:00:00Z");

function makeStep(overrides: Partial<RawStepRow> = {}): RawStepRow {
  return {
    id:         1,
    projectId:  42,
    stepName:   "Brand Strategy",
    status:     "completed",
    provider:   "openai",
    model:      "gpt-4o",
    tokenUsage: 1200,
    latencyMs:  3200,
    createdAt:  T0,
    updatedAt:  T1,
    ...overrides,
  };
}

function makeAsset(overrides: Partial<RawAssetRow> = {}): RawAssetRow {
  return {
    id:        10,
    projectId: "proj-uuid",
    stepId:    null,
    assetType: "image",
    status:    "completed",
    qcScore:   88,
    latencyMs: 4500,
    createdAt: T0,
    ...overrides,
  };
}

function makeReview(overrides: Partial<RawReviewRow> = {}): RawReviewRow {
  return {
    id:                  5,
    projectId:           "proj-uuid",
    status:              "approved",
    sharedAt:            T0,
    viewedAt:            T1,
    approvedAt:          new Date("2026-01-01T02:00:00Z"),
    rejectedAt:          null,
    revisionRequestedAt: null,
    revokedAt:           null,
    createdAt:           T0,
    ...overrides,
  };
}

function makeProject(overrides: Partial<RawProjectRow> = {}): RawProjectRow {
  return {
    id:        42,
    projectId: "proj-uuid",
    status:    "running",
    createdAt: T0,
    updatedAt: T1,
    ...overrides,
  };
}

beforeEach(() => {
  resultQueue = [];
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Step events
// ─────────────────────────────────────────────────────────────────────────────

describe("projectStep", () => {
  it("completed step emits: step.started, worker.started, step.completed, worker.completed", () => {
    const events = projectStep("proj-uuid", makeStep({ status: "completed" }), 0, 4);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("step.started");
    expect(types).toContain("worker.started");
    expect(types).toContain("step.completed");
    expect(types).toContain("worker.completed");
    expect(events).toHaveLength(4);
  });

  it("running step emits: step.started, worker.started (no terminal events)", () => {
    const events = projectStep("proj-uuid", makeStep({ status: "running" }), 0, 4);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("step.started");
    expect(types).toContain("worker.started");
    expect(types).not.toContain("step.completed");
    expect(events).toHaveLength(2);
  });

  it("pending step emits: step.queued, worker.assigned", () => {
    const events = projectStep("proj-uuid", makeStep({ status: "pending" }), 0, 4);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("step.queued");
    expect(types).toContain("worker.assigned");
    expect(events).toHaveLength(2);
  });

  it("failed step emits: step.started, worker.started, step.failed, worker.failed", () => {
    const events = projectStep("proj-uuid", makeStep({ status: "failed" }), 1, 4);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("step.started");
    expect(types).toContain("step.failed");
    expect(types).toContain("worker.failed");
    expect(events).toHaveLength(4);
  });

  it("blocked_by_budget step emits only step.blocked (no worker events)", () => {
    const events = projectStep("proj-uuid", makeStep({ status: "blocked_by_budget" }), 2, 4);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("step.blocked");
    expect(types).not.toContain("worker.started");
    expect(types).not.toContain("worker.assigned");
    expect(events).toHaveLength(1);
  });

  it("start event uses createdAt; terminal event uses updatedAt", () => {
    const events = projectStep("proj-uuid", makeStep({ status: "completed", createdAt: T0, updatedAt: T1 }), 0, 4);
    const start   = events.find((e) => e.eventType === "step.started")!;
    const terminal = events.find((e) => e.eventType === "step.completed")!;
    expect(start.createdAt).toBe(T0.toISOString());
    expect(terminal.createdAt).toBe(T1.toISOString());
  });

  it("eventId is deterministic — same input always produces same id", () => {
    const step = makeStep({ id: 7, status: "completed" });
    const a = projectStep("proj-uuid", step, 0, 4);
    const b = projectStep("proj-uuid", step, 0, 4);
    expect(a.map((e) => e.eventId)).toEqual(b.map((e) => e.eventId));
  });

  it("progress increases with step index and completion", () => {
    const s0start = projectStep("p", makeStep({ status: "running" }),   0, 4).find((e) => e.eventType === "step.started")!;
    const s0done  = projectStep("p", makeStep({ status: "completed" }), 0, 4).find((e) => e.eventType === "step.completed")!;
    const s3done  = projectStep("p", makeStep({ status: "completed" }), 3, 4).find((e) => e.eventType === "step.completed")!;
    expect(s0done.progress).toBeGreaterThan(s0start.progress);
    expect(s3done.progress).toBeGreaterThan(s0done.progress);
    expect(s3done.progress).toBeLessThanOrEqual(80);
  });

  it("metadata NEVER contains prompt, output, errorMessage, stack trace, system prompt, API key", () => {
    const events = projectStep("p", makeStep({ status: "failed" }), 0, 4);
    for (const e of events) {
      const keys = Object.keys(e.metadata);
      expect(keys).not.toContain("prompt");
      expect(keys).not.toContain("systemPrompt");
      expect(keys).not.toContain("output");
      expect(keys).not.toContain("errorMessage");
      expect(keys).not.toContain("error");
      expect(keys).not.toContain("apiKey");
      expect(keys).not.toContain("input");
      expect(keys).not.toContain("reasoning");
    }
  });

  it("publicMessage is customer-safe (no technical internals)", () => {
    const events = projectStep("p", makeStep({ status: "failed" }), 0, 4);
    for (const e of events) {
      expect(e.publicMessage).not.toMatch(/openai/i);
      expect(e.publicMessage).not.toMatch(/gpt-/i);
      expect(e.publicMessage).not.toMatch(/error:/i);
      expect(e.publicMessage).not.toMatch(/exception/i);
      expect(e.publicMessage).not.toMatch(/stack/i);
    }
  });

  it("all events reference the correct projectId", () => {
    const events = projectStep("my-project-id", makeStep({ status: "completed" }), 0, 4);
    for (const e of events) {
      expect(e.projectId).toBe("my-project-id");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Artifact events
// ─────────────────────────────────────────────────────────────────────────────

describe("projectAsset", () => {
  it.each([
    ["pending",        "artifact.queued"],
    ["generating",     "artifact.generating"],
    ["completed",      "artifact.created"],
    ["failed",         "artifact.failed"],
    ["approved",       "artifact.approved"],
    ["needs_revision", "artifact.revision_requested"],
    ["rejected",       "artifact.failed"],
  ])("status %s → eventType %s", (status, expectedType) => {
    const evt = projectAsset(makeAsset({ status }));
    expect(evt).not.toBeNull();
    expect(evt!.eventType).toBe(expectedType);
  });

  it("returns null for unknown status", () => {
    expect(projectAsset(makeAsset({ status: "unknown_status" }))).toBeNull();
  });

  it("eventId is deterministic", () => {
    const asset = makeAsset({ id: 99, status: "completed" });
    expect(projectAsset(asset)!.eventId).toBe("asset:99:completed");
  });

  it("metadata contains assetType and assetId but no prompt/output/error", () => {
    const evt = projectAsset(makeAsset({ status: "completed" }))!;
    expect(evt.metadata.assetType).toBe("image");
    expect(evt.metadata.assetId).toBe(10);
    expect(Object.keys(evt.metadata)).not.toContain("prompt");
    expect(Object.keys(evt.metadata)).not.toContain("errorMessage");
  });

  it("severity is error for failed artifacts", () => {
    expect(projectAsset(makeAsset({ status: "failed" }))!.severity).toBe("error");
  });

  it("severity is warning for needs_revision artifacts", () => {
    expect(projectAsset(makeAsset({ status: "needs_revision" }))!.severity).toBe("warning");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Review events
// ─────────────────────────────────────────────────────────────────────────────

describe("projectReview", () => {
  it("approved review with full history emits 3 events in timestamp order", () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T01:00:00Z");
    const t2 = new Date("2026-01-01T02:00:00Z");
    const events = projectReview(makeReview({ sharedAt: t0, viewedAt: t1, approvedAt: t2 }));
    expect(events).toHaveLength(3);
    expect(events[0].eventType).toBe("review.requested");
    expect(events[1].eventType).toBe("review.started");
    expect(events[2].eventType).toBe("review.approved");
  });

  it("revision requested emits review.revision_requested with warning severity", () => {
    const events = projectReview(makeReview({
      sharedAt: T0,
      viewedAt: T1,
      revisionRequestedAt: new Date("2026-01-01T02:00:00Z"),
      approvedAt: null,
    }));
    const rev = events.find((e) => e.eventType === "review.revision_requested")!;
    expect(rev).toBeDefined();
    expect(rev.severity).toBe("warning");
  });

  it("review with no timestamps produces no events", () => {
    const events = projectReview(makeReview({
      sharedAt: null, viewedAt: null, approvedAt: null,
      revisionRequestedAt: null, revokedAt: null, rejectedAt: null,
    }));
    expect(events).toHaveLength(0);
  });

  it("eventIds are deterministic per review id and action", () => {
    const a = projectReview(makeReview({ id: 7 }));
    const b = projectReview(makeReview({ id: 7 }));
    expect(a.map((e) => e.eventId)).toEqual(b.map((e) => e.eventId));
  });

  it("all review events reference the correct projectId", () => {
    const events = projectReview(makeReview({ projectId: "my-proj" }));
    for (const e of events) {
      expect(e.projectId).toBe("my-proj");
    }
  });

  it("metadata contains reviewId but no customer data or internal secrets", () => {
    const events = projectReview(makeReview());
    for (const e of events) {
      expect(e.metadata.reviewId).toBe(5);
      expect(Object.keys(e.metadata)).not.toContain("clientEmail");
      expect(Object.keys(e.metadata)).not.toContain("tokenHash");
      expect(Object.keys(e.metadata)).not.toContain("prompt");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Project-level events
// ─────────────────────────────────────────────────────────────────────────────

describe("projectProjectRow", () => {
  it("pending project emits only project.created", () => {
    const events = projectProjectRow(makeProject({ status: "pending" }));
    const types = events.map((e) => e.eventType);
    expect(types).toContain("project.created");
    expect(types).not.toContain("project.completed");
    expect(types).not.toContain("project.failed");
    expect(events).toHaveLength(1);
  });

  it("running project emits project.created + project.workflow_started", () => {
    const events = projectProjectRow(makeProject({ status: "running" }));
    const types = events.map((e) => e.eventType);
    expect(types).toContain("project.created");
    expect(types).toContain("project.workflow_started");
  });

  it("completed project emits project.created + project.completed", () => {
    const events = projectProjectRow(makeProject({ status: "completed" }));
    const types = events.map((e) => e.eventType);
    expect(types).toContain("project.completed");
    expect(events.find((e) => e.eventType === "project.completed")!.progress).toBe(100);
  });

  it("failed project emits project.created + project.failed with error severity", () => {
    const events = projectProjectRow(makeProject({ status: "failed" }));
    const failed = events.find((e) => e.eventType === "project.failed")!;
    expect(failed.severity).toBe("error");
  });

  it("eventId is deterministic", () => {
    const a = projectProjectRow(makeProject({ id: 99, status: "running" }));
    const b = projectProjectRow(makeProject({ id: 99, status: "running" }));
    expect(a.map((e) => e.eventId)).toEqual(b.map((e) => e.eventId));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Activity feed filter
// ─────────────────────────────────────────────────────────────────────────────

describe("filterForActivityFeed", () => {
  it("keeps user-relevant events and drops internal worker chatter", () => {
    const events: CanonicalEvent[] = [
      { eventType: "step.completed", eventId: "a" } as CanonicalEvent,
      { eventType: "worker.started", eventId: "b" } as CanonicalEvent,
      { eventType: "worker.completed", eventId: "c" } as CanonicalEvent,
      { eventType: "review.approved", eventId: "d" } as CanonicalEvent,
    ];
    const filtered = filterForActivityFeed(events);
    expect(filtered.map((e) => e.eventId)).toEqual(["a", "d"]);
  });

  it("allows all expected activity-feed types through", () => {
    const feedTypes = [
      "project.created", "project.workflow_started", "project.completed",
      "project.failed", "step.completed", "step.failed", "step.blocked",
      "artifact.created", "artifact.approved", "artifact.revision_requested",
      "review.requested", "review.started", "review.approved", "review.revision_requested",
    ] as const;
    const events: CanonicalEvent[] = feedTypes.map((t) => ({ eventType: t, eventId: t } as CanonicalEvent));
    const filtered = filterForActivityFeed(events);
    expect(filtered).toHaveLength(feedTypes.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEventsForProject (DB-backed — mocked)
// ─────────────────────────────────────────────────────────────────────────────

describe("getEventsForProject", () => {
  it("returns chronologically sorted events from all sources", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T01:00:00Z");
    const t2 = new Date("2026-01-01T02:00:00Z");
    const t3 = new Date("2026-01-01T03:00:00Z");

    resultQueue = [
      // creative_projects
      [{ id: 42, projectId: "proj-uuid", status: "completed", createdAt: t0, updatedAt: t3 }],
      // creative_project_steps
      [makeStep({ id: 1, status: "completed", createdAt: t1, updatedAt: t2 })],
      // creative_ai_assets  (empty)
      [],
      // creative_ai_client_reviews (empty)
      [],
    ];

    const events = await getEventsForProject("proj-uuid", 42);

    // All events must be sorted ascending by createdAt
    for (let i = 1; i < events.length; i++) {
      expect(events[i].createdAt >= events[i - 1].createdAt).toBe(true);
    }

    // Must contain project, step, and worker events
    const types = new Set(events.map((e) => e.eventType));
    expect(types.has("project.created")).toBe(true);
    expect(types.has("step.started")).toBe(true);
    expect(types.has("step.completed")).toBe(true);
  });

  it("returns empty array when all source tables are empty", async () => {
    resultQueue = [[], [], [], []];
    const events = await getEventsForProject("proj-uuid", 42);
    expect(events).toHaveLength(0);
  });

  it("includes review events reconstructed from timestamp columns", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T01:00:00Z");
    const t2 = new Date("2026-01-01T02:00:00Z");

    resultQueue = [
      [],  // projects
      [],  // steps
      [],  // assets
      [makeReview({ sharedAt: t0, viewedAt: t1, approvedAt: t2 })],  // reviews
    ];

    const events = await getEventsForProject("proj-uuid", 42);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("review.requested");
    expect(types).toContain("review.started");
    expect(types).toContain("review.approved");
  });

  it("no event has banned fields (prompt/key/trace/error) in metadata", async () => {
    resultQueue = [
      [makeProject({ status: "running" })],
      [makeStep({ status: "failed", id: 1 })],
      [makeAsset({ status: "completed" })],
      [makeReview({ sharedAt: T0, approvedAt: T1 })],
    ];

    const events = await getEventsForProject("proj-uuid", 42);
    for (const e of events) {
      const keys = Object.keys(e.metadata);
      for (const banned of ["prompt", "systemPrompt", "output", "errorMessage", "error", "apiKey", "input", "reasoning", "stackTrace"]) {
        expect(keys, `event ${e.eventId} must not have ${banned} in metadata`).not.toContain(banned);
      }
    }
  });

  it("all events have a non-empty publicMessage", async () => {
    resultQueue = [
      [makeProject({ status: "running" })],
      [makeStep({ status: "completed" })],
      [makeAsset({ status: "approved" })],
      [makeReview({ sharedAt: T0, approvedAt: T1 })],
    ];
    const events = await getEventsForProject("proj-uuid", 42);
    for (const e of events) {
      expect(e.publicMessage.length, `event ${e.eventId} missing publicMessage`).toBeGreaterThan(0);
    }
  });

  it("all events have valid eventType from the canonical set", async () => {
    resultQueue = [
      [makeProject({ status: "completed" })],
      [makeStep({ status: "completed" }), makeStep({ status: "failed", id: 2, stepName: "Creative Direction" })],
      [makeAsset({ status: "generating" })],
      [makeReview({ sharedAt: T0, revisionRequestedAt: T1 })],
    ];
    const events = await getEventsForProject("proj-uuid", 42);
    for (const e of events) {
      expect(CANONICAL_EVENT_TYPES as readonly string[]).toContain(e.eventType);
    }
  });

  it("eventIds are unique across all events for a project", async () => {
    resultQueue = [
      [makeProject({ status: "running" })],
      [
        makeStep({ id: 1, status: "completed", stepName: "Brand Strategy" }),
        makeStep({ id: 2, status: "running",   stepName: "Creative Direction" }),
      ],
      [makeAsset({ id: 10, status: "completed" })],
      [makeReview({ id: 5, sharedAt: T0 })],
    ];
    const events = await getEventsForProject("proj-uuid", 42);
    const ids = events.map((e) => e.eventId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security: ownership / tenant isolation (structural)
// ─────────────────────────────────────────────────────────────────────────────

describe("security: event scope", () => {
  it("all events for project A carry project A's projectId — not project B's", () => {
    const eventsA = projectStep("project-A", makeStep({ status: "completed" }), 0, 4);
    const eventsB = projectStep("project-B", makeStep({ status: "completed" }), 0, 4);
    for (const e of eventsA) expect(e.projectId).toBe("project-A");
    for (const e of eventsB) expect(e.projectId).toBe("project-B");
  });

  it("review events carry the review's own projectId string", () => {
    const events = projectReview(makeReview({ projectId: "owned-project", sharedAt: T0 }));
    for (const e of events) expect(e.projectId).toBe("owned-project");
  });
});
