/**
 * Phase 4A — Brief Assistant: Question Planner Tests
 */

import { describe, it, expect } from "vitest";
import { planBriefQuestions, getNextBriefQuestion } from "./question-planner";
import type { PlanInput } from "./question-planner";
import { getServiceConfig } from "@/config/brief-service-config";
import type { BriefData } from "@/pages/brief";

const EMPTY_BRIEF: BriefData = {
  companyIndustry: "", companySize: "", websiteUrl: "",
  primaryGoal: "", successMetrics: "", existingAssets: "",
  audienceDemographics: "", audiencePainPoints: "", audienceChannels: "",
  stylePreference: "", colorPalette: "", referenceLinks: "",
  outputFormats: "", outputLanguage: "id", specialRequirements: "",
  deadline: "", priority: "balanced", milestones: "",
};

function makeInput(overrides: Partial<PlanInput> = {}): PlanInput {
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

describe("planBriefQuestions — determinism", () => {
  it("returns the same result for identical inputs", () => {
    const input = makeInput();
    const a = planBriefQuestions(input);
    const b = planBriefQuestions(input);
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
  });

  it("returns an array of planned questions (never empty for full blank brief)", () => {
    const qs = planBriefQuestions(makeInput());
    expect(qs.length).toBeGreaterThan(0);
  });

  it("each question has a non-empty id, field, question text, and reason", () => {
    const qs = planBriefQuestions(makeInput());
    for (const q of qs) {
      expect(q.id).toBeTruthy();
      expect(q.field).toBeTruthy();
      expect(q.question).toBeTruthy();
      expect(q.reason).toBeTruthy();
    }
  });
});

describe("planBriefQuestions — required fields prioritized", () => {
  it("companyIndustry appears before optional fields in default plan", () => {
    const qs = planBriefQuestions(makeInput());
    const industryIdx = qs.findIndex((q) => q.id === "companyIndustry");
    const sizeIdx = qs.findIndex((q) => q.id === "companySize");
    expect(industryIdx).toBeGreaterThanOrEqual(0);
    if (sizeIdx >= 0) expect(industryIdx).toBeLessThan(sizeIdx);
  });

  it("required fields have required=true", () => {
    const qs = planBriefQuestions(makeInput());
    const industry = qs.find((q) => q.id === "companyIndustry");
    expect(industry?.required).toBe(true);
    const goal = qs.find((q) => q.id === "primaryGoal");
    expect(goal?.required).toBe(true);
    const audience = qs.find((q) => q.id === "audienceDemographics");
    expect(audience?.required).toBe(true);
  });
});

describe("planBriefQuestions — filled fields not re-asked in complete-missing", () => {
  it("skips companyIndustry when already filled", () => {
    const input = makeInput({
      brief: { ...EMPTY_BRIEF, companyIndustry: "Coffee Shop" },
      mode: "complete-missing",
    });
    const qs = planBriefQuestions(input);
    expect(qs.find((q) => q.id === "companyIndustry")).toBeUndefined();
  });

  it("skips primaryGoal when already has selections", () => {
    const input = makeInput({
      brief: { ...EMPTY_BRIEF, primaryGoal: "Meningkatkan brand awareness" },
      mode: "complete-missing",
    });
    const qs = planBriefQuestions(input);
    expect(qs.find((q) => q.id === "primaryGoal")).toBeUndefined();
  });

  it("includes fields that are still empty", () => {
    const input = makeInput({
      brief: { ...EMPTY_BRIEF, companyIndustry: "Coffee Shop" },
      mode: "complete-missing",
    });
    const qs = planBriefQuestions(input);
    expect(qs.find((q) => q.id === "primaryGoal")).toBeDefined();
    expect(qs.find((q) => q.id === "audienceDemographics")).toBeDefined();
  });
});

describe("planBriefQuestions — start-from-beginning asks all relevant fields", () => {
  it("includes companyIndustry even when it's already filled", () => {
    const input = makeInput({
      brief: { ...EMPTY_BRIEF, companyIndustry: "Coffee Shop" },
      mode: "start-from-beginning",
    });
    const qs = planBriefQuestions(input);
    expect(qs.find((q) => q.id === "companyIndustry")).toBeDefined();
  });
});

describe("planBriefQuestions — skipped questions not re-asked", () => {
  it("excludes a field from the plan once it has been skipped", () => {
    const input = makeInput({ skippedQuestionIds: ["companyIndustry"] });
    const qs = planBriefQuestions(input);
    expect(qs.find((q) => q.id === "companyIndustry")).toBeUndefined();
  });

  it("excludes an answered field from the plan", () => {
    const input = makeInput({ answeredQuestionIds: ["primaryGoal"] });
    const qs = planBriefQuestions(input);
    expect(qs.find((q) => q.id === "primaryGoal")).toBeUndefined();
  });
});

describe("planBriefQuestions — returns empty when all questions done", () => {
  it("returns [] when all relevant questions are answered", () => {
    // All fields in default order
    const allFieldIds = [
      "companyIndustry", "companySize", "primaryGoal", "audienceDemographics",
      "stylePreference", "colorPalette", "existingAssets", "audienceChannels",
      "outputLanguage", "priority", "audiencePainPoints", "outputFormats", "specialRequirements",
    ];
    const input = makeInput({ answeredQuestionIds: allFieldIds });
    const qs = planBriefQuestions(input);
    expect(qs).toHaveLength(0);
  });
});

describe("getNextBriefQuestion", () => {
  it("returns first planned question when nothing answered", () => {
    const q = getNextBriefQuestion(makeInput());
    expect(q).not.toBeNull();
    expect(q?.id).toBeTruthy();
  });

  it("returns null when all questions are answered/skipped", () => {
    const allFieldIds = [
      "companyIndustry", "companySize", "primaryGoal", "audienceDemographics",
      "stylePreference", "colorPalette", "existingAssets", "audienceChannels",
      "outputLanguage", "priority", "audiencePainPoints", "outputFormats", "specialRequirements",
    ];
    const q = getNextBriefQuestion(makeInput({ answeredQuestionIds: allFieldIds }));
    expect(q).toBeNull();
  });
});

describe("planBriefQuestions — service-specific plans", () => {
  it("brand_identity plan starts with companyIndustry and includes stylePreference", () => {
    const input = makeInput({
      serviceType: "brand_identity",
      serviceConfig: getServiceConfig("brand_identity"),
    });
    const qs = planBriefQuestions(input);
    expect(qs[0]?.id).toBe("companyIndustry");
    expect(qs.find((q) => q.id === "stylePreference")).toBeDefined();
  });

  it("logo_design plan starts with companyIndustry and includes colorPalette", () => {
    const input = makeInput({
      serviceType: "logo_design",
      serviceConfig: getServiceConfig("logo_design"),
    });
    const qs = planBriefQuestions(input);
    expect(qs[0]?.id).toBe("companyIndustry");
    expect(qs.find((q) => q.id === "colorPalette")).toBeDefined();
  });

  it("company_profile plan starts with companyIndustry", () => {
    const input = makeInput({
      serviceType: "company_profile",
      serviceConfig: getServiceConfig("company_profile"),
    });
    const qs = planBriefQuestions(input);
    expect(qs[0]?.id).toBe("companyIndustry");
  });

  it("pitch_deck plan starts with primaryGoal", () => {
    const input = makeInput({
      serviceType: "pitch_deck",
      serviceConfig: getServiceConfig("pitch_deck"),
    });
    const qs = planBriefQuestions(input);
    expect(qs[0]?.id).toBe("primaryGoal");
  });

  it("social_media plan starts with audienceChannels", () => {
    const input = makeInput({
      serviceType: "social_media",
      serviceConfig: getServiceConfig("social_media"),
    });
    const qs = planBriefQuestions(input);
    expect(qs[0]?.id).toBe("audienceChannels");
  });

  it("copywriting plan starts with primaryGoal", () => {
    const input = makeInput({
      serviceType: "copywriting",
      serviceConfig: getServiceConfig("copywriting"),
    });
    const qs = planBriefQuestions(input);
    expect(qs[0]?.id).toBe("primaryGoal");
  });

  it("image_generation plan starts with stylePreference", () => {
    const input = makeInput({
      serviceType: "image_generation",
      serviceConfig: getServiceConfig("image_generation"),
    });
    const qs = planBriefQuestions(input);
    expect(qs[0]?.id).toBe("stylePreference");
  });

  it("unknown/default service uses default plan without crash", () => {
    const input = makeInput({ serviceType: "default", serviceConfig: getServiceConfig("default") });
    expect(() => planBriefQuestions(input)).not.toThrow();
    const qs = planBriefQuestions(input);
    expect(qs.length).toBeGreaterThan(0);
  });
});

describe("planBriefQuestions — options from existing registry", () => {
  it("industry question has options from INDUSTRY_OPTIONS", () => {
    const qs = planBriefQuestions(makeInput());
    const industry = qs.find((q) => q.id === "companyIndustry");
    expect(industry?.options).toBeDefined();
    expect((industry?.options?.length ?? 0)).toBeGreaterThan(5);
    // Should have coffee_shop option from the registry
    expect(industry?.options?.find((o) => o.key === "coffee_shop")).toBeDefined();
  });

  it("audience question respects AUDIENCE_MAX selections", () => {
    const qs = planBriefQuestions(makeInput());
    const audience = qs.find((q) => q.id === "audienceDemographics");
    expect(audience?.maxSelections).toBe(4); // AUDIENCE_MAX
  });

  it("style question respects STYLE_MAX selections", () => {
    const qs = planBriefQuestions(makeInput());
    const style = qs.find((q) => q.id === "stylePreference");
    expect(style?.maxSelections).toBe(3); // STYLE_MAX
  });

  it("goal question allows up to 5 selections", () => {
    const qs = planBriefQuestions(makeInput());
    const goal = qs.find((q) => q.id === "primaryGoal");
    expect(goal?.maxSelections).toBe(5);
  });
});
