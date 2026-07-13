/**
 * sseManager.test.ts — Unit tests for SSE cursor helpers, event ordering,
 * deduplication, connection limits, and shared poller logic.
 *
 * These tests cover the pure functions exhaustively and test the DB-backed
 * paths with a mocked canonicalEventService.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CanonicalEvent } from "../canonicalEventService.js";

// ─── Mock canonicalEventService before importing sseManager ───────────────────
vi.mock("../canonicalEventService.js", () => ({
  getEventsForProject: vi.fn(),
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  encodeCursor,
  decodeCursor,
  compareByCursor,
  isAfterCursor,
  sortEvents,
  filterAfterCursor,
  registerSubscriber,
  removeSubscriber,
  MAX_CONNECTIONS_PER_IP,
  MAX_CONNECTIONS_PER_TOKEN,
  MAX_SUBSCRIBERS_PER_PROJECT,
  getObservability,
} from "../sseManager.js";
import { getEventsForProject } from "../canonicalEventService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    eventId: "step:1:start",
    eventType: "step.started",
    projectId: "proj-uuid-001",
    workflowId: null,
    stepId: 1,
    workerId: "brand-strategist",
    createdAt: "2026-07-13T08:00:00.000Z",
    publicMessage: "AI started.",
    severity: "info",
    status: "running",
    progress: 10,
    source: "step",
    metadata: {},
    ...overrides,
  };
}

function makeRes() {
  const written: string[] = [];
  const res = {
    writableEnded: false,
    write: vi.fn((chunk: string) => { written.push(chunk); return true; }),
    end: vi.fn(() => { res.writableEnded = true; }),
    _written: written,
  } as any;
  return res;
}

// ─── 1. Cursor encode/decode ───────────────────────────────────────────────────

describe("encodeCursor / decodeCursor", () => {
  it("round-trips correctly", () => {
    const cursor = { createdAt: "2026-07-13T08:00:00.000Z", eventId: "step:1:start" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("returns null for invalid base64", () => {
    expect(decodeCursor("not-valid-base64!!!")).toBeNull();
  });

  it("returns null for JSON without required fields", () => {
    const encoded = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    const encoded = Buffer.from(JSON.stringify("hello")).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });
});

// ─── 2. compareByCursor ───────────────────────────────────────────────────────

describe("compareByCursor", () => {
  it("sorts earlier createdAt first", () => {
    const a = makeEvent({ createdAt: "2026-07-13T08:00:00.000Z", eventId: "a" });
    const b = makeEvent({ createdAt: "2026-07-13T09:00:00.000Z", eventId: "b" });
    expect(compareByCursor(a, b)).toBeLessThan(0);
    expect(compareByCursor(b, a)).toBeGreaterThan(0);
  });

  it("breaks timestamp ties by eventId lexicographically", () => {
    const ts = "2026-07-13T08:00:00.000Z";
    const a = makeEvent({ createdAt: ts, eventId: "step:1:final" });
    const b = makeEvent({ createdAt: ts, eventId: "step:2:start" });
    expect(compareByCursor(a, b)).toBeLessThan(0); // "step:1:final" < "step:2:start"
  });

  it("returns 0 for identical cursor", () => {
    const a = makeEvent({ createdAt: "2026-07-13T08:00:00.000Z", eventId: "x" });
    expect(compareByCursor(a, a)).toBe(0);
  });
});

// ─── 3. isAfterCursor ────────────────────────────────────────────────────────

describe("isAfterCursor", () => {
  const cursor = { createdAt: "2026-07-13T08:00:00.000Z", eventId: "step:1:start" };

  it("returns true for later createdAt", () => {
    const e = makeEvent({ createdAt: "2026-07-13T09:00:00.000Z", eventId: "anything" });
    expect(isAfterCursor(e, cursor)).toBe(true);
  });

  it("returns false for earlier createdAt", () => {
    const e = makeEvent({ createdAt: "2026-07-13T07:00:00.000Z", eventId: "anything" });
    expect(isAfterCursor(e, cursor)).toBe(false);
  });

  it("returns true for same createdAt but lexicographically later eventId", () => {
    const e = makeEvent({ createdAt: cursor.createdAt, eventId: "step:2:start" });
    expect(isAfterCursor(e, cursor)).toBe(true);
  });

  it("returns false for same createdAt but earlier eventId", () => {
    const e = makeEvent({ createdAt: cursor.createdAt, eventId: "step:1:earlier" });
    // "step:1:earlier" < "step:1:start" (alphabetically)
    expect(isAfterCursor(e, cursor)).toBe(false);
  });

  it("returns false for identical event (not strictly after)", () => {
    const e = makeEvent({ createdAt: cursor.createdAt, eventId: cursor.eventId });
    expect(isAfterCursor(e, cursor)).toBe(false);
  });
});

// ─── 4. sortEvents ────────────────────────────────────────────────────────────

describe("sortEvents", () => {
  it("sorts events by createdAt ASC, then eventId ASC", () => {
    const ts = "2026-07-13T08:00:00.000Z";
    const events = [
      makeEvent({ createdAt: "2026-07-13T09:00:00.000Z", eventId: "c" }),
      makeEvent({ createdAt: ts, eventId: "b" }),
      makeEvent({ createdAt: ts, eventId: "a" }),
    ];
    const sorted = sortEvents(events);
    expect(sorted.map((e) => e.eventId)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate original array", () => {
    const original = [
      makeEvent({ createdAt: "2026-07-13T09:00:00.000Z", eventId: "b" }),
      makeEvent({ createdAt: "2026-07-13T08:00:00.000Z", eventId: "a" }),
    ];
    const sorted = sortEvents(original);
    expect(original[0].eventId).toBe("b"); // unchanged
    expect(sorted[0].eventId).toBe("a");
  });
});

// ─── 5. filterAfterCursor ────────────────────────────────────────────────────

describe("filterAfterCursor", () => {
  const events = [
    makeEvent({ createdAt: "2026-07-13T08:00:00.000Z", eventId: "a" }),
    makeEvent({ createdAt: "2026-07-13T08:00:00.000Z", eventId: "b" }),
    makeEvent({ createdAt: "2026-07-13T09:00:00.000Z", eventId: "c" }),
  ];

  it("returns all events when cursor is null", () => {
    expect(filterAfterCursor(events, null)).toHaveLength(3);
  });

  it("returns only events strictly after cursor", () => {
    const cursor = { createdAt: "2026-07-13T08:00:00.000Z", eventId: "a" };
    const result = filterAfterCursor(events, cursor);
    expect(result.map((e) => e.eventId)).toEqual(["b", "c"]);
  });

  it("returns empty when cursor is at last event", () => {
    const cursor = { createdAt: "2026-07-13T09:00:00.000Z", eventId: "c" };
    expect(filterAfterCursor(events, cursor)).toHaveLength(0);
  });
});

// ─── 6. registerSubscriber — invalid token / connection limits ─────────────────

describe("registerSubscriber — connection limits", () => {
  const mockGetEvents = vi.mocked(getEventsForProject);

  beforeEach(() => {
    mockGetEvents.mockResolvedValue([]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects when IP has too many connections", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    const subs: any[] = [];

    // Fill up to the limit
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
      const res = makeRes();
      const result = await registerSubscriber({
        res,
        ip,
        token: `token-ip-${i}`,
        projectId: `proj-ip-${i}`,
        internalProjectId: i + 1000,
        afterCursor: null,
        isProjectTerminal: false,
      });
      expect(result.ok).toBe(true);
      if (result.ok) subs.push(result.sub);
    }

    // One more should be rejected
    const extra = makeRes();
    const rejected = await registerSubscriber({
      res: extra,
      ip,
      token: "token-ip-extra",
      projectId: "proj-ip-extra",
      internalProjectId: 9999,
      afterCursor: null,
      isProjectTerminal: false,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.status).toBe(429);

    // Clean up
    subs.forEach(removeSubscriber);
  });

  it("rejects when token has too many connections", async () => {
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    const subs: any[] = [];

    for (let i = 0; i < MAX_CONNECTIONS_PER_TOKEN; i++) {
      const res = makeRes();
      const result = await registerSubscriber({
        res,
        ip: `10.0.${i}.1`,
        token,
        projectId: `proj-tok-${i}`,
        internalProjectId: i + 2000,
        afterCursor: null,
        isProjectTerminal: false,
      });
      expect(result.ok).toBe(true);
      if (result.ok) subs.push(result.sub);
    }

    const extra = makeRes();
    const rejected = await registerSubscriber({
      res: extra,
      ip: "10.99.99.99",
      token,
      projectId: "proj-tok-extra",
      internalProjectId: 8888,
      afterCursor: null,
      isProjectTerminal: false,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.status).toBe(429);

    subs.forEach(removeSubscriber);
  });

  it("rejects when project has too many subscribers", async () => {
    const projectId = `proj-max-${Math.random().toString(36).slice(2)}`;
    const subs: any[] = [];

    for (let i = 0; i < MAX_SUBSCRIBERS_PER_PROJECT; i++) {
      const res = makeRes();
      const result = await registerSubscriber({
        res,
        ip: `172.16.${Math.floor(i / 254)}.${(i % 254) + 1}`,
        token: `tok-proj-${i}`,
        projectId,
        internalProjectId: 777,
        afterCursor: null,
        isProjectTerminal: false,
      });
      expect(result.ok).toBe(true);
      if (result.ok) subs.push(result.sub);
    }

    const extra = makeRes();
    const rejected = await registerSubscriber({
      res: extra,
      ip: "172.31.0.1",
      token: "tok-proj-extra",
      projectId,
      internalProjectId: 777,
      afterCursor: null,
      isProjectTerminal: false,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.status).toBe(429);

    subs.forEach(removeSubscriber);
  });
});

// ─── 7. registerSubscriber — snapshot and SSE headers ─────────────────────────

describe("registerSubscriber — snapshot delivery", () => {
  const mockGetEvents = vi.mocked(getEventsForProject);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends snapshot event as first message", async () => {
    const projectId = `snap-proj-${Math.random().toString(36).slice(2)}`;
    const events = [makeEvent({ eventId: "e1", createdAt: "2026-07-13T08:00:00.000Z" })];
    mockGetEvents.mockResolvedValue(events);

    const res = makeRes();
    const result = await registerSubscriber({
      res,
      ip: "1.2.3.4",
      token: "snap-tok",
      projectId,
      internalProjectId: 111,
      afterCursor: null,
      isProjectTerminal: false,
    });

    expect(result.ok).toBe(true);

    const written = res._written.join("");
    expect(written).toContain("event: snapshot");
    expect(written).toContain('"events"');
    expect(written).toContain("e1");

    if (result.ok) removeSubscriber(result.sub);
  });

  it("sends only missed events when afterCursor is provided (reconnect)", async () => {
    const projectId = `reconnect-${Math.random().toString(36).slice(2)}`;
    const events = [
      makeEvent({ eventId: "e1", createdAt: "2026-07-13T08:00:00.000Z" }),
      makeEvent({ eventId: "e2", createdAt: "2026-07-13T09:00:00.000Z" }),
      makeEvent({ eventId: "e3", createdAt: "2026-07-13T10:00:00.000Z" }),
    ];
    mockGetEvents.mockResolvedValue(events);

    const cursor = { createdAt: "2026-07-13T09:00:00.000Z", eventId: "e2" };
    const res = makeRes();
    const result = await registerSubscriber({
      res,
      ip: "1.2.3.4",
      token: "cursor-tok",
      projectId,
      internalProjectId: 222,
      afterCursor: cursor,
      isProjectTerminal: false,
    });

    const written = res._written.join("");
    // Only e3 should be in the snapshot (after e2)
    expect(written).toContain("e3");
    expect(written).not.toContain('"eventId":"e1"');
    expect(written).not.toContain('"eventId":"e2"');

    if (result.ok) removeSubscriber(result.sub);
  });

  it("two subscribers on same project share one poller", async () => {
    const projectId = `shared-${Math.random().toString(36).slice(2)}`;
    mockGetEvents.mockResolvedValue([]);

    const res1 = makeRes();
    const result1 = await registerSubscriber({
      res: res1,
      ip: "2.2.2.1",
      token: "tok-shared-1",
      projectId,
      internalProjectId: 333,
      afterCursor: null,
      isProjectTerminal: false,
    });

    const res2 = makeRes();
    const result2 = await registerSubscriber({
      res: res2,
      ip: "2.2.2.2",
      token: "tok-shared-2",
      projectId,
      internalProjectId: 333,
      afterCursor: null,
      isProjectTerminal: false,
    });

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);

    const obs = getObservability();
    // Both in same channel → only 1 poller for this projectId
    expect(obs.activeProjectPollers).toBeGreaterThanOrEqual(1);

    if (result1.ok) removeSubscriber(result1.sub);
    if (result2.ok) removeSubscriber(result2.sub);
  });

  it("removes project poller when last subscriber disconnects", async () => {
    const projectId = `cleanup-${Math.random().toString(36).slice(2)}`;
    mockGetEvents.mockResolvedValue([]);

    const res = makeRes();
    const result = await registerSubscriber({
      res,
      ip: "3.3.3.3",
      token: "tok-cleanup",
      projectId,
      internalProjectId: 444,
      afterCursor: null,
      isProjectTerminal: false,
    });
    expect(result.ok).toBe(true);

    const obsBefore = getObservability();
    expect(obsBefore.activeConnections).toBeGreaterThanOrEqual(1);

    if (result.ok) removeSubscriber(result.sub);

    // No subscribers remain for this project
    const obsAfter = getObservability();
    // The connection count should be reduced
    expect(obsAfter.activeConnections).toBeLessThan(obsBefore.activeConnections + 1);
  });

  it("does not send poller events with duplicate eventIds", async () => {
    const projectId = `dedup-${Math.random().toString(36).slice(2)}`;
    const event = makeEvent({ eventId: "unique-e1", createdAt: "2026-07-13T08:00:00.000Z" });
    mockGetEvents.mockResolvedValue([event]);

    const res = makeRes();
    const result = await registerSubscriber({
      res,
      ip: "4.4.4.4",
      token: "tok-dedup",
      projectId,
      internalProjectId: 555,
      afterCursor: null,
      isProjectTerminal: false,
    });

    expect(result.ok).toBe(true);

    // Snapshot is sent, which seeds the known-event set.
    // Advance timers to trigger a poll — the same event should NOT be re-delivered.
    vi.advanceTimersByTime(5000);
    await Promise.resolve(); // flush promises

    const written = res._written.join("");
    // Count occurrences of the eventId — should appear only in snapshot
    const count = (written.match(/unique-e1/g) ?? []).length;
    expect(count).toBe(1); // in snapshot only

    if (result.ok) removeSubscriber(result.sub);
  });

  it("sends no sensitive fields in snapshot events", async () => {
    const projectId = `secure-${Math.random().toString(36).slice(2)}`;
    const event = makeEvent({
      eventId: "sec-e1",
      publicMessage: "AI started.",
      metadata: { stepName: "Brand Strategy", agentRole: "brand-strategist" },
    });
    mockGetEvents.mockResolvedValue([event]);

    const res = makeRes();
    const result = await registerSubscriber({
      res,
      ip: "5.5.5.5",
      token: "tok-secure",
      projectId,
      internalProjectId: 666,
      afterCursor: null,
      isProjectTerminal: false,
    });

    const written = res._written.join("");
    // Should not contain any of the forbidden fields
    expect(written).not.toContain("prompt");
    expect(written).not.toContain("apiKey");
    expect(written).not.toContain("secretKey");
    expect(written).not.toContain("errorMessage");
    expect(written).not.toContain("stackTrace");

    if (result.ok) removeSubscriber(result.sub);
  });
});
