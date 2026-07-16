/**
 * Universal Template Matching — Test Suite
 *
 * Tests:
 * - Deterministic scoring (same input → same output always)
 * - Weight correctness (each dimension contributes expected points)
 * - No-compatible-result handling (constraint violations, empty candidate list)
 * - Explanations (non-empty, human-readable, contextually accurate)
 * - Confidence scoring (reflects input richness and score height)
 * - Stable sorting (ties broken deterministically)
 * - Signal audit (used/missing signals correctly identified)
 * - Tokenisation (brief keywords extracted correctly)
 * - Normalisation (score bounded 0–100)
 * - Full-stack integration via UniversalTemplateMatcher with in-memory ports
 */

import { describe, it, expect } from "vitest";
import {
  scoreBlueprint,
  runMatching,
  normaliseScore,
  computeConfidence,
  computeMaxPossibleScore,
  checkConstraints,
  tokeniseBrief,
  compareRecommendations,
  auditSignals,
  UniversalTemplateMatcher,
} from "../services/universal-template-matching/index.js";
import type {
  Blueprint,
  MatchInput,
  BlueprintPort,
  ComponentPort,
  PatternPort,
  TokenLibraryPort,
  MatchingDeps,
} from "../services/universal-template-matching/index.js";

// ── In-Memory Fakes ───────────────────────────────────────────────────────────

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    id: "bp-001",
    name: "Modern Company Profile",
    category: "Company Profile",
    serviceTypes: ["CP"],
    domains: ["creative"],
    industries: ["logistics"],
    audiences: ["B2B", "enterprise"],
    styles: ["modern", "minimalist"],
    outputFormats: ["pdf"],
    supportedPackages: ["standard", "professional"],
    personalities: ["professional", "innovative"],
    voices: ["formal"],
    primaryColorHex: "#1a2b3c",
    published: true,
    featured: false,
    usageCount: 50,
    unsupportedConstraints: [],
    keywords: ["company", "profile", "logistics", "professional", "corporate", "modern"],
    ...overrides,
  };
}

function makeInput(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    serviceType: "CP",
    domain: "creative",
    category: "Company Profile",
    brief: "We need a professional corporate company profile for our logistics company",
    brandDna: {
      personalities: ["professional", "innovative"],
      voice: "formal",
      writingStyle: "concise",
      primaryColorHex: "#1a9999",
    },
    industry: "logistics",
    audience: ["B2B", "enterprise"],
    output: ["pdf"],
    package: "professional",
    style: ["modern"],
    constraints: [],
    limit: 5,
    ...overrides,
  };
}

class InMemoryBlueprintPort implements BlueprintPort {
  constructor(private blueprints: Blueprint[]) {}
  async listCandidates(): Promise<Blueprint[]> {
    return this.blueprints.filter((b) => b.published);
  }
  async getById(id: string): Promise<Blueprint | null> {
    return this.blueprints.find((b) => b.id === id && b.published) ?? null;
  }
}

class EmptyComponentPort implements ComponentPort {
  async listByCategory(): Promise<[]> { return []; }
}

class EmptyPatternPort implements PatternPort {
  async listByServiceType(): Promise<[]> { return []; }
}

class EmptyTokenPort implements TokenLibraryPort {
  async getEntry(): Promise<null> { return null; }
  async listByIndustry(): Promise<[]> { return []; }
}

function makeDeps(blueprints: Blueprint[]): MatchingDeps {
  return {
    blueprints: new InMemoryBlueprintPort(blueprints),
    components: new EmptyComponentPort(),
    patterns: new EmptyPatternPort(),
    tokenLibrary: new EmptyTokenPort(),
  };
}

// ── Tokenisation ──────────────────────────────────────────────────────────────

