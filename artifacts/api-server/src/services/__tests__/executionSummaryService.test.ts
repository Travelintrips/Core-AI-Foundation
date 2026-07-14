/**
 * executionSummaryService.test.ts — V4.1 AI Execution Summary Layer
 *
 * Covers:
 *   ✓ Determinism — same event + context => identical output across calls
 *   ✓ Security — no banned field ever appears on the built summary
 *   ✓ Title/whyItMatters derivation per step name and per source
 *   ✓ Next-step derivation from real pipeline context (not hardcoded order)
 *   ✓ Next-step for the last pipeline step falls back sensibly
 *   ✓ customerAction only ever one of the allowed kinds, gated on real context
 *   ✓ status bucket mapping from severity/eventType
 *   ✓ summary field reuses event.publicMessage verbatim (no re-derivation)
 *   ✓ Public step label dictionary is independent from internal step keys
 *   ✓ Batch + pairing helpers preserve order and 1:1 correspondence
 *   ✓ Resilience — missing/empty context never throws, produces sane defaults
 */

import { describe, it, expect } from "vitest";
import {
  buildExecutionSummary,
  buildExecutionSummaries,
  pairEventsWithSummaries,
  publicStepLabel,
  EMPTY_SUMMARY_CONTEXT,
  BANNED_SUMMARY_FIELDS,
  type SummaryContext,
} from "../executionSummaryService.js";
import type { CanonicalEvent } from "../canonicalEventService.js";

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    eventId: "step:1:completed",
    eventType: "step.completed",
    projectId: "proj-uuid-001",
    workflowId: null,
    stepId: 1,
    workerId: "brand-strategist",
    createdAt: "2026-07-13T08:00:00.000Z",
    publicMessage: "Brand Analysis finished successfully.",
    severity: "info",
    status: "completed",
    progress: 25,
    source: "step",
    metadata: { stepName: "Brand Strategy" },
    ...overrides,
  };
}

function makeContext(overrides: Partial<SummaryContext> = {}): SummaryContext {
  return {
    steps: [
      { stepName: "Brand Strategy", status: "completed" },
      { stepName: "Creative Direction", status: "pending" },
      { stepName: "Copy Production", status: "pending" },
      { stepName: "Quality Control", status: "pending" },
    ],
    latestReviewStatus: null,
    filesUnlocked: false,
    artifactCount: 0,
    ...overrides,
  };
}

describe("buildExecutionSummary — determinism", () => {
  it("returns byte-identical output for the same event + context across calls", () => {
    const event = makeEvent();
    const context = makeContext();
    const a = buildExecutionSummary(event, context);
    const b = buildExecutionSummary(event, context);
    expect(a).toEqual(b);
  });

  it("is a pure function — does not mutate the input event or context", () => {
    const event = makeEvent();
    const context = makeContext();
    const eventCopy = JSON.parse(JSON.stringify(event));
    const contextCopy = JSON.parse(JSON.stringify(context));
    buildExecutionSummary(event, context);
    expect(event).toEqual(eventCopy);
    expect(context).toEqual(contextCopy);
  });
});

describe("buildExecutionSummary — security guardrail", () => {
  it("never includes any banned field on the resulting summary object", () => {
    const event = makeEvent();
    const summary = buildExecutionSummary(event, makeContext());
    const serialized = JSON.stringify(summary).toLowerCase();
    for (const banned of BANNED_SUMMARY_FIELDS) {
      expect(serialized).not.toContain(`"${banned.toLowerCase()}"`);
    }
  });

  it("never leaks banned fields even when they exist on event.metadata", () => {
    const event = makeEvent({
      metadata: {
        stepName: "Brand Strategy",
        // Simulate a hypothetical unsafe upstream metadata leak — the summary
        // builder must not copy metadata wholesale into the output.
        prompt: "system prompt text",
        apiKey: "sk-should-never-appear",
      } as unknown as CanonicalEvent["metadata"],
    });
    const summary = buildExecutionSummary(event, makeContext());
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("system prompt text");
    expect(serialized).not.toContain("sk-should-never-appear");
  });

  it("isDerived is always true, marking this as template output never raw data", () => {
    const summary = buildExecutionSummary(makeEvent(), makeContext());
    expect(summary.isDerived).toBe(true);
  });
});

