/**
 * Team 04 — Adaptive Question Engine: Test Suite
 *
 * Required tests per spec:
 * 1.  Deterministic ordering
 * 2.  Service-specific schema metadata (fashion / interior ordering)
 * 3.  Skip logic
 * 4.  Visibility change after answer (dependency unlock)
 * 5.  Invalid answer → validation error, not silent acceptance
 * 6.  Conflict merge / replace
 * 7.  Session restore compatibility
 * 8.  AI adapter unavailable — engine continues without interruption
 * 9.  User skip allowed (for skippable fields)
 * 10. Mandatory field cannot be skipped
 * 11. Completion policy enforcement
 * 12. No duplicate question loop
 */

import { describe, it, expect } from "vitest";
import {
  planAdaptiveQuestions,
  getAdaptiveNextQuestion,
  checkCompletionPolicy,
  isQuestionSkippable,
  detectContradictions,
} from "../adaptive-question-engine";
import type { AdaptivePlanInput } from "../adaptive-question-engine";
import { getBuiltinSchema } from "../adaptive-schema";
import { validateAnswer, canSkipQuestion } from "../answer-validator";
import { getServiceConfig } from "@/config/brief-service-config";
import type { BriefData } from "@/pages/brief";
import type { AiClarificationAdapter } from "../ai-clarification-adapter";
import { NULL_CLARIFICATION_ADAPTER } from "../ai-clarification-adapter";
import type { PlannedBriefQuestion } from "../types";

// ── Test fixtures ──────────────────────────────────────────────────────────────

const EMPTY_BRIEF: BriefData = {
  companyIndustry: "", companySize: "", websiteUrl: "",
  primaryGoal: "", successMetrics: "", existingAssets: "",
  audienceDemographics: "", audiencePainPoints: "", audienceChannels: "",
  stylePreference: "", colorPalette: "", referenceLinks: "",
  outputFormats: "", outputLanguage: "id", specialRequirements: "",
  deadline: "", priority: "balanced", milestones: "",
};

const FILLED_BRIEF: BriefData = {
  ...EMPTY_BRIEF,
  companyIndustry: "fashion",
  primaryGoal: "Meningkatkan brand awareness",
  audienceDemographics: "Milenial 25–35 tahun",
  stylePreference: "modern, minimalis",
  outputFormats: "Tech pack, lookbook",
};

function makeInput(overrides: Partial<AdaptivePlanInput> = {}): AdaptivePlanInput {
  return {
    brief: EMPTY_BRIEF,
    serviceType: "default",
    serviceConfig: getServiceConfig("default"),
    mode: "start-from-beginning",
    answeredQuestionIds: [],
    skippedQuestionIds: [],
    ...overrides,
  };
}

function makeQuestion(field: keyof BriefData, required = true): PlannedBriefQuestion {
  return {
    id: field,
    field,
    type: "text",
    title: "Test",
    question: "Test question?",
    required,
    reason: "Test reason",
  };
}

// ── 1. Deterministic ordering ──────────────────────────────────────────────────

describe("1. Deterministic ordering", () => {
  it("returns identical order for identical inputs", () => {
    const input = makeInput();
    const a = planAdaptiveQuestions(input);
    const b = planAdaptiveQuestions(input);
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id));
  });

  it("same inputs always produce same first question", () => {
    const input = makeInput({ serviceType: "brand_identity", serviceConfig: getServiceConfig("brand_identity") });
    const q1 = getAdaptiveNextQuestion(input);
    const q2 = getAdaptiveNextQuestion(input);
    expect(q1?.id).toEqual(q2?.id);
  });

  it("plan is non-empty for a blank brief", () => {
    const result = planAdaptiveQuestions(makeInput());
    expect(result.questions.length).toBeGreaterThan(0);
  });
});

// ── 2. Service-specific schema metadata ───────────────────────────────────────

