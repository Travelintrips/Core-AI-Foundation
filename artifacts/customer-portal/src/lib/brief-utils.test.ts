import { describe, it, expect } from "vitest";
import {
  serializeChoices,
  parseChoices,
  serializeSingleChoice,
  parseSingleChoice,
  serializeColors,
  parseColors,
  normalizeLegacyPriority,
  hasAnySelection,
} from "./brief-utils";

const GOAL_OPTIONS = [
  { value: "brand_awareness", label: "Meningkatkan brand awareness" },
  { value: "sales", label: "Meningkatkan penjualan" },
  { value: "leads", label: "Mendapatkan lebih banyak leads" },
  { value: "other", label: "Lainnya" },
];

const COLOR_PRESETS = [
  { value: "blue", label: "Biru" },
  { value: "red", label: "Merah" },
  { value: "green", label: "Hijau" },
  { value: "none", label: "Tidak ada preferensi" },
  { value: "other", label: "Warna lainnya" },
];

describe("serializeChoices", () => {
  it("serializes multiple selections to a human-readable string", () => {
    const result = serializeChoices(
      ["brand_awareness", "sales"],
      GOAL_OPTIONS,
    );
    expect(result).toBe("Meningkatkan brand awareness; Meningkatkan penjualan");
  });

  it("includes 'Lainnya: custom' when other is selected with custom text", () => {
    const result = serializeChoices(
      ["brand_awareness", "other"],
      GOAL_OPTIONS,
      "Mencari pasar Asia",
    );
    expect(result).toBe(
      "Meningkatkan brand awareness; Lainnya: Mencari pasar Asia",
    );
  });

  it("outputs just 'Lainnya' when other selected but no custom text", () => {
    const result = serializeChoices(["other"], GOAL_OPTIONS);
    expect(result).toBe("Lainnya");
  });

  it("returns empty string for empty selection", () => {
    expect(serializeChoices([], GOAL_OPTIONS)).toBe("");
  });
});

describe("parseChoices", () => {
  it("parses serialized string back to selection array", () => {
    const result = parseChoices(
      "Meningkatkan brand awareness; Meningkatkan penjualan",
      GOAL_OPTIONS,
    );
    expect(result.selected).toEqual(["brand_awareness", "sales"]);
    expect(result.custom).toBe("");
  });

  it("recovers 'other' and custom text from Lainnya: prefix", () => {
    const result = parseChoices(
      "Meningkatkan brand awareness; Lainnya: Mencari pasar Asia",
      GOAL_OPTIONS,
    );
    expect(result.selected).toContain("other");
    expect(result.custom).toBe("Mencari pasar Asia");
  });

  it("returns empty for blank string", () => {
    const result = parseChoices("", GOAL_OPTIONS);
    expect(result.selected).toEqual([]);
    expect(result.custom).toBe("");
  });

  it("round-trips: serialize → parse returns same selection", () => {
    const original = ["brand_awareness", "other"];
    const customText = "Sertifikasi pasar global";
    const serialized = serializeChoices(original, GOAL_OPTIONS, customText);
    const parsed = parseChoices(serialized, GOAL_OPTIONS);
    expect(parsed.selected).toEqual(original);
    expect(parsed.custom).toBe(customText);
  });
});

describe("parseSingleChoice", () => {
  const INDUSTRY = [
    { value: "ecommerce", label: "E-commerce" },
    { value: "tech", label: "Technology" },
    { value: "other", label: "Lainnya" },
  ];

  it("matches by label for newly serialized values", () => {
    const result = parseSingleChoice("E-commerce", INDUSTRY);
    expect(result.selected).toBe("ecommerce");
    expect(result.custom).toBe("");
  });

  it("matches by value for legacy internally-keyed values", () => {
    const result = parseSingleChoice("ecommerce", INDUSTRY);
    expect(result.selected).toBe("ecommerce");
  });

  it("treats unrecognized string as custom text", () => {
    const result = parseSingleChoice("Industri Unik Saya", INDUSTRY);
    expect(result.selected).toBe("other");
    expect(result.custom).toBe("Industri Unik Saya");
  });

  it("handles Lainnya: prefix", () => {
    const result = parseSingleChoice("Lainnya: Blockchain", INDUSTRY);
    expect(result.selected).toBe("other");
    expect(result.custom).toBe("Blockchain");
  });

  it("returns empty for blank input", () => {
    const result = parseSingleChoice("", INDUSTRY);
    expect(result.selected).toBe("");
    expect(result.custom).toBe("");
  });
});

describe("serializeSingleChoice", () => {
  const INDUSTRY = [
    { value: "ecommerce", label: "E-commerce" },
    { value: "other", label: "Lainnya" },
  ];

  it("returns label for known value", () => {
    expect(serializeSingleChoice("ecommerce", INDUSTRY)).toBe("E-commerce");
  });

  it("returns custom text for 'other'", () => {
    expect(serializeSingleChoice("other", INDUSTRY, "Fintech Syariah")).toBe(
      "Fintech Syariah",
    );
  });

  it("returns empty string for 'other' with blank custom text", () => {
    expect(serializeSingleChoice("other", INDUSTRY, "")).toBe("");
  });
});

describe("serializeColors / parseColors", () => {
  it("serializes color selections to readable string", () => {
    const result = serializeColors(["blue", "red"], COLOR_PRESETS);
    expect(result).toBe("Biru, Merah");
  });

  it("'none' selection becomes 'Tidak ada preferensi'", () => {
    expect(serializeColors(["none"], COLOR_PRESETS)).toBe(
      "Tidak ada preferensi",
    );
  });

  it("includes custom color text", () => {
    const result = serializeColors(["blue", "other"], COLOR_PRESETS, "Teal");
    expect(result).toBe("Biru, Teal");
  });

  it("parses 'Tidak ada preferensi' back to ['none']", () => {
    const result = parseColors("Tidak ada preferensi", COLOR_PRESETS);
    expect(result.selected).toEqual(["none"]);
  });

  it("parses comma-separated labels back to values", () => {
    const result = parseColors("Biru, Merah", COLOR_PRESETS);
    expect(result.selected).toEqual(["blue", "red"]);
  });

  it("round-trips: serialize → parse", () => {
    const original = ["blue", "green"];
    const serialized = serializeColors(original, COLOR_PRESETS);
    const parsed = parseColors(serialized, COLOR_PRESETS);
    expect(parsed.selected).toEqual(original);
  });
});

describe("normalizeLegacyPriority", () => {
  it("maps 'normal' to 'balanced'", () => {
    expect(normalizeLegacyPriority("normal")).toBe("balanced");
  });

  it("maps 'urgent' to 'speed'", () => {
    expect(normalizeLegacyPriority("urgent")).toBe("speed");
  });

  it("passes 'high' through unchanged", () => {
    expect(normalizeLegacyPriority("high")).toBe("high");
  });

  it("passes new values through unchanged", () => {
    expect(normalizeLegacyPriority("quality")).toBe("quality");
    expect(normalizeLegacyPriority("balanced")).toBe("balanced");
  });
});

describe("hasAnySelection", () => {
  it("returns true for non-empty string", () => {
    expect(hasAnySelection("Meningkatkan brand awareness")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(hasAnySelection("")).toBe(false);
    expect(hasAnySelection("  ")).toBe(false);
  });
});
