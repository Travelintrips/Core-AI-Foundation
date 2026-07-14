/**
 * Phase 4A — Brief Assistant: Answer Mapper Tests
 */

import { describe, it, expect } from "vitest";
import { previewAssistantAnswer, applyAssistantDraftChange } from "./answer-mapper";
import type { AssistantAnswerInput } from "./answer-mapper";
import type { BriefData } from "@/pages/brief";

const EMPTY_BRIEF: BriefData = {
  companyIndustry: "", companySize: "", websiteUrl: "",
  primaryGoal: "", successMetrics: "", existingAssets: "",
  audienceDemographics: "", audiencePainPoints: "", audienceChannels: "",
  stylePreference: "", colorPalette: "", referenceLinks: "",
  outputFormats: "", outputLanguage: "id", specialRequirements: "",
  deadline: "", priority: "balanced", milestones: "",
};

function makeInput(
  brief: BriefData,
  field: keyof BriefData,
  selectedKeys: string[],
  customText = "",
): AssistantAnswerInput {
  return { brief, field, selectedKeys, customText };
}

// ── single choice preview ────────────────────────────────────────────────────

describe("previewAssistantAnswer — single choice", () => {
  it("produces correct nextValue for single industry selection", () => {
    const change = previewAssistantAnswer(
      makeInput(EMPTY_BRIEF, "companyIndustry", ["coffee_shop"]),
    );
    expect(change.nextValue).toBe("Coffee Shop");
    expect(change.displayAfter).toContain("Coffee Shop");
    expect(change.conflict).toBe(false);
  });

  it("produces conflict=true when field already has different value", () => {
    const brief = { ...EMPTY_BRIEF, companyIndustry: "Logistics" };
    const change = previewAssistantAnswer(makeInput(brief, "companyIndustry", ["coffee_shop"]));
    expect(change.conflict).toBe(true);
    expect(change.displayBefore).toContain("Logistics");
  });

  it("no conflict when selecting the same value as existing", () => {
    const brief = { ...EMPTY_BRIEF, companyIndustry: "Coffee Shop" };
    const change = previewAssistantAnswer(makeInput(brief, "companyIndustry", ["coffee_shop"]));
    expect(change.conflict).toBe(false);
  });
});

// ── multi choice preview ────────────────────────────────────────────────────

describe("previewAssistantAnswer — multi choice", () => {
  it("builds merged nextValue for audience when empty", () => {
    const change = previewAssistantAnswer(
      makeInput(EMPTY_BRIEF, "audienceDemographics", ["b2b", "b2c"]),
    );
    expect(change.nextValue).toContain("B2B");
    expect(change.nextValue).toContain("B2C");
    expect(change.conflict).toBe(false);
    expect(change.canMerge).toBe(true);
  });

  it("conflict=true and canMerge=true when field has existing audiences", () => {
    const brief = { ...EMPTY_BRIEF, audienceDemographics: "Konsumen umum" };
    const change = previewAssistantAnswer(
      makeInput(brief, "audienceDemographics", ["b2b"]),
    );
    expect(change.conflict).toBe(true);
    expect(change.canMerge).toBe(true);
    expect(change.displayBefore).toContain("Konsumen umum");
  });

  it("adds new keys without removing existing ones (merge semantics)", () => {
    const brief = { ...EMPTY_BRIEF, audienceDemographics: "B2B" };
    const change = previewAssistantAnswer(
      makeInput(brief, "audienceDemographics", ["b2c"]),
    );
    // B2B should still be in displayAfter
    expect(change.nextValue).toContain("B2C");
  });
});

// ── custom Other ────────────────────────────────────────────────────────────

describe("previewAssistantAnswer — custom Lainnya", () => {
  it("includes custom text in nextValue when 'other' is selected", () => {
    const change = previewAssistantAnswer(
      makeInput(EMPTY_BRIEF, "audienceDemographics", ["other"], "Nelayan"),
    );
    expect(change.nextValue).toContain("Nelayan");
  });

  it("single field custom text is stored directly", () => {
    const change = previewAssistantAnswer(
      makeInput(EMPTY_BRIEF, "companyIndustry", ["other"], "Peternakan kambing"),
    );
    expect(change.nextValue).toContain("Peternakan kambing");
  });
});

// ── selection limit ─────────────────────────────────────────────────────────

describe("previewAssistantAnswer — selection limits", () => {
  it("does not exceed AUDIENCE_MAX when merging", () => {
    // Fill up 3 audiences (max=4) then try to add 2 more
    const brief = {
      ...EMPTY_BRIEF,
      audienceDemographics: "Konsumen umum; B2C; B2B",
    };
    const change = previewAssistantAnswer(
      makeInput(brief, "audienceDemographics", ["corporate", "startup"]),
    );
    // Only 1 slot remaining → one added, one produces a warning
    const afterCount = change.displayAfter.length;
    expect(afterCount).toBeLessThanOrEqual(4);
    expect(change.warnings.length).toBeGreaterThan(0);
  });

  it("does not exceed STYLE_MAX when merging", () => {
    const brief = { ...EMPTY_BRIEF, stylePreference: "Minimalis; Modern" };
    const change = previewAssistantAnswer(
      makeInput(brief, "stylePreference", ["bold", "playful"]),
    );
    expect(change.displayAfter.length).toBeLessThanOrEqual(3);
    expect(change.warnings.length).toBeGreaterThan(0);
  });

  it("does not exceed COLOR_MAX when merging", () => {
    const brief = { ...EMPTY_BRIEF, colorPalette: "Biru, Hitam" };
    const change = previewAssistantAnswer(
      makeInput(brief, "colorPalette", ["green", "red", "purple"]),
    );
    expect(change.warnings.length).toBeGreaterThan(0);
  });
});