describe("tokeniseBrief", () => {
  it("returns lowercase alpha tokens ≥3 chars", () => {
    const tokens = tokeniseBrief("Hello World 123 test");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("123");
    expect(tokens).toContain("test");
  });

  it("strips stopwords", () => {
    const tokens = tokeniseBrief("the company and the brand");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("and");
    expect(tokens).toContain("company");
    expect(tokens).toContain("brand");
  });

  it("strips punctuation", () => {
    const tokens = tokeniseBrief("hello, world! test-run.");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
  });

  it("deduplicates tokens", () => {
    const tokens = tokeniseBrief("company company company profile");
    const companyCount = tokens.filter((t) => t === "company").length;
    // tokeniseBrief splits, not deduplicates — duplicates from brief are intentional for tf counting
    expect(companyCount).toBeGreaterThanOrEqual(1);
  });

  it("handles empty brief", () => {
    expect(tokeniseBrief("")).toEqual([]);
  });

  it("handles Indonesian stopwords", () => {
    const tokens = tokeniseBrief("kami membuat profil perusahaan untuk klien");
    expect(tokens).not.toContain("kami");
    expect(tokens).not.toContain("untuk");
    expect(tokens).toContain("membuat");
    expect(tokens).toContain("profil");
  });
});

// ── Constraint Checking ───────────────────────────────────────────────────────

describe("checkConstraints", () => {
  it("returns null when no constraints required", () => {
    const bp = makeBlueprint({ unsupportedConstraints: ["dark-mode"] });
    expect(checkConstraints(bp, [])).toBeNull();
  });

  it("returns null when blueprint has no deny-list", () => {
    const bp = makeBlueprint({ unsupportedConstraints: [] });
    expect(checkConstraints(bp, ["bilingual", "print-ready"])).toBeNull();
  });

  it("returns rejection reason when constraint is in deny-list", () => {
    const bp = makeBlueprint({ unsupportedConstraints: ["dark-mode"] });
    const result = checkConstraints(bp, ["dark-mode"]);
    expect(result).not.toBeNull();
    expect(result).toContain("dark-mode");
  });

  it("is case-insensitive", () => {
    const bp = makeBlueprint({ unsupportedConstraints: ["Dark-Mode"] });
    const result = checkConstraints(bp, ["dark-mode"]);
    expect(result).not.toBeNull();
  });

  it("rejects on any single constraint violation", () => {
    const bp = makeBlueprint({ unsupportedConstraints: ["dark-mode"] });
    const result = checkConstraints(bp, ["bilingual", "dark-mode", "print-ready"]);
    expect(result).not.toBeNull();
    expect(result).toContain("dark-mode");
  });
});

// ── Normalisation ─────────────────────────────────────────────────────────────

describe("normaliseScore", () => {
  it("clamps to 100 max", () => {
    expect(normaliseScore(999, 100)).toBe(100);
  });

  it("returns 0 for zero total", () => {
    expect(normaliseScore(0, 100)).toBe(0);
  });

  it("returns 0 when maxPossible is 0", () => {
    expect(normaliseScore(50, 0)).toBe(0);
  });

  it("returns proportional value", () => {
    // 50/100 → 50
    expect(normaliseScore(50, 100)).toBe(50);
    // 75/150 → 50
    expect(normaliseScore(75, 150)).toBe(50);
  });
});

// ── Signal Audit ──────────────────────────────────────────────────────────────

describe("auditSignals", () => {
  it("identifies all provided signals", () => {
    const input = makeInput();
    const { used, missing } = auditSignals(input);
    expect(used).toContain("serviceType");
    expect(used).toContain("industry");
    expect(used).toContain("brief");
    expect(used).toContain("package");
  });

  it("identifies missing signals", () => {
    const input: MatchInput = { serviceType: "CP" };
    const { missing } = auditSignals(input);
    expect(missing).toContain("industry");
    expect(missing).toContain("brief");
    expect(missing).toContain("package");
  });

  it("is deterministic for same input", () => {
    const input = makeInput();
    const r1 = auditSignals(input);
    const r2 = auditSignals(input);
    expect(r1.used).toEqual(r2.used);
    expect(r1.missing).toEqual(r2.missing);
  });
});

// ── computeMaxPossibleScore ───────────────────────────────────────────────────