describe("buildExecutionSummary — title & whyItMatters derivation", () => {
  it("titles a completed step using the public step label, not the internal key", () => {
    const summary = buildExecutionSummary(makeEvent(), makeContext());
    expect(summary.title).toBe("Brand Analysis Completed");
  });

  it("uses a distinct public label for a step whose internal name differs", () => {
    expect(publicStepLabel("Brand Strategy")).toBe("Brand Analysis");
    expect(publicStepLabel("Copy Production")).toBe("Copywriting");
    // Unknown step names pass through unchanged rather than throwing.
    expect(publicStepLabel("Some Future Step")).toBe("Some Future Step");
  });

  it("gives a step-specific whyItMatters when the step is known", () => {
    const summary = buildExecutionSummary(makeEvent(), makeContext());
    expect(summary.whyItMatters).toMatch(/strategic direction/i);
  });

  it("falls back to a source-level whyItMatters when no step name is present", () => {
    const event = makeEvent({
      eventType: "review.requested",
      source: "review",
      metadata: {},
      publicMessage: "Please review your creative direction.",
    });
    const summary = buildExecutionSummary(event, makeContext());
    expect(summary.whyItMatters).toMatch(/decision/i);
  });

  it("reuses event.publicMessage verbatim as the summary body", () => {
    const event = makeEvent({ publicMessage: "Exact vetted customer-safe text." });
    const summary = buildExecutionSummary(event, makeContext());
    expect(summary.summary).toBe("Exact vetted customer-safe text.");
  });
});

describe("buildExecutionSummary — next-step derivation from real context", () => {
  it("derives the next step from the actual ordered pipeline, not a hardcoded list", () => {
    const context = makeContext({
      steps: [
        { stepName: "Brand Strategy", status: "completed" },
        { stepName: "Creative Direction", status: "pending" },
      ],
    });
    const event = makeEvent({ metadata: { stepName: "Brand Strategy" } });
    const summary = buildExecutionSummary(event, context);
    expect(summary.nextStep).toContain("Creative Direction");
  });

  it("falls back to a generic message when completing the last known step", () => {
    const context = makeContext({
      steps: [{ stepName: "Quality Control", status: "completed" }],
    });
    const event = makeEvent({ metadata: { stepName: "Quality Control" } });
    const summary = buildExecutionSummary(event, context);
    expect(summary.nextStep).not.toBeNull();
    expect(summary.nextStep).not.toContain("undefined");
  });

  it("returns null next-step for event types with nothing further to say", () => {
    const event = makeEvent({ eventType: "step.queued", metadata: { stepName: "Brand Strategy" } });
    const summary = buildExecutionSummary(event, makeContext());
    expect(summary.nextStep).toBeNull();
  });

  it("reflects filesUnlocked=true in the project.completed next step", () => {
    const event = makeEvent({ eventType: "project.completed", source: "project", metadata: {} });
    const unlocked = buildExecutionSummary(event, makeContext({ filesUnlocked: true }));
    const locked = buildExecutionSummary(event, makeContext({ filesUnlocked: false }));
    expect(unlocked.nextStep).toMatch(/ready/i);
    expect(locked.nextStep).toMatch(/unlocked shortly/i);
  });
});

