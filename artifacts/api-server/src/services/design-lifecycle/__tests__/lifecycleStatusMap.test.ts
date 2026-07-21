/**
 * __tests__/lifecycleStatusMap.test.ts — Team 08
 *
 * Tests for the documented, deterministic DesignStage ↔ creative_projects.status mapping.
 */

import { describe, it, expect } from "vitest";
import {
  toRawStatus,
  toDesignStage,
  isDesignStage,
  isTerminal,
  DESIGN_STAGE_TO_STATUS,
  STATUS_TO_DESIGN_STAGE,
  TERMINAL_STAGES,
} from "../lifecycleStatusMap.js";
import type { DesignStage } from "../types.js";

const ALL_STAGES: DesignStage[] = [
  "draft",
  "brief_in_progress",
  "ready",
  "active",
  "waiting_for_input",
  "generating",
  "in_review",
  "revision_requested",
  "approved",
  "completed",
  "failed",
  "cancelled",
];

describe("DESIGN_STAGE_TO_STATUS", () => {
  it("covers every DesignStage", () => {
    for (const stage of ALL_STAGES) {
      expect(DESIGN_STAGE_TO_STATUS[stage]).toBeDefined();
    }
  });

  it("maps draft and brief_in_progress to pending (shared raw status)", () => {
    expect(DESIGN_STAGE_TO_STATUS.draft).toBe("pending");
    expect(DESIGN_STAGE_TO_STATUS.brief_in_progress).toBe("pending");
  });

  it("maps terminal stages correctly", () => {
    expect(DESIGN_STAGE_TO_STATUS.completed).toBe("completed");
    expect(DESIGN_STAGE_TO_STATUS.cancelled).toBe("cancelled");
  });

  it("maps operational stages to existing creative_projects.status values", () => {
    expect(DESIGN_STAGE_TO_STATUS.ready).toBe("ready_to_build");
    expect(DESIGN_STAGE_TO_STATUS.active).toBe("building");
    expect(DESIGN_STAGE_TO_STATUS.waiting_for_input).toBe("waiting_client_review");
    expect(DESIGN_STAGE_TO_STATUS.generating).toBe("running");
    expect(DESIGN_STAGE_TO_STATUS.in_review).toBe("internal_review");
    expect(DESIGN_STAGE_TO_STATUS.revision_requested).toBe("revision");
    expect(DESIGN_STAGE_TO_STATUS.approved).toBe("approved");
    expect(DESIGN_STAGE_TO_STATUS.failed).toBe("failed");
  });
});

describe("toRawStatus", () => {
  it("returns the correct raw status for each stage", () => {
    for (const stage of ALL_STAGES) {
      expect(toRawStatus(stage)).toBe(DESIGN_STAGE_TO_STATUS[stage]);
    }
  });
});

describe("toDesignStage", () => {
  it("resolves known raw statuses to a DesignStage", () => {
    expect(toDesignStage("running")).toBe("generating");
    expect(toDesignStage("building")).toBe("active");
    expect(toDesignStage("internal_review")).toBe("in_review");
    expect(toDesignStage("waiting_client_review")).toBe("waiting_for_input");
    expect(toDesignStage("revision")).toBe("revision_requested");
    expect(toDesignStage("approved")).toBe("approved");
    expect(toDesignStage("completed")).toBe("completed");
    expect(toDesignStage("failed")).toBe("failed");
    expect(toDesignStage("cancelled")).toBe("cancelled");
    expect(toDesignStage("ready_to_build")).toBe("ready");
  });

  it("falls back to draft for unknown raw statuses (legacy project safety)", () => {
    expect(toDesignStage("some_unknown_status")).toBe("draft");
    expect(toDesignStage("")).toBe("draft");
  });

  it("uses lifecycle_metadata.designStage as tie-breaker for shared statuses", () => {
    // 'pending' maps to 'draft' by default
    expect(toDesignStage("pending")).toBe("draft");
    // but metadata overrides it
    expect(toDesignStage("pending", { designStage: "brief_in_progress" })).toBe(
      "brief_in_progress",
    );
  });

  it("ignores invalid designStage values in metadata", () => {
    expect(toDesignStage("pending", { designStage: "not_a_real_stage" })).toBe("draft");
  });

  it("handles null metadata gracefully", () => {
    expect(toDesignStage("building", null)).toBe("active");
    expect(toDesignStage("building", undefined)).toBe("active");
  });

  it("maps legacy intermediate statuses to nearest equivalent", () => {
    expect(toDesignStage("generating_document")).toBe("generating");
    expect(toDesignStage("generating_presentation")).toBe("generating");
    expect(toDesignStage("payment_verified")).toBe("ready");
    expect(toDesignStage("waiting_payment")).toBe("draft");
  });
});

describe("isDesignStage", () => {
  it("returns true for all valid stages", () => {
    for (const stage of ALL_STAGES) {
      expect(isDesignStage(stage)).toBe(true);
    }
  });

  it("returns false for non-stage strings", () => {
    expect(isDesignStage("pending")).toBe(false);
    expect(isDesignStage("running")).toBe(false);
    expect(isDesignStage("")).toBe(false);
    expect(isDesignStage("unknown")).toBe(false);
  });
});

describe("isTerminal", () => {
  it("returns true only for completed and cancelled", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });

  it("returns false for non-terminal stages", () => {
    const nonTerminal = ALL_STAGES.filter((s) => !TERMINAL_STAGES.has(s));
    for (const stage of nonTerminal) {
      expect(isTerminal(stage)).toBe(false);
    }
  });
});

describe("STATUS_TO_DESIGN_STAGE reverse map", () => {
  it("covers all raw statuses used by creative_projects", () => {
    const knownRawStatuses = [
      "pending",
      "running",
      "completed",
      "failed",
      "waiting_payment",
      "deposit_paid",
      "payment_verified",
      "ready_to_build",
      "building",
      "internal_review",
      "waiting_client_review",
      "revision",
      "approved",
      "generating_document",
      "generating_presentation",
      "cancelled",
    ];
    for (const raw of knownRawStatuses) {
      expect(STATUS_TO_DESIGN_STAGE[raw]).toBeDefined();
    }
  });

  it("all values are valid DesignStages", () => {
    for (const [raw, stage] of Object.entries(STATUS_TO_DESIGN_STAGE)) {
      expect(isDesignStage(stage), `${raw} → ${stage} should be a valid DesignStage`).toBe(true);
    }
  });
});