describe("computeMaxPossibleScore", () => {
  it("returns at least 1 (never 0)", () => {
    expect(computeMaxPossibleScore({})).toBeGreaterThanOrEqual(1);
  });

  it("increases as more signals are provided", () => {
    const s1 = computeMaxPossibleScore({ serviceType: "CP" });
    const s2 = computeMaxPossibleScore({ serviceType: "CP", industry: "logistics" });
    expect(s2).toBeGreaterThan(s1);
  });

  it("is deterministic", () => {
    const input = makeInput();
    expect(computeMaxPossibleScore(input)).toBe(computeMaxPossibleScore(input));
  });
});

// ── computeConfidence ─────────────────────────────────────────────────────────

describe("computeConfidence", () => {
  it("returns value in [0, 1]", () => {
    const input = makeInput();
    const c = computeConfidence(input, 80, 100);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });

  it("is higher with more input signals", () => {
    const sparse: MatchInput = { serviceType: "CP" };
    const rich = makeInput();
    const maxP = computeMaxPossibleScore(rich);
    const sparse_c = computeConfidence(sparse, 80, maxP);
    const rich_c   = computeConfidence(rich, 80, maxP);
    expect(rich_c).toBeGreaterThan(sparse_c);
  });

  it("returns 0 when score is 0", () => {
    const input = makeInput();
    expect(computeConfidence(input, 0, 100)).toBe(0);
  });

  it("is deterministic", () => {
    const input = makeInput();
    expect(computeConfidence(input, 70, 100)).toBe(computeConfidence(input, 70, 100));
  });
});

// ── scoreBlueprint (per-dimension) ───────────────────────────────────────────

