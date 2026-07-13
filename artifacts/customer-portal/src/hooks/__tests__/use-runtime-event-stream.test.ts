/**
 * use-runtime-event-stream.test.ts — Tests for frontend event merge helpers.
 *
 * These are pure-function tests that do not require a DOM/browser environment.
 * The hook itself (EventSource, network) is covered by manual verification.
 */

import { describe, it, expect } from "vitest";
import type { CanonicalEvent } from "../use-runtime-event-stream";
import { mergeEvents } from "../use-runtime-event-stream";

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    eventId: "e1",
    eventType: "step.started",
    projectId: "proj-001",
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

// ─── 1. mergeEvents — deduplication ──────────────────────────────────────────

describe("mergeEvents — deduplication", () => {
  it("deduplicates by eventId — existing wins when incoming is same", () => {
    const e1 = makeEvent({ eventId: "e1", publicMessage: "original" });
    const e1dup = makeEvent({ eventId: "e1", publicMessage: "duplicate" });
    const result = mergeEvents([e1], [e1dup]);
    expect(result).toHaveLength(1);
    // incoming value wins (merge applies existing then incoming)
    expect(result[0]?.publicMessage).toBe("duplicate");
  });

  it("combines disjoint sets", () => {
    const a = makeEvent({ eventId: "a", createdAt: "2026-07-13T08:00:00.000Z" });
    const b = makeEvent({ eventId: "b", createdAt: "2026-07-13T09:00:00.000Z" });
    const result = mergeEvents([a], [b]);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.eventId)).toEqual(["a", "b"]);
  });

  it("handles empty existing", () => {
    const b = makeEvent({ eventId: "b" });
    const result = mergeEvents([], [b]);
    expect(result).toHaveLength(1);
    expect(result[0]?.eventId).toBe("b");
  });

  it("handles empty incoming", () => {
    const a = makeEvent({ eventId: "a" });
    const result = mergeEvents([a], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.eventId).toBe("a");
  });

  it("handles both empty", () => {
    expect(mergeEvents([], [])).toHaveLength(0);
  });
});

// ─── 2. mergeEvents — ordering ────────────────────────────────────────────────

describe("mergeEvents — ordering", () => {
  it("sorts by createdAt ASC", () => {
    const e1 = makeEvent({ eventId: "e1", createdAt: "2026-07-13T10:00:00.000Z" });
    const e2 = makeEvent({ eventId: "e2", createdAt: "2026-07-13T08:00:00.000Z" });
    const result = mergeEvents([e1], [e2]);
    expect(result.map((e) => e.eventId)).toEqual(["e2", "e1"]);
  });

  it("breaks timestamp tie with eventId lexicographic order ASC", () => {
    const ts = "2026-07-13T08:00:00.000Z";
    const e2 = makeEvent({ eventId: "step:2:start", createdAt: ts });
    const e1 = makeEvent({ eventId: "step:1:start", createdAt: ts });
    const result = mergeEvents([e2], [e1]);
    expect(result.map((e) => e.eventId)).toEqual(["step:1:start", "step:2:start"]);
  });

  it("is deterministic — calling twice produces same result", () => {
    const events = [
      makeEvent({ eventId: "c", createdAt: "2026-07-13T09:00:00.000Z" }),
      makeEvent({ eventId: "a", createdAt: "2026-07-13T07:00:00.000Z" }),
      makeEvent({ eventId: "b", createdAt: "2026-07-13T08:00:00.000Z" }),
    ];
    const r1 = mergeEvents(events, []);
    const r2 = mergeEvents(events, []);
    expect(r1.map((e) => e.eventId)).toEqual(r2.map((e) => e.eventId));
  });
});

// ─── 3. mergeEvents — snapshot replacement behavior ───────────────────────────

describe("mergeEvents — snapshot handling", () => {
  it("snapshot events added to existing do not duplicate on second snapshot", () => {
    // Simulates: initial snapshot received, then SSE reconnect sends same events
    const existing = [
      makeEvent({ eventId: "e1", createdAt: "2026-07-13T08:00:00.000Z" }),
      makeEvent({ eventId: "e2", createdAt: "2026-07-13T09:00:00.000Z" }),
    ];
    const secondSnapshot = [
      makeEvent({ eventId: "e1", createdAt: "2026-07-13T08:00:00.000Z" }), // dup
      makeEvent({ eventId: "e2", createdAt: "2026-07-13T09:00:00.000Z" }), // dup
      makeEvent({ eventId: "e3", createdAt: "2026-07-13T10:00:00.000Z" }), // new
    ];
    const result = mergeEvents(existing, secondSnapshot);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.eventId)).toEqual(["e1", "e2", "e3"]);
  });
});

// ─── 4. Duplicate activity events avoided ─────────────────────────────────────

describe("mergeEvents — activity deduplication", () => {
  it("does not append duplicate events on incremental delivery", () => {
    const initial = [
      makeEvent({ eventId: "step:1:start", createdAt: "2026-07-13T08:00:00.000Z" }),
    ];
    // SSE delivers same event again (reconnect scenario)
    const duplicate = [
      makeEvent({ eventId: "step:1:start", createdAt: "2026-07-13T08:00:00.000Z" }),
    ];
    const result = mergeEvents(initial, duplicate);
    expect(result).toHaveLength(1); // not duplicated
  });
});