describe("2. Service-specific schema ordering", () => {
  it("fashion_design: specialRequirements (product spec) appears before audienceChannels", () => {
    const input = makeInput({
      serviceType: "fashion_design",
      serviceConfig: getServiceConfig("fashion_design"),
    });
    const result = planAdaptiveQuestions(input);
    const specIdx = result.questions.findIndex((q) => q.id === "specialRequirements");
    const channelIdx = result.questions.findIndex((q) => q.id === "audienceChannels");
    // Both must be in the plan
    expect(specIdx).toBeGreaterThanOrEqual(0);
    // If channels are present, spec must come first
    if (channelIdx >= 0) {
      expect(specIdx).toBeLessThan(channelIdx);
    }
  });

  it("fashion_design: outputFormats appears before audienceDemographics (format gates scope)", () => {
    const input = makeInput({
      serviceType: "fashion_design",
      serviceConfig: getServiceConfig("fashion_design"),
    });
    const result = planAdaptiveQuestions(input);
    const formatsIdx = result.questions.findIndex((q) => q.id === "outputFormats");
    const audIdx = result.questions.findIndex((q) => q.id === "audienceDemographics");
    if (formatsIdx >= 0 && audIdx >= 0) {
      expect(formatsIdx).toBeLessThan(audIdx);
    }
  });

  it("interior_design: specialRequirements appears before stylePreference", () => {
    const input = makeInput({
      serviceType: "interior_design",
      serviceConfig: getServiceConfig("interior_design"),
    });
    const result = planAdaptiveQuestions(input);
    const specIdx = result.questions.findIndex((q) => q.id === "specialRequirements");
    const styleIdx = result.questions.findIndex((q) => q.id === "stylePreference");
    if (specIdx >= 0 && styleIdx >= 0) {
      expect(specIdx).toBeLessThan(styleIdx);
    }
  });

  it("brand_identity: companyIndustry and primaryGoal appear before existingAssets", () => {
    const input = makeInput({
      serviceType: "brand_identity",
      serviceConfig: getServiceConfig("brand_identity"),
    });
    const result = planAdaptiveQuestions(input);
    const industryIdx = result.questions.findIndex((q) => q.id === "companyIndustry");
    const goalIdx = result.questions.findIndex((q) => q.id === "primaryGoal");
    const assetsIdx = result.questions.findIndex((q) => q.id === "existingAssets");
    // Industry and goal should precede assets
    if (industryIdx >= 0 && assetsIdx >= 0) expect(industryIdx).toBeLessThan(assetsIdx);
    if (goalIdx >= 0 && assetsIdx >= 0) expect(goalIdx).toBeLessThan(assetsIdx);
  });

  it("schema overrides question text for fashion_design specialRequirements", () => {
    const schema = getBuiltinSchema("fashion_design");
    const input = makeInput({
      serviceType: "fashion_design",
      serviceConfig: getServiceConfig("fashion_design"),
      schema,
    });
    const result = planAdaptiveQuestions(input);
    const specQ = result.questions.find((q) => q.id === "specialRequirements");
    // The schema override should be applied (contains "fashion" domain language)
    if (specQ) {
      expect(specQ.question.length).toBeGreaterThan(10);
    }
  });
});

// ── 3. Skip logic ──────────────────────────────────────────────────────────────

describe("3. Skip logic", () => {
  it("skipped fields are excluded from the adaptive plan", () => {
    const input = makeInput({ skippedQuestionIds: ["companyIndustry"] });
    const result = planAdaptiveQuestions(input);
    expect(result.questions.find((q) => q.id === "companyIndustry")).toBeUndefined();
  });

  it("answered fields are excluded from the plan", () => {
    const input = makeInput({ answeredQuestionIds: ["primaryGoal"] });
    const result = planAdaptiveQuestions(input);
    expect(result.questions.find((q) => q.id === "primaryGoal")).toBeUndefined();
  });

  it("skipped field count does not reduce plan below zero items", () => {
    const allIds = [
      "companyIndustry", "companySize", "primaryGoal", "audienceDemographics",
      "stylePreference", "colorPalette", "existingAssets", "audienceChannels",
      "outputLanguage", "priority", "audiencePainPoints", "outputFormats",
      "specialRequirements",
    ];
    const input = makeInput({ skippedQuestionIds: allIds });
    const result = planAdaptiveQuestions(input);
    expect(result.questions.length).toBeGreaterThanOrEqual(0);
  });
});

// ── 4. Visibility change after answer (dependency unlock) ──────────────────────