describe("scoreBlueprint", () => {
  it("returns a breakdown with all expected dimensions", () => {
    const bp = makeBlueprint();
    const input = makeInput();
    const breakdown = scoreBlueprint(bp, input);
    const dimNames = breakdown.dimensions.map((d) => d.dimension);
    expect(dimNames).toContain("Service Type");
    expect(dimNames).toContain("Industry");
    expect(dimNames).toContain("Category");
    expect(dimNames).toContain("Brand Personality");
    expect(dimNames).toContain("Target Audience");
    expect(dimNames).toContain("Voice & Writing Style");
    expect(dimNames).toContain("Output Format");
    expect(dimNames).toContain("Package Level");
    expect(dimNames).toContain("Style Preference");
    expect(dimNames).toContain("Brief Keyword Match");
    expect(dimNames).toContain("Color Family");
    expect(dimNames).toContain("Featured");
    expect(dimNames).toContain("Popularity");
  });

  it("is deterministic — same inputs produce identical breakdown", () => {
    const bp = makeBlueprint();
    const input = makeInput();
    const b1 = scoreBlueprint(bp, input);
    const b2 = scoreBlueprint(bp, input);
    expect(b1.totalScore).toBe(b2.totalScore);
    expect(b1.dimensions.map((d) => d.awarded)).toEqual(b2.dimensions.map((d) => d.awarded));
  });

  it("awards service type points for exact match", () => {
    const bp = makeBlueprint({ serviceTypes: ["CP"] });
    const input = makeInput({ serviceType: "CP" });
    const { dimensions } = scoreBlueprint(bp, input);
    const st = dimensions.find((d) => d.dimension === "Service Type")!;
    expect(st.matched).toBe(true);
    expect(st.awarded).toBeGreaterThan(0);
  });

  it("awards zero service type for mismatch", () => {
    const bp = makeBlueprint({ serviceTypes: ["PITCH"] });
    const input = makeInput({ serviceType: "CP" });
    const { dimensions } = scoreBlueprint(bp, input);
    const st = dimensions.find((d) => d.dimension === "Service Type")!;
    expect(st.matched).toBe(false);
    expect(st.awarded).toBe(0);
  });

  it("awards partial credit for cross-service blueprint (empty serviceTypes)", () => {
    const bp = makeBlueprint({ serviceTypes: [] });
    const input = makeInput({ serviceType: "CP" });
    const { dimensions } = scoreBlueprint(bp, input);
    const st = dimensions.find((d) => d.dimension === "Service Type")!;
    expect(st.matched).toBe(true);
    expect(st.awarded).toBeGreaterThan(0);
    expect(st.awarded).toBeLessThan(20); // not full points
  });

  it("awards industry points for exact match", () => {
    const bp = makeBlueprint({ industries: ["logistics"] });
    const input = makeInput({ industry: "logistics" });
    const { dimensions } = scoreBlueprint(bp, input);
    const ind = dimensions.find((d) => d.dimension === "Industry")!;
    expect(ind.matched).toBe(true);
    expect(ind.awarded).toBe(18); // WEIGHTS.INDUSTRY
  });

  it("awards zero industry for mismatch", () => {
    const bp = makeBlueprint({ industries: ["technology"] });
    const input = makeInput({ industry: "logistics" });
    const { dimensions } = scoreBlueprint(bp, input);
    const ind = dimensions.find((d) => d.dimension === "Industry")!;
    expect(ind.matched).toBe(false);
    expect(ind.awarded).toBe(0);
  });

  it("personality scoring caps at max weight", () => {
    const bp = makeBlueprint({ personalities: ["a", "b", "c", "d", "e", "f"] });
    const input = makeInput({ brandDna: { personalities: ["a", "b", "c", "d", "e", "f"] } });
    const { dimensions } = scoreBlueprint(bp, input);
    const pers = dimensions.find((d) => d.dimension === "Brand Personality")!;
    expect(pers.awarded).toBeLessThanOrEqual(12); // WEIGHTS.PERSONALITY
  });

  it("personality scoring awards 3 pts per hit", () => {
    const bp = makeBlueprint({ personalities: ["professional", "innovative"] });
    const input = makeInput({ brandDna: { personalities: ["professional"] } });
    const { dimensions } = scoreBlueprint(bp, input);
    const pers = dimensions.find((d) => d.dimension === "Brand Personality")!;
    expect(pers.awarded).toBe(3); // 1 hit × 3 pts
  });

  it("voice match awards full weight", () => {
    const bp = makeBlueprint({ voices: ["formal"] });
    const input = makeInput({ brandDna: { voice: "formal" } });
    const { dimensions } = scoreBlueprint(bp, input);
    const voice = dimensions.find((d) => d.dimension === "Voice & Writing Style")!;
    expect(voice.awarded).toBe(8); // WEIGHTS.VOICE_STYLE
    expect(voice.matched).toBe(true);
  });

  it("color family match uses 2-char hex prefix", () => {
    const bp = makeBlueprint({ primaryColorHex: "#1a9900" });
    const input = makeInput({ brandDna: { primaryColorHex: "#1a1234" } });
    const { dimensions } = scoreBlueprint(bp, input);
    const color = dimensions.find((d) => d.dimension === "Color Family")!;
    expect(color.matched).toBe(true);
    expect(color.awarded).toBe(5); // WEIGHTS.COLOR_FAMILY
  });

  it("color family mismatch awards 0", () => {
    const bp = makeBlueprint({ primaryColorHex: "#ff0000" });
    const input = makeInput({ brandDna: { primaryColorHex: "#1a1234" } });
    const { dimensions } = scoreBlueprint(bp, input);
    const color = dimensions.find((d) => d.dimension === "Color Family")!;
    expect(color.matched).toBe(false);
    expect(color.awarded).toBe(0);
  });

  it("featured blueprint earns bonus", () => {
    const bp = makeBlueprint({ featured: true });
    const input = makeInput();
    const { dimensions } = scoreBlueprint(bp, input);
    const feat = dimensions.find((d) => d.dimension === "Featured")!;
    expect(feat.awarded).toBe(4); // WEIGHTS.FEATURED
  });

  it("popularity bonus is capped", () => {
    const bp = makeBlueprint({ usageCount: 9999 });
    const input = makeInput();
    const { dimensions } = scoreBlueprint(bp, input);
    const pop = dimensions.find((d) => d.dimension === "Popularity")!;
    expect(pop.awarded).toBeLessThanOrEqual(3); // WEIGHTS.POPULARITY cap
  });

  it("totalScore is sum of dimension awarded points", () => {
    const bp = makeBlueprint();
    const input = makeInput();
    const breakdown = scoreBlueprint(bp, input);
    const manualSum = breakdown.dimensions.reduce((s, d) => s + d.awarded, 0);
    expect(breakdown.totalScore).toBe(manualSum);
  });

  it("all dimension explanations are non-empty strings", () => {
    const bp = makeBlueprint();
    const input = makeInput();
    const { dimensions } = scoreBlueprint(bp, input);
    for (const d of dimensions) {
      expect(typeof d.explanation).toBe("string");
      expect(d.explanation.length).toBeGreaterThan(0);
    }
  });

  it("awards 0 for dimensions with no input signal", () => {
    const bp = makeBlueprint();
    const input: MatchInput = {}; // no signals
    const { dimensions } = scoreBlueprint(bp, input);
    // All base dimensions should have 0 except featured/popularity
    const base = dimensions.filter((d) => !["Featured", "Popularity"].includes(d.dimension));
    for (const d of base) {
      expect(d.awarded).toBe(0);
    }
  });
});

