// Team 10 — Font Pair Service unit tests (DB mocked)

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @workspace/db so we don't need a real DB connection
vi.mock("@workspace/db", () => {
  const mockDb: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    $dynamic: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
  };
  return { db: mockDb };
});

vi.mock("slugify", () => ({ default: (s: string) => s.toLowerCase().replace(/\s+/g, "-") }));

// Mock schema module to avoid pgSchema setup issues in test env
vi.mock("../schema.js", () => ({
  dtFontPairsTable: { id: "id", active: "active", category: "category", mood: "mood", industries: "industries", pairId: "pair_id", role: "role" },
  dtTypographyRolesTable: { id: "id", pairId: "pair_id", role: "role" },
  dtColorPalettesTable: {},
  dtSemanticColorRolesTable: {},
}));

import { validateTypographyHierarchy } from "../colorUtils.js";
import { getIndustryRecommendation } from "../industryRecommendationService.js";

// We test pure utility functions that don't require DB
describe("Typography hierarchy validation (via colorUtils)", () => {
  it("accepts display > h1 > h2 > h3 > body > caption", () => {
    expect(validateTypographyHierarchy([
      { role: "display", fontSize: 72 },
      { role: "heading1", fontSize: 48 },
      { role: "heading2", fontSize: 32 },
      { role: "heading3", fontSize: 24 },
      { role: "body", fontSize: 16 },
      { role: "caption", fontSize: 12 },
    ])).toHaveLength(0);
  });

  it("rejects equal font sizes for adjacent roles", () => {
    const errors = validateTypographyHierarchy([
      { role: "heading1", fontSize: 32 },
      { role: "heading2", fontSize: 32 },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects when body is larger than heading3", () => {
    const errors = validateTypographyHierarchy([
      { role: "heading3", fontSize: 16 },
      { role: "body", fontSize: 20 },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].role).toBe("body");
  });

  it("validates only roles that are present", () => {
    // Just heading1 and body — no intermediate roles — should pass
    const errors = validateTypographyHierarchy([
      { role: "heading1", fontSize: 36 },
      { role: "body", fontSize: 16 },
    ]);
    expect(errors).toHaveLength(0);
  });
});

describe("Industry recommendations (domain knowledge)", () => {
  it("finance recommendation warns against playful typography", () => {
    const rec = getIndustryRecommendation("finance");
    expect(rec.avoidMoods).toContain("playful");
    expect(rec.primaryMood).toBe("professional");
  });

  it("creative recommendation encourages bold typography", () => {
    const rec = getIndustryRecommendation("creative");
    expect(rec.primaryMood).toBe("bold");
  });

  it("each recommendation has typography notes", () => {
    const industries = ["technology", "healthcare", "education", "logistics"];
    for (const industry of industries) {
      const rec = getIndustryRecommendation(industry as any);
      expect(rec.typographyNotes.length).toBeGreaterThan(10);
      expect(rec.colorNotes.length).toBeGreaterThan(10);
    }
  });
});