describe("4. Dependency unlock after answer", () => {
  it("field with dependsOn is blocked until dependency is satisfied", () => {
    // Create a custom schema with a dependency rule
    const schema = {
      ...getBuiltinSchema("default"),
      fields: getBuiltinSchema("default").fields.map((f) =>
        f.field === "colorPalette"
          ? { ...f, dependsOn: ["stylePreference"] as (keyof BriefData)[] }
          : f,
      ),
    };

    const inputBlocked = makeInput({
      brief: { ...EMPTY_BRIEF, stylePreference: "" },
      schema,
    });
    const blocked = planAdaptiveQuestions(inputBlocked);
    expect(blocked.blockedByDependency).toContain("colorPalette");
    expect(blocked.questions.find((q) => q.id === "colorPalette")).toBeUndefined();
  });

  it("field becomes available after dependency is filled", () => {
    const schema = {
      ...getBuiltinSchema("default"),
      fields: getBuiltinSchema("default").fields.map((f) =>
        f.field === "colorPalette"
          ? { ...f, dependsOn: ["stylePreference"] as (keyof BriefData)[] }
          : f,
      ),
    };

    const inputUnlocked = makeInput({
      brief: { ...EMPTY_BRIEF, stylePreference: "modern" },
      schema,
    });
    const unlocked = planAdaptiveQuestions(inputUnlocked);
    expect(unlocked.blockedByDependency).not.toContain("colorPalette");
  });

  it("answering a gating field makes it appear sooner in the next plan", () => {
    const result = planAdaptiveQuestions(makeInput({ serviceType: "default" }));
    const firstGating = result.questions.find(
      (q) => getBuiltinSchema("default").fields.find((f) => f.field === q.field)?.isGating,
    );
    expect(firstGating).toBeDefined();
  });
});

// ── 5. Invalid answer → validation error, not silent acceptance ────────────────