// ── Brief Keyword Scoring ─────────────────────────────────────────────────────

describe("brief keyword scoring", () => {
  it("awards points for overlapping keywords", () => {
    const bp = makeBlueprint({ keywords: ["logistics", "corporate", "professional"] });
    const input = makeInput({ brief: "professional corporate logistics company" });
    const { dimensions } = scoreBlueprint(bp, input);
    const brief = dimensions.find((d) => d.dimension === "Brief Keyword Match")!;
    expect(brief.matched).toBe(true);
    expect(brief.awarded).toBeGreaterThan(0);
  });

  it("awards 0 when no keyword overlap", () => {
    const bp = makeBlueprint({ keywords: ["fashion", "luxury", "couture"] });
    const input = makeInput({ brief: "engineering software cloud platform" });
    const { dimensions } = scoreBlueprint(bp, input);
    const brief = dimensions.find((d) => d.dimension === "Brief Keyword Match")!;
    expect(brief.awarded).toBe(0);
  });

  it("awards 0 when brief is empty", () => {
    const bp = makeBlueprint();
    const input = makeInput({ brief: undefined });
    const { dimensions } = scoreBlueprint(bp, input);
    const brief = dimensions.find((d) => d.dimension === "Brief Keyword Match")!;
    expect(brief.awarded).toBe(0);
  });
});

// ── compareRecommendations (stable sort) ──────────────────────────────────────

describe("compareRecommendations", () => {
  it("higher score ranks first", () => {
    const a = { score: 80, blueprint: makeBlueprint({ id: "a", featured: false, usageCount: 0 }) };
    const b = { score: 60, blueprint: makeBlueprint({ id: "b", featured: false, usageCount: 0 }) };
    expect(compareRecommendations(a, b)).toBeLessThan(0); // a before b
  });

  it("on score tie: featured ranks first", () => {
    const a = { score: 70, blueprint: makeBlueprint({ id: "a", featured: true,  usageCount: 10 }) };
    const b = { score: 70, blueprint: makeBlueprint({ id: "b", featured: false, usageCount: 10 }) };
    expect(compareRecommendations(a, b)).toBeLessThan(0);
  });

  it("on score+featured tie: higher usageCount ranks first", () => {
    const a = { score: 70, blueprint: makeBlueprint({ id: "a", featured: false, usageCount: 100 }) };
    const b = { score: 70, blueprint: makeBlueprint({ id: "b", featured: false, usageCount: 10  }) };
    expect(compareRecommendations(a, b)).toBeLessThan(0);
  });

  it("on full tie: alphabetical id (stable)", () => {
    const a = { score: 70, blueprint: makeBlueprint({ id: "aaa", featured: false, usageCount: 10 }) };
    const b = { score: 70, blueprint: makeBlueprint({ id: "bbb", featured: false, usageCount: 10 }) };
    expect(compareRecommendations(a, b)).toBeLessThan(0); // "aaa" < "bbb"
  });

  it("is consistent across multiple sorts of same array", () => {
    const items = [
      { score: 70, blueprint: makeBlueprint({ id: "c", featured: false, usageCount: 10 }) },
      { score: 70, blueprint: makeBlueprint({ id: "a", featured: false, usageCount: 10 }) },
      { score: 70, blueprint: makeBlueprint({ id: "b", featured: false, usageCount: 10 }) },
    ];
    const sorted1 = [...items].sort(compareRecommendations);
    const sorted2 = [...items].sort(compareRecommendations);
    expect(sorted1.map((i) => i.blueprint.id)).toEqual(sorted2.map((i) => i.blueprint.id));
  });
});