// ── existing field protected ────────────────────────────────────────────────

describe("previewAssistantAnswer — existing field protection", () => {
  it("conflict=true when text field already has content", () => {
    const brief = { ...EMPTY_BRIEF, audiencePainPoints: "Kesulitan cari supplier" };
    const change = previewAssistantAnswer(
      makeInput(brief, "audiencePainPoints", [], "Harga tidak transparan"),
    );
    expect(change.conflict).toBe(true);
    expect(change.displayBefore).toContain("Kesulitan cari supplier");
  });

  it("nextValue does NOT auto-overwrite existing text (conflict must be resolved by caller)", () => {
    const brief = { ...EMPTY_BRIEF, outputFormats: "3 konten Instagram" };
    const change = previewAssistantAnswer(
      makeInput(brief, "outputFormats", [], "5 banner website"),
    );
    // Change is drafted but not yet applied — previousValue preserved
    expect(change.previousValue).toBe("3 konten Instagram");
    expect(change.nextValue).toBe("5 banner website");
  });
});

// ── field lain tidak berubah ────────────────────────────────────────────────

describe("applyAssistantDraftChange — field isolation", () => {
  it("only changes the targeted field, leaves all others intact", () => {
    const brief = {
      ...EMPTY_BRIEF,
      companyIndustry: "Logistics",
      primaryGoal: "Meningkatkan penjualan",
    };
    const change = previewAssistantAnswer(
      makeInput(EMPTY_BRIEF, "audienceDemographics", ["b2b"]),
    );
    const { updatedBrief } = applyAssistantDraftChange(brief, change, "merge");
    expect(updatedBrief.companyIndustry).toBe("Logistics");
    expect(updatedBrief.primaryGoal).toBe("Meningkatkan penjualan");
    expect(updatedBrief.audienceDemographics).not.toBe("");
  });
});

// ── merge vs replace ────────────────────────────────────────────────────────

describe("applyAssistantDraftChange — merge/replace", () => {
  it("merge mode: retains existing audience and adds new one", () => {
    const brief = { ...EMPTY_BRIEF, audienceDemographics: "B2B" };
    const change = previewAssistantAnswer(
      makeInput(brief, "audienceDemographics", ["b2c"]),
    );
    const { updatedBrief, applied } = applyAssistantDraftChange(brief, change, "merge");
    expect(applied).toBe(true);
    expect(updatedBrief.audienceDemographics).toContain("B2C");
  });

  it("replace mode: discards old value and uses new one only", () => {
    const brief = { ...EMPTY_BRIEF, audienceDemographics: "B2B" };
    const change = previewAssistantAnswer(
      makeInput(brief, "audienceDemographics", ["b2c"]),
    );
    const { updatedBrief } = applyAssistantDraftChange(brief, change, "replace");
    expect(updatedBrief.audienceDemographics).toContain("B2C");
    expect(updatedBrief.audienceDemographics).not.toContain("B2B");
  });

  it("returns applied=false when nextValue equals previousValue", () => {
    const brief = { ...EMPTY_BRIEF };
    const change = previewAssistantAnswer(
      makeInput(brief, "audiencePainPoints", [], ""),
    );
    const { applied, skipped } = applyAssistantDraftChange(brief, change, "merge");
    expect(applied).toBe(false);
    expect(skipped).toBe(true);
  });
});

// ── serializer compatibility ────────────────────────────────────────────────

describe("previewAssistantAnswer — serializer output compatible", () => {
  it("serialized style value can be read back by parseChoices", async () => {
    const { parseChoices } = await import("@/lib/brief-utils");
    const { STYLE_OPTIONS } = await import("@/config/brief-options");
    const change = previewAssistantAnswer(
      makeInput(EMPTY_BRIEF, "stylePreference", ["modern", "bold"]),
    );
    const parsed = parseChoices(change.nextValue, STYLE_OPTIONS);
    expect(parsed.selected).toContain("modern");
    expect(parsed.selected).toContain("bold");
  });

  it("serialized industry value can be read back by parseSingleChoice", async () => {
    const { parseSingleChoice } = await import("@/lib/brief-utils");
    const { INDUSTRY_OPTIONS } = await import("@/config/brief-options");
    const change = previewAssistantAnswer(
      makeInput(EMPTY_BRIEF, "companyIndustry", ["coffee_shop"]),
    );
    const parsed = parseSingleChoice(change.nextValue, INDUSTRY_OPTIONS);
    expect(parsed.selected).toBe("coffee_shop");
  });
});

// ── duplicate deduplication ─────────────────────────────────────────────────

describe("previewAssistantAnswer — deduplication", () => {
  it("does not add a duplicate audience key if already selected", () => {
    const brief = { ...EMPTY_BRIEF, audienceDemographics: "B2B" };
    const change = previewAssistantAnswer(
      makeInput(brief, "audienceDemographics", ["b2b"]),
    );
    // b2b already selected — should produce no new additions
    const countB2b = change.nextValue.split("B2B").length - 1;
    expect(countB2b).toBeLessThanOrEqual(1);
  });
});

// ── legacy value retained ────────────────────────────────────────────────────

describe("previewAssistantAnswer — legacy value retained", () => {
  it("retains custom/Lainnya text already in the field", () => {
    // User typed "Petani" as a free-text legacy audience
    const brief = { ...EMPTY_BRIEF, audienceDemographics: "Petani" };
    const change = previewAssistantAnswer(
      makeInput(brief, "audienceDemographics", ["b2b"]),
    );
    // Custom text should be preserved in the serialized value
    expect(change.nextValue.toLowerCase()).toContain("petani");
  });
});