describe("buildExecutionSummary — customerAction is always an existing portal destination", () => {
  const ALLOWED_KINDS = new Set(["view_review", "view_files", "view_payments", "contact_support"]);

  it("only ever returns one of the allowed customerAction kinds, or null", () => {
    const eventTypes: CanonicalEvent["eventType"][] = [
      "review.requested",
      "review.approved",
      "project.completed",
      "step.failed",
      "step.blocked",
      "step.completed",
    ];
    for (const eventType of eventTypes) {
      const summary = buildExecutionSummary(
        makeEvent({ eventType, source: eventType.startsWith("review") ? "review" : eventType.startsWith("project") ? "project" : "step" }),
        makeContext({ filesUnlocked: true }),
      );
      if (summary.customerAction) {
        expect(ALLOWED_KINDS.has(summary.customerAction.kind)).toBe(true);
      }
    }
  });

  it("gates view_files on the real filesUnlocked flag rather than assuming it", () => {
    const event = makeEvent({ eventType: "review.approved", source: "review", metadata: {} });
    const gated = buildExecutionSummary(event, makeContext({ filesUnlocked: false }));
    const open = buildExecutionSummary(event, makeContext({ filesUnlocked: true }));
    expect(gated.customerAction).toBeNull();
    expect(open.customerAction?.kind).toBe("view_files");
  });

  it("routes failures to contact_support", () => {
    const event = makeEvent({ eventType: "step.failed" });
    const summary = buildExecutionSummary(event, makeContext());
    expect(summary.customerAction).toEqual({ kind: "contact_support", label: "Contact Support" });
  });
});

describe("buildExecutionSummary — status bucket mapping", () => {
  it("maps error severity to status=error regardless of eventType", () => {
    const event = makeEvent({ eventType: "step.completed", severity: "error" });
    expect(buildExecutionSummary(event, makeContext()).status).toBe("error");
  });

  it("maps known success event types to status=success", () => {
    const event = makeEvent({ eventType: "step.completed", severity: "info" });
    expect(buildExecutionSummary(event, makeContext()).status).toBe("success");
  });

  it("defaults to info for a neutral event", () => {
    const event = makeEvent({ eventType: "step.started", severity: "info" });
    expect(buildExecutionSummary(event, makeContext()).status).toBe("info");
  });
});

describe("buildExecutionSummaries / pairEventsWithSummaries — batch helpers", () => {
  it("preserves input order and produces one summary per event", () => {
    const events = [
      makeEvent({ eventId: "a", createdAt: "2026-07-13T08:00:00.000Z" }),
      makeEvent({ eventId: "b", createdAt: "2026-07-13T09:00:00.000Z" }),
    ];
    const summaries = buildExecutionSummaries(events, makeContext());
    expect(summaries).toHaveLength(2);
    expect(summaries[0]!.sourceEventId).toBe("a");
    expect(summaries[1]!.sourceEventId).toBe("b");
  });

  it("pairEventsWithSummaries keeps event and summary 1:1 aligned", () => {
    const events = [makeEvent({ eventId: "x" }), makeEvent({ eventId: "y" })];
    const pairs = pairEventsWithSummaries(events, makeContext());
    expect(pairs.map((p) => p.event.eventId)).toEqual(["x", "y"]);
    expect(pairs.map((p) => p.summary.sourceEventId)).toEqual(["x", "y"]);
  });
});

describe("buildExecutionSummary — resilience to missing context", () => {
  it("never throws with EMPTY_SUMMARY_CONTEXT / default argument", () => {
    expect(() => buildExecutionSummary(makeEvent())).not.toThrow();
    const summary = buildExecutionSummary(makeEvent(), EMPTY_SUMMARY_CONTEXT);
    expect(summary.nextStep === null || typeof summary.nextStep === "string").toBe(true);
    expect(summary.artifactCount).toBe(0);
  });

  it("does not throw for an eventType with no template match (safe fallback title)", () => {
    const event = makeEvent({ eventType: "step.started" as CanonicalEvent["eventType"], metadata: {} });
    expect(() => buildExecutionSummary(event, EMPTY_SUMMARY_CONTEXT)).not.toThrow();
  });
});