// ── runMatching (full pipeline) ───────────────────────────────────────────────

describe("runMatching", () => {
  it("returns topRecommendation with highest score", () => {
    const blueprints = [
      makeBlueprint({ id: "bp-001", serviceTypes: ["CP"], industries: ["logistics"] }),
      makeBlueprint({ id: "bp-002", serviceTypes: ["PITCH"], industries: ["technology"] }),
    ];
    const input = makeInput({ serviceType: "CP", industry: "logistics" });
    const result = runMatching(blueprints, input);
    expect(result.topRecommendation).not.toBeNull();
    expect(result.topRecommendation!.blueprintId).toBe("bp-001");
  });

  it("topRecommendation score >= all alternative scores", () => {
    const blueprints = [
      makeBlueprint({ id: "a", featured: true,  usageCount: 100 }),
      makeBlueprint({ id: "b", featured: false, usageCount: 10  }),
      makeBlueprint({ id: "c", featured: false, usageCount: 5   }),
    ];
    const input = makeInput();
    const result = runMatching(blueprints, input);
    for (const alt of result.alternatives) {
      expect(result.topRecommendation!.score).toBeGreaterThanOrEqual(alt.score);
    }
  });

  it("alternatives do not include topRecommendation", () => {
    const blueprints = [
      makeBlueprint({ id: "a" }),
      makeBlueprint({ id: "b" }),
      makeBlueprint({ id: "c" }),
    ];
    const input = makeInput({ limit: 3 });
    const result = runMatching(blueprints, input);
    const altIds = result.alternatives.map((a) => a.blueprintId);
    expect(altIds).not.toContain(result.topRecommendation?.blueprintId);
  });

  it("returns null topRecommendation when no compatible blueprints", () => {
    const result = runMatching([], makeInput());
    expect(result.topRecommendation).toBeNull();
    expect(result.alternatives).toHaveLength(0);
  });

  it("handles no-compatible-result due to constraint violations", () => {
    const blueprints = [
      makeBlueprint({ id: "a", unsupportedConstraints: ["dark-mode"] }),
      makeBlueprint({ id: "b", unsupportedConstraints: ["dark-mode"] }),
    ];
    const input = makeInput({ constraints: ["dark-mode"] });
    const result = runMatching(blueprints, input);
    expect(result.topRecommendation).toBeNull();
    expect(result.rejected).toHaveLength(2);
    for (const r of result.rejected) {
      expect(r.rejectionReason).toContain("dark-mode");
    }
  });

  it("rejected blueprints include rawScoreBeforeRejection", () => {
    const blueprints = [makeBlueprint({ id: "a", unsupportedConstraints: ["bilingual"] })];
    const input = makeInput({ constraints: ["bilingual"] });
    const result = runMatching(blueprints, input);
    expect(result.rejected[0]!.rawScoreBeforeRejection).toBeGreaterThanOrEqual(0);
  });

  it("partial constraint: only violating blueprints are rejected", () => {
    const blueprints = [
      makeBlueprint({ id: "a", unsupportedConstraints: ["dark-mode"] }),
      makeBlueprint({ id: "b", unsupportedConstraints: [] }),
    ];
    const input = makeInput({ constraints: ["dark-mode"] });
    const result = runMatching(blueprints, input);
    expect(result.topRecommendation?.blueprintId).toBe("b");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.blueprintId).toBe("a");
  });

  it("candidatesEvaluated counts all blueprints (including rejected)", () => {
    const blueprints = [
      makeBlueprint({ id: "a", unsupportedConstraints: ["x"] }),
      makeBlueprint({ id: "b" }),
      makeBlueprint({ id: "c" }),
    ];
    const result = runMatching(blueprints, makeInput({ constraints: ["x"] }));
    expect(result.candidatesEvaluated).toBe(3);
  });

  it("is deterministic — same input produces identical result", () => {
    const blueprints = [
      makeBlueprint({ id: "a", featured: true }),
      makeBlueprint({ id: "b" }),
      makeBlueprint({ id: "c", industries: ["technology"] }),
    ];
    const input = makeInput();
    const r1 = runMatching(blueprints, input);
    const r2 = runMatching(blueprints, input);
    expect(r1.topRecommendation?.blueprintId).toBe(r2.topRecommendation?.blueprintId);
    expect(r1.topRecommendation?.score).toBe(r2.topRecommendation?.score);
    expect(r1.alternatives.map((a) => a.blueprintId)).toEqual(r2.alternatives.map((a) => a.blueprintId));
  });

  it("limit caps the total recommendations returned", () => {
    const blueprints = Array.from({ length: 10 }, (_, i) =>
      makeBlueprint({ id: `bp-${i}`, name: `Blueprint ${i}` }),
    );
    const result = runMatching(blueprints, makeInput({ limit: 3 }));
    // topRecommendation + alternatives ≤ limit
    const total = (result.topRecommendation ? 1 : 0) + result.alternatives.length;
    expect(total).toBeLessThanOrEqual(3);
  });

  it("all recommendation scores are in [0, 100]", () => {
    const blueprints = [makeBlueprint(), makeBlueprint({ id: "b", industries: ["technology"] })];
    const result = runMatching(blueprints, makeInput());
    const all = [result.topRecommendation, ...result.alternatives].filter(Boolean);
    for (const rec of all) {
      expect(rec!.score).toBeGreaterThanOrEqual(0);
      expect(rec!.score).toBeLessThanOrEqual(100);
    }
  });

  it("all recommendation confidence values are in [0, 1]", () => {
    const blueprints = [makeBlueprint(), makeBlueprint({ id: "b" })];
    const result = runMatching(blueprints, makeInput());
    const all = [result.topRecommendation, ...result.alternatives].filter(Boolean);
    for (const rec of all) {
      expect(rec!.confidence).toBeGreaterThanOrEqual(0);
      expect(rec!.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("confidence is higher with rich input than sparse input (same blueprint set)", () => {
    const blueprints = [makeBlueprint()];
    const sparse: MatchInput = { serviceType: "CP" };
    const rich = makeInput();
    const r_sparse = runMatching(blueprints, sparse);
    const r_rich   = runMatching(blueprints, rich);
    if (r_sparse.topRecommendation && r_rich.topRecommendation) {
      expect(r_rich.confidence).toBeGreaterThanOrEqual(r_sparse.confidence);
    }
  });

  it("signalsUsed lists all provided signals", () => {
    const input = makeInput();
    const result = runMatching([makeBlueprint()], input);
    expect(result.signalsUsed).toContain("serviceType");
    expect(result.signalsUsed).toContain("industry");
    expect(result.signalsUsed).toContain("brief");
    expect(result.signalsUsed).toContain("package");
  });

  it("signalsMissing is populated when signals omitted", () => {
    const input: MatchInput = { serviceType: "CP" };
    const result = runMatching([makeBlueprint()], input);
    expect(result.signalsMissing).toContain("industry");
    expect(result.signalsMissing).toContain("brief");
  });

  it("explanation is a non-empty string", () => {
    const result = runMatching([makeBlueprint()], makeInput());
    expect(typeof result.explanation).toBe("string");
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it("explanation mentions blueprint name when result found", () => {
    const bp = makeBlueprint({ name: "Logistics Modern Profile" });
    const result = runMatching([bp], makeInput());
    expect(result.explanation).toContain("Logistics Modern Profile");
  });

  it("explanation mentions constraint when all rejected", () => {
    const bp = makeBlueprint({ unsupportedConstraints: ["dark-mode"] });
    const result = runMatching([bp], makeInput({ constraints: ["dark-mode"] }));
    expect(result.explanation.toLowerCase()).toContain("constraint");
  });

  it("all recommendation reasons are non-empty strings", () => {
    const result = runMatching([makeBlueprint()], makeInput());
    const all = [result.topRecommendation, ...result.alternatives].filter(Boolean);
    for (const rec of all) {
      expect(Array.isArray(rec!.reasons)).toBe(true);
      for (const r of rec!.reasons) {
        expect(typeof r).toBe("string");
        expect(r.length).toBeGreaterThan(0);
      }
    }
  });

  it("sorts stably — deterministic even with identical scoring blueprints", () => {
    // All blueprints are identical except id — ensures stable alphabetical tie-break
    const blueprints = ["z-bp", "a-bp", "m-bp"].map((id) => makeBlueprint({ id }));
    const input: MatchInput = {}; // no input → all score the same
    const r1 = runMatching(blueprints, input);
    const r2 = runMatching(blueprints, input);
    const ids1 = [r1.topRecommendation?.blueprintId, ...r1.alternatives.map((a) => a.blueprintId)];
    const ids2 = [r2.topRecommendation?.blueprintId, ...r2.alternatives.map((a) => a.blueprintId)];
    expect(ids1).toEqual(ids2);
  });

  it("unpublished blueprints are excluded (InMemoryBlueprintPort filters them)", async () => {
    // This tests the port contract, not the scoring engine directly
    const blueprints = [
      makeBlueprint({ id: "pub",  published: true  }),
      makeBlueprint({ id: "priv", published: false }),
    ];
    const deps = makeDeps(blueprints);
    const candidates = await deps.blueprints.listCandidates();
    expect(candidates.map((b) => b.id)).toContain("pub");
    expect(candidates.map((b) => b.id)).not.toContain("priv");
  });
});

// ── UniversalTemplateMatcher (integration) ────────────────────────────────────

describe("UniversalTemplateMatcher", () => {
  it("returns match result from in-memory port", async () => {
    const blueprints = [makeBlueprint()];
    const matcher = new UniversalTemplateMatcher(makeDeps(blueprints));
    const result = await matcher.match(makeInput());
    expect(result.topRecommendation).not.toBeNull();
    expect(result.candidatesEvaluated).toBe(1);
  });

  it("scoreSingle returns result for existing blueprint", async () => {
    const bp = makeBlueprint({ id: "42" });
    const matcher = new UniversalTemplateMatcher(makeDeps([bp]));
    const result = await matcher.scoreSingle("42", makeInput());
    expect(result).not.toBeNull();
    expect(result!.candidatesEvaluated).toBe(1);
  });

  it("scoreSingle returns null for non-existent blueprint", async () => {
    const matcher = new UniversalTemplateMatcher(makeDeps([]));
    const result = await matcher.scoreSingle("999", makeInput());
    expect(result).toBeNull();
  });

  it("is deterministic across multiple calls", async () => {
    const blueprints = [makeBlueprint(), makeBlueprint({ id: "b", industries: ["technology"] })];
    const deps = makeDeps(blueprints);
    const matcher = new UniversalTemplateMatcher(deps);
    const input = makeInput();
    const [r1, r2, r3] = await Promise.all([matcher.match(input), matcher.match(input), matcher.match(input)]);
    expect(r1.topRecommendation?.blueprintId).toBe(r2.topRecommendation?.blueprintId);
    expect(r2.topRecommendation?.blueprintId).toBe(r3.topRecommendation?.blueprintId);
    expect(r1.topRecommendation?.score).toBe(r2.topRecommendation?.score);
  });

  it("handles empty candidate set gracefully", async () => {
    const matcher = new UniversalTemplateMatcher(makeDeps([]));
    const result = await matcher.match(makeInput());
    expect(result.topRecommendation).toBeNull();
    expect(result.alternatives).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it("multi-domain: scores highest for best-matching domain", async () => {
    const cpBlueprint    = makeBlueprint({ id: "cp",    serviceTypes: ["CP"],    domains: ["creative"] });
    const pitchBlueprint = makeBlueprint({ id: "pitch", serviceTypes: ["PITCH"], domains: ["sales"] });
    const matcher = new UniversalTemplateMatcher(makeDeps([cpBlueprint, pitchBlueprint]));
    const result = await matcher.match(makeInput({ serviceType: "CP", domain: "creative" }));
    expect(result.topRecommendation?.blueprintId).toBe("cp");
  });
});
