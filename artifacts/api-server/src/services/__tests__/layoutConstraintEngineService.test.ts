import { describe, expect, it } from "vitest";
import { evaluateLayoutConstraints, type LayoutConstraintPlacement } from "../layoutConstraintEngineService.js";

const ids = Array.from({ length: 60 }, (_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

function item(index: number, patch: Partial<LayoutConstraintPlacement> = {}): LayoutConstraintPlacement {
  return {
    id: ids[index]!,
    label: `Item ${index}`,
    xCm: 50 + (index % 5) * 130,
    yCm: 50 + Math.floor(index / 5) * 120,
    widthCm: 80,
    depthCm: 60,
    rotationDeg: 0,
    anchorX: 0,
    anchorY: 0,
    clearanceFrontCm: 0,
    clearanceSideCm: 0,
    clearanceBackCm: 0,
    isArchived: false,
    metadata: {},
    ...patch,
  };
}

function session(placements: LayoutConstraintPlacement[], metadata: Record<string, unknown> = {}) {
  return {
    sessionId: ids[0]!,
    room: { widthCm: 800, depthCm: 800 },
    placements,
    metadata,
  };
}

describe("WP-07 layout constraint engine", () => {
  it("accepts an empty layout with a finite bounded score", () => {
    const result = evaluateLayoutConstraints(session([]));
    expect(result.valid).toBe(true);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
    expect(result.ruleResults).toHaveLength(20);
  });

  it("evaluates a valid simple layout and keeps missing metadata not applicable", () => {
    const result = evaluateLayoutConstraints(session([item(1)]));
    expect(result.valid).toBe(true);
    expect(result.ruleResults.find((rule) => rule.ruleId === "HC-05")?.status).toBe("not_applicable");
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-03")?.status).toBe("not_applicable");
  });

  it("detects room bounds and rotated room-bound violations", () => {
    const outside = evaluateLayoutConstraints(session([item(1, { xCm: -1 })]));
    expect(outside.hardViolations.some((violation) => violation.ruleId === "HC-01")).toBe(true);

    const rotated = evaluateLayoutConstraints(session([item(1, { xCm: 0, yCm: 0, widthCm: 160, depthCm: 20, rotationDeg: 45 })]));
    expect(rotated.hardViolations.some((violation) => violation.ruleId === "HC-01")).toBe(true);
  });

  it("detects axis-aligned and rotated furniture collision", () => {
    const collision = evaluateLayoutConstraints(session([
      item(1, { xCm: 100, yCm: 100 }),
      item(2, { xCm: 150, yCm: 120 }),
    ]));
    expect(collision.hardViolations.some((violation) => violation.ruleId === "HC-02")).toBe(true);

    const rotatedCollision = evaluateLayoutConstraints(session([
      item(1, { xCm: 250, yCm: 250, rotationDeg: 35 }),
      item(2, { xCm: 300, yCm: 270, rotationDeg: 315 }),
    ]));
    expect(rotatedCollision.hardViolations.some((violation) => violation.ruleId === "HC-02")).toBe(true);
  });

  it("recognizes locked items without mutating them", () => {
    const input = session([item(1, { metadata: { locked: true } })]);
    const before = structuredClone(input);
    const result = evaluateLayoutConstraints(input);
    expect(result.ruleResults.find((rule) => rule.ruleId === "HC-03")?.status).toBe("pass");
    expect(input).toEqual(before);
  });

  it("checks door, window, walkway, furniture, and excluded-zone constraints", () => {
    const result = evaluateLayoutConstraints(session(
      [item(1, { xCm: 100, yCm: 100 })],
      {
        doors: [{ id: "door", xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, clearanceCm: 20 }],
        windows: [{ id: "window", xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, clearanceCm: 20 }],
        walkwayZones: [{ id: "walk", xCm: 100, yCm: 100, widthCm: 100, depthCm: 50 }],
        excludedZones: [{ id: "excluded", xCm: 100, yCm: 100, widthCm: 100, depthCm: 50 }],
        minFurnitureClearanceCm: 10,
      },
    ));
    expect(result.hardViolations.map((violation) => violation.ruleId)).toEqual(expect.arrayContaining(["HC-04", "HC-05", "HC-06", "HC-08"]));
  });

  it("rejects zero, negative, NaN, and Infinity geometry", () => {
    for (const patch of [
      { widthCm: 0 },
      { depthCm: -1 },
      { xCm: Number.NaN },
      { yCm: Number.POSITIVE_INFINITY },
    ]) {
      const result = evaluateLayoutConstraints(session([item(1, patch)]));
      expect(result.hardViolations.some((violation) => violation.ruleId === "HC-09")).toBe(true);
    }
  });

  it("scores configured soft rules and reports preferred-zone advice", () => {
    const result = evaluateLayoutConstraints(session(
      [item(1, { metadata: { zoneId: "preferred", roomFunction: "living", style: "warm" } })],
      {
        symmetryAxis: "vertical",
        focalPoint: { xCm: 400, yCm: 400 },
        roomFunction: "living",
        style: "warm",
        preferredZones: [{ id: "preferred", xCm: 300, yCm: 300, widthCm: 200, depthCm: 200 }],
      },
    ));
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-03")?.score).not.toBeNull();
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-05")?.score).not.toBeNull();
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-07")?.score).not.toBeNull();
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-08")?.score).not.toBeNull();
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-09")?.score).not.toBeNull();
  });

  it("is deterministic across repeated evaluations and stable rule ordering", () => {
    const input = session([item(2), item(1)]);
    const first = evaluateLayoutConstraints(input);
    const second = evaluateLayoutConstraints(input);
    expect({ ...first, metadata: { ...first.metadata, elapsedMs: 0 } }).toEqual({ ...second, metadata: { ...second.metadata, elapsedMs: 0 } });
    expect(first.ruleResults.map((rule) => rule.ruleId)).toEqual(second.ruleResults.map((rule) => rule.ruleId));
  });

  it("enforces session capacity and bounded 10/25/50 item scenarios", () => {
    for (const count of [10, 25, 50]) {
      const result = evaluateLayoutConstraints(session(
        Array.from({ length: count }, (_, index) => item(index, {
          xCm: 10 + (index % 10) * 75,
          yCm: 10 + Math.floor(index / 10) * 75,
          widthCm: 25,
          depthCm: 25,
        })),
      ));
      expect(result.metadata.itemsEvaluated).toBe(count);
      expect(result.metadata.pairChecks).toBe(count * (count - 1) / 2);
      expect(Number.isFinite(result.totalScore)).toBe(true);
    }

    const overCapacity = evaluateLayoutConstraints(session(
      Array.from({ length: 50 }, (_, index) => item(index, { xCm: 10 + index * 10, widthCm: 5, depthCm: 5 })),
      { maxPlacements: 49 },
    ));
    expect(overCapacity.hardViolations.some((violation) => violation.ruleId === "HC-10")).toBe(true);
  });

  it("returns window clearance as not applicable when metadata is absent", () => {
    const result = evaluateLayoutConstraints(session([item(1)]));
    expect(result.ruleResults.find((rule) => rule.ruleId === "HC-05")).toMatchObject({
      status: "not_applicable",
      score: null,
    });
  });

  it("returns walkway clearance as not applicable when no walkway is configured", () => {
    const result = evaluateLayoutConstraints(session([item(1)]));
    expect(result.ruleResults.find((rule) => rule.ruleId === "HC-06")?.status).toBe("not_applicable");
  });

  it("returns furniture spacing as not applicable when no minimum is configured", () => {
    const result = evaluateLayoutConstraints(session([
      item(1, { xCm: 100, yCm: 100 }),
      item(2, { xCm: 300, yCm: 300 }),
    ]));
    expect(result.ruleResults.find((rule) => rule.ruleId === "HC-07")?.status).toBe("not_applicable");
  });

  it("passes configured furniture spacing when the layout is separated", () => {
    const result = evaluateLayoutConstraints(session([
      item(1, { xCm: 100, yCm: 100, clearanceFrontCm: 10 }),
      item(2, { xCm: 300, yCm: 300 }),
    ], { minFurnitureClearanceCm: 10 }));
    expect(result.ruleResults.find((rule) => rule.ruleId === "HC-07")?.status).toBe("pass");
  });

  it("recognizes approved layouts as read-only evaluations", () => {
    const input = session([item(1)], { approvedForRendering: true });
    const before = structuredClone(input);
    const result = evaluateLayoutConstraints(input);
    expect(result.metadata.approvedLayout).toBe(true);
    expect(result.ruleResults.find((rule) => rule.ruleId === "HC-11")?.status).toBe("pass");
    expect(input).toEqual(before);
  });

  it("excludes archived placements from evaluation counts and pair checks", () => {
    const result = evaluateLayoutConstraints(session([
      item(1),
      item(2, { isArchived: true }),
    ]));
    expect(result.metadata.itemsEvaluated).toBe(1);
    expect(result.metadata.pairChecks).toBe(0);
  });

  it("keeps collision item IDs deterministic and sorted", () => {
    const result = evaluateLayoutConstraints(session([
      item(2, { xCm: 100, yCm: 100 }),
      item(1, { xCm: 110, yCm: 110 }),
    ]));
    const collision = result.hardViolations.find((violation) => violation.ruleId === "HC-02");
    expect(collision?.itemIds).toEqual([...collision!.itemIds].sort());
  });

  it("keeps rule results in the canonical hard-then-soft order", () => {
    const result = evaluateLayoutConstraints(session([]));
    expect(result.ruleResults.slice(0, 11).map((rule) => rule.ruleId)).toEqual([
      "HC-01", "HC-02", "HC-03", "HC-04", "HC-05", "HC-06", "HC-07", "HC-08", "HC-09", "HC-10", "HC-11",
    ]);
    expect(result.ruleResults.slice(11).map((rule) => rule.ruleId)).toEqual([
      "SC-01", "SC-02", "SC-03", "SC-04", "SC-05", "SC-06", "SC-07", "SC-08", "SC-09",
    ]);
  });

  it("keeps score breakdown weights normalized and finite", () => {
    const result = evaluateLayoutConstraints(session([item(1)]));
    expect(result.scoreBreakdown.reduce((sum, rule) => sum + rule.weight, 0)).toBe(100);
    expect(result.scoreBreakdown.every((rule) => Number.isFinite(rule.weightedScore))).toBe(true);
    expect(Number.isFinite(result.totalScore)).toBe(true);
  });

  it("does not reduce score for not-applicable soft rules", () => {
    const result = evaluateLayoutConstraints(session([item(1)]));
    const notApplicable = result.scoreBreakdown.filter((rule) => rule.status === "not_applicable");
    expect(notApplicable.length).toBeGreaterThan(0);
    expect(notApplicable.every((rule) => rule.score === null && rule.weightedScore === 0)).toBe(true);
  });

  it("reports excluded-zone remediation with the affected placement", () => {
    const result = evaluateLayoutConstraints(session([item(1, { xCm: 100, yCm: 100 })], {
      excludedZones: [{ id: "no-furniture", xCm: 90, yCm: 90, widthCm: 120, depthCm: 100 }],
    }));
    expect(result.suggestedRemediations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "HC-08", action: "clear_excluded_zone", itemIds: [ids[1]] }),
    ]));
  });

  it("reports door and window remediation actions separately", () => {
    const result = evaluateLayoutConstraints(session([item(1, { xCm: 100, yCm: 100 })], {
      doors: [{ id: "door", xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, clearanceCm: 20 }],
      windows: [{ id: "window", xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, clearanceCm: 20 }],
    }));
    expect(result.suggestedRemediations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "HC-04", action: "move_item_away_from_door" }),
      expect.objectContaining({ ruleId: "HC-05", action: "move_item_away_from_window" }),
    ]));
  });

  it("reports invalid geometry remediation without attempting correction", () => {
    const input = session([item(1, { widthCm: Number.NaN })]);
    const before = structuredClone(input);
    const result = evaluateLayoutConstraints(input);
    expect(result.suggestedRemediations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "HC-09", action: "review_geometry" }),
    ]));
    expect(input).toEqual(before);
  });

  it("evaluates room-function compatibility when metadata is complete", () => {
    const result = evaluateLayoutConstraints(session([
      item(1, { metadata: { compatibleRoomFunctions: ["living"] } }),
    ], { roomFunction: "living" }));
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-07")?.status).toBe("pass");
  });

  it("returns style compatibility as not applicable when item style is absent", () => {
    const result = evaluateLayoutConstraints(session([item(1)], { style: "warm" }));
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-08")?.status).toBe("not_applicable");
  });

  it("evaluates style compatibility when session and item styles match", () => {
    const result = evaluateLayoutConstraints(session([
      item(1, { metadata: { style: "warm" } }),
    ], { style: "warm" }));
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-08")?.score).toBe(100);
  });

  it("evaluates symmetry with a configured vertical axis", () => {
    const result = evaluateLayoutConstraints(session([item(1, { xCm: 360 })], { symmetryAxis: "vertical" }));
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-03")?.status).toBe("pass");
  });

  it("evaluates focal point orientation with a configured focal point", () => {
    const result = evaluateLayoutConstraints(session([item(1, { xCm: 350, yCm: 350 })], {
      focalPoint: { xCm: 400, yCm: 400 },
    }));
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-05")?.status).toBe("pass");
  });

  it("returns spacing balance as not applicable for a single item", () => {
    const result = evaluateLayoutConstraints(session([item(1)]));
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-06")?.status).toBe("not_applicable");
  });

  it("evaluates spacing balance for multiple separated items", () => {
    const result = evaluateLayoutConstraints(session([
      item(1, { xCm: 100, yCm: 100 }),
      item(2, { xCm: 400, yCm: 100 }),
      item(3, { xCm: 250, yCm: 400 }),
    ]));
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-06")?.status).toBe("pass");
  });

  it("evaluates preferred-zone adherence from canonical zones", () => {
    const result = evaluateLayoutConstraints(session([
      item(1, { xCm: 110, yCm: 110 }),
    ], {
      preferredZones: [{ id: "preferred", xCm: 100, yCm: 100, widthCm: 120, depthCm: 100 }],
    }));
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-09")?.score).toBe(100);
  });

  it("evaluates circulation quality when walkway metadata exists", () => {
    const result = evaluateLayoutConstraints(session([
      item(1, { xCm: 500, yCm: 500 }),
    ], {
      walkwayZones: [{ id: "walk", xCm: 100, yCm: 100, widthCm: 100, depthCm: 100 }],
    }));
    expect(result.ruleResults.find((rule) => rule.ruleId === "SC-02")?.status).toBe("pass");
  });

  it("preserves user input metadata and placement ordering", () => {
    const input = session([
      item(2, { metadata: { custom: "keep" } }),
      item(1, { metadata: { custom: "keep-too" } }),
    ]);
    const before = structuredClone(input);
    evaluateLayoutConstraints(input);
    expect(input).toEqual(before);
  });

  it("always returns the deterministic marker true", () => {
    expect(evaluateLayoutConstraints(session([])).deterministic).toBe(true);
  });

  it("returns all remediation item IDs as UUIDs from the evaluated layout", () => {
    const result = evaluateLayoutConstraints(session([
      item(1, { xCm: -5 }),
      item(2, { xCm: -5 }),
    ]));
    const knownIds = new Set(ids);
    expect(result.suggestedRemediations.flatMap((remediation) => remediation.itemIds).every((id) => knownIds.has(id))).toBe(true);
  });

  it("does not fabricate a window rule failure from unrelated collision data", () => {
    const result = evaluateLayoutConstraints(session([
      item(1, { xCm: 100, yCm: 100 }),
      item(2, { xCm: 130, yCm: 110 }),
    ]));
    expect(result.ruleResults.find((rule) => rule.ruleId === "HC-05")?.status).toBe("not_applicable");
  });

  it("keeps hard failures separate from soft warnings", () => {
    const result = evaluateLayoutConstraints(session([item(1, { xCm: -5 })]));
    expect(result.hardViolations.every((violation) => violation.ruleId.startsWith("HC-"))).toBe(true);
    expect(result.softWarnings.every((warning) => warning.ruleId.startsWith("SC-"))).toBe(true);
  });

  it("keeps pair checks bounded for 50 items", () => {
    const result = evaluateLayoutConstraints(session(
      Array.from({ length: 50 }, (_, index) => item(index, {
        xCm: 10 + (index % 10) * 75,
        yCm: 10 + Math.floor(index / 10) * 75,
        widthCm: 25,
        depthCm: 25,
      })),
    ));
    expect(result.metadata.pairChecks).toBe(1225);
    expect(result.metadata.pairChecks).toBeLessThanOrEqual(50 * 49 / 2);
  });
});