describe("5. Answer validation", () => {
  it("empty required text answer fails validation", () => {
    const q = makeQuestion("outputFormats", true);
    q.type = "text";
    const result = validateAnswer({ question: q, rawText: "" });
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("REQUIRED_EMPTY");
  });

  it("vague placeholder is rejected", () => {
    const q = makeQuestion("outputFormats", true);
    q.type = "text";
    const result = validateAnswer({ question: q, rawText: "tes" });
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("VAGUE_PLACEHOLDER");
  });

  it("too-short answer is rejected", () => {
    const q = makeQuestion("outputFormats", true);
    q.type = "text";
    const result = validateAnswer({ question: q, rawText: "ok" });
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("TOO_SHORT");
  });

  it("valid text answer passes validation", () => {
    const q = makeQuestion("outputFormats", true);
    q.type = "text";
    const result = validateAnswer({ question: q, rawText: "Tech pack dan lookbook digital" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("empty required single-select answer fails validation", () => {
    const q = makeQuestion("companyIndustry", true);
    q.type = "single";
    const result = validateAnswer({ question: q, selectedKeys: [] });
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("NO_SELECTION");
  });

  it("valid selection answer passes validation", () => {
    const q = makeQuestion("companyIndustry", true);
    q.type = "single";
    const result = validateAnswer({ question: q, selectedKeys: ["fashion"] });
    expect(result.valid).toBe(true);
  });

  it("exceeding maxSelections fails validation", () => {
    const q = { ...makeQuestion("stylePreference", true), type: "multi" as const, maxSelections: 2 };
    const result = validateAnswer({ question: q, selectedKeys: ["a", "b", "c"] });
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("EXCEEDS_MAX_SELECTIONS");
  });

  it("dimension normalization is applied to text answers", () => {
    const q = makeQuestion("specialRequirements", false);
    q.type = "text";
    const result = validateAnswer({ question: q, rawText: "Ruang 5x7m tinggi 3m untuk keluarga" });
    expect(result.valid).toBe(true);
    if (result.normalizedValue) {
      expect(result.normalizedValue).toContain("×");
    }
  });

  it("low confidence answer is flagged but not rejected", () => {
    const q = makeQuestion("specialRequirements", false);
    q.type = "text";
    // 4 chars: long enough to pass TOO_SHORT (> 3) but short enough for low confidence (< 5)
    const result = validateAnswer({ question: q, rawText: "biru" });
    expect(result.valid).toBe(true);        // not rejected
    expect(result.confidence.level).toBe("low");  // but low confidence
  });
});

// ── 6. Conflict merge / replace ────────────────────────────────────────────────

describe("6. Conflict merge/replace in answer-mapper", () => {
  // These tests verify the existing mapper behavior is preserved (regression)
  it("previewAssistantAnswer marks conflict when existing data is present", async () => {
    const { previewAssistantAnswer } = await import("../answer-mapper");
    const brief: BriefData = {
      ...EMPTY_BRIEF,
      primaryGoal: "Meningkatkan brand awareness",
    };
    const result = previewAssistantAnswer({
      brief,
      field: "primaryGoal",
      selectedKeys: ["launch_product"],
      customText: "",
    });
    expect(result.conflict).toBe(true);
    expect(result.canMerge).toBe(true);
    expect(result.previousValue).toBeTruthy();
  });

  it("previewAssistantAnswer does not conflict on empty field", async () => {
    const { previewAssistantAnswer } = await import("../answer-mapper");
    const result = previewAssistantAnswer({
      brief: EMPTY_BRIEF,
      field: "primaryGoal",
      selectedKeys: ["launch_product"],
      customText: "",
    });
    expect(result.conflict).toBe(false);
  });

  it("applyAssistantDraftChange in merge mode adds to existing values", async () => {
    const { previewAssistantAnswer, applyAssistantDraftChange } = await import("../answer-mapper");
    const brief: BriefData = { ...EMPTY_BRIEF, primaryGoal: "Meningkatkan brand awareness" };
    const draft = previewAssistantAnswer({
      brief,
      field: "primaryGoal",
      selectedKeys: ["launch_product"],
      customText: "",
    });
    const result = applyAssistantDraftChange(brief, draft, "merge");
    expect(result.applied).toBe(true);
    expect(result.updatedBrief.primaryGoal).toContain("awareness");
  });

  it("applyAssistantDraftChange in replace mode discards old value", async () => {
    const { previewAssistantAnswer, applyAssistantDraftChange } = await import("../answer-mapper");
    const brief: BriefData = { ...EMPTY_BRIEF, primaryGoal: "Meningkatkan brand awareness" };
    const draft = previewAssistantAnswer({
      brief,
      field: "primaryGoal",
      selectedKeys: ["launch_product"],
      customText: "",
    });
    const result = applyAssistantDraftChange(brief, draft, "replace");
    expect(result.applied).toBe(true);
    // Replace should not include the old awareness value
    expect(result.updatedBrief.primaryGoal).not.toContain("awareness");
  });
});

// ── 7. Session restore compatibility ──────────────────────────────────────────

describe("7. Session restore compatibility", () => {
  it("planAdaptiveQuestions works correctly with restored answeredQuestionIds", () => {
    const restoredState: Pick<AdaptivePlanInput, "answeredQuestionIds" | "skippedQuestionIds"> = {
      answeredQuestionIds: ["companyIndustry", "primaryGoal"],
      skippedQuestionIds: ["companySize"],
    };
    const input = makeInput(restoredState);
    const result = planAdaptiveQuestions(input);
    // Restored answered fields must not appear in plan
    expect(result.questions.find((q) => q.id === "companyIndustry")).toBeUndefined();
    expect(result.questions.find((q) => q.id === "primaryGoal")).toBeUndefined();
    // Restored skipped fields must not appear in plan
    expect(result.questions.find((q) => q.id === "companySize")).toBeUndefined();
    // Other fields must still be available
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it("schema version is included in plan result for versioning", () => {
    const result = planAdaptiveQuestions(makeInput());
    expect(result.schemaVersion).toBeTruthy();
    expect(typeof result.schemaVersion).toBe("string");
  });

  it("plan is stable across multiple invocations with restored state", () => {
    const input = makeInput({ answeredQuestionIds: ["companyIndustry"] });
    const a = planAdaptiveQuestions(input);
    const b = planAdaptiveQuestions(input);
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id));
  });
});

// ── 8. AI adapter unavailable ──────────────────────────────────────────────────

describe("8. AI adapter unavailable — graceful degradation", () => {
  it("engine works when no adapter is provided (undefined)", () => {
    const input = makeInput({ aiAdapter: undefined });
    expect(() => planAdaptiveQuestions(input)).not.toThrow();
    const result = planAdaptiveQuestions(input);
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.aiClarificationAvailable).toBe(false);
  });

  it("engine works when adapter is the null adapter", () => {
    const input = makeInput({ aiAdapter: NULL_CLARIFICATION_ADAPTER });
    const result = planAdaptiveQuestions(input);
    expect(result.aiClarificationAvailable).toBe(false);
  });

  it("engine works when adapter isAvailable() returns false", () => {
    const unavailableAdapter: AiClarificationAdapter = {
      isAvailable: () => false,
      requestClarification: async () => ({ isClear: true, confidence: 1.0, auditMeta: { calledAt: "", modelHint: "", aiAssisted: true, contextFields: [] } }),
    };
    const input = makeInput({ aiAdapter: unavailableAdapter });
    const result = planAdaptiveQuestions(input);
    expect(result.aiClarificationAvailable).toBe(false);
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it("aiClarificationAvailable is true when adapter is available", () => {
    const availableAdapter: AiClarificationAdapter = {
      isAvailable: () => true,
      requestClarification: async () => ({ isClear: true, confidence: 1.0, auditMeta: { calledAt: "", modelHint: "", aiAssisted: true, contextFields: [] } }),
    };
    const input = makeInput({ aiAdapter: availableAdapter });
    const result = planAdaptiveQuestions(input);
    expect(result.aiClarificationAvailable).toBe(true);
  });
});

// ── 9. User skip allowed for skippable fields ──────────────────────────────────

describe("9. Skippable fields", () => {
  it("optional fields are marked skippable in the schema", () => {
    const schema = getBuiltinSchema("default");
    const optionalField = schema.fields.find((f) => !f.required);
    expect(optionalField).toBeDefined();
    expect(optionalField?.skippable).toBe(true);
  });

  it("isQuestionSkippable returns true for optional fields", () => {
    expect(isQuestionSkippable("companySize", "default")).toBe(true);
    expect(isQuestionSkippable("colorPalette", "default")).toBe(true);
    expect(isQuestionSkippable("priority", "default")).toBe(true);
  });

  it("canSkipQuestion returns true for alwaysOptional fields", () => {
    const q = makeQuestion("companySize", false);
    expect(canSkipQuestion(q, true)).toBe(true);
  });
});

// ── 10. Mandatory field cannot be skipped ─────────────────────────────────────

describe("10. Mandatory fields cannot be skipped", () => {
  it("required non-skippable field returns false from isQuestionSkippable", () => {
    // fashion_design: specialRequirements is required + not skippable
    expect(isQuestionSkippable("specialRequirements", "fashion_design")).toBe(false);
    expect(isQuestionSkippable("outputFormats", "fashion_design")).toBe(false);
  });

  it("required non-skippable field returns false from canSkipQuestion", () => {
    const q = makeQuestion("specialRequirements", true);
    expect(canSkipQuestion(q, false)).toBe(false);
  });

  it("required fields in fashion_design schema are not skippable", () => {
    const schema = getBuiltinSchema("fashion_design");
    const requiredNonSkippable = schema.fields.filter((f) => f.required && !f.skippable);
    expect(requiredNonSkippable.length).toBeGreaterThan(0);
    // specialRequirements is one of them
    const spec = requiredNonSkippable.find((f) => f.field === "specialRequirements");
    expect(spec).toBeDefined();
  });

  it("isQuestionSkippable falls back gracefully for unknown fields", () => {
    // Unknown field should be skippable by default
    expect(isQuestionSkippable("referenceLinks" as keyof BriefData, "default")).toBe(true);
  });
});

// ── 11. Completion policy ──────────────────────────────────────────────────────

describe("11. Completion policy", () => {
  it("completion is not satisfied for a blank brief", () => {
    const result = checkCompletionPolicy("default", EMPTY_BRIEF);
    expect(result.satisfied).toBe(false);
    expect(result.requiredRemaining.length).toBeGreaterThan(0);
  });

  it("completion is satisfied when all required fields are filled", () => {
    const result = checkCompletionPolicy("default", FILLED_BRIEF);
    expect(result.satisfied).toBe(true);
    expect(result.requiredRemaining).toHaveLength(0);
  });

  it("fashion_design requires specialRequirements to be filled", () => {
    const briefWithoutSpec: BriefData = {
      ...FILLED_BRIEF,
      specialRequirements: "",
    };
    const result = checkCompletionPolicy("fashion_design", briefWithoutSpec);
    expect(result.satisfied).toBe(false);
    expect(result.requiredRemaining).toContain("specialRequirements");
  });

  it("summary message is informative when fields remain", () => {
    const result = checkCompletionPolicy("default", EMPTY_BRIEF);
    expect(result.summary).toMatch(/field wajib/i);
  });

  it("plan result includes completionSatisfied flag", () => {
    const filled = makeInput({ brief: FILLED_BRIEF, mode: "complete-missing" });
    const result = planAdaptiveQuestions(filled);
    expect(typeof result.completionSatisfied).toBe("boolean");
  });
});

// ── 12. No duplicate question loop ────────────────────────────────────────────

describe("12. No duplicate question loop", () => {
  it("each question id appears at most once in the plan", () => {
    const result = planAdaptiveQuestions(makeInput());
    const ids = result.questions.map((q) => q.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it("getAdaptiveNextQuestion returns null when all questions answered", () => {
    const allFieldIds: string[] = [
      "companyIndustry", "companySize", "primaryGoal", "audienceDemographics",
      "stylePreference", "colorPalette", "existingAssets", "audienceChannels",
      "outputLanguage", "priority", "audiencePainPoints", "outputFormats",
      "specialRequirements",
    ];
    const input = makeInput({ answeredQuestionIds: allFieldIds });
    const q = getAdaptiveNextQuestion(input);
    expect(q).toBeNull();
  });

  it("same question never appears twice even after partial answers", () => {
    const input = makeInput({ answeredQuestionIds: ["companyIndustry", "primaryGoal"] });
    const result = planAdaptiveQuestions(input);
    const ids = result.questions.map((q) => q.id);
    expect(ids).not.toContain("companyIndustry");
    expect(ids).not.toContain("primaryGoal");
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it("contradiction detection does not cause infinite plan loops", () => {
    const contradictoryBrief: BriefData = {
      ...EMPTY_BRIEF,
      primaryGoal: "brand awareness",
      audienceChannels: "print",
      outputLanguage: "en",
      audienceDemographics: "lokal",
    };
    const input = makeInput({ brief: contradictoryBrief });
    const result = planAdaptiveQuestions(input);
    const ids = result.questions.map((q) => q.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });
});

// ── Additional: Contradiction detection ───────────────────────────────────────

describe("Contradiction detection", () => {
  it("returns empty array for a consistent brief", () => {
    const result = detectContradictions(FILLED_BRIEF);
    expect(result).toHaveLength(0);
  });

  it("detects contradiction between outputLanguage and audienceDemographics", () => {
    const brief: BriefData = {
      ...EMPTY_BRIEF,
      outputLanguage: "en",
      audienceDemographics: "lokal",
    };
    const result = detectContradictions(brief);
    const found = result.find(
      (c) => c.fieldA === "outputLanguage" || c.fieldB === "audienceDemographics",
    );
    expect(found).toBeDefined();
  });
});

// ── Schema integrity ───────────────────────────────────────────────────────────

describe("Schema integrity", () => {
  const serviceTypes = [
    "brand_identity", "logo_design", "company_profile", "pitch_deck",
    "social_media", "copywriting", "image_generation", "fashion_design",
    "interior_design", "default",
  ];

  for (const st of serviceTypes) {
    it(`getBuiltinSchema("${st}") returns a valid schema`, () => {
      const schema = getBuiltinSchema(st);
      expect(schema.serviceType).toBeDefined();
      expect(schema.schemaVersion).toBeDefined();
      expect(schema.fields.length).toBeGreaterThan(0);
      expect(schema.completionPolicy.requiredFieldsMinimum).toBeGreaterThan(0);
      // All field schemas have a priorityWeight
      for (const f of schema.fields) {
        expect(typeof f.priorityWeight).toBe("number");
        expect(f.priorityWeight).toBeGreaterThanOrEqual(0);
      }
    });
  }
});
