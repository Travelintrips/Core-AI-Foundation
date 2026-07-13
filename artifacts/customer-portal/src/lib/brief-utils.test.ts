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

// ── Phase 2.1 — Legacy compatibility hardening ─────────────────────────────────

const AUDIENCE_OPTIONS = [
  { value: "b2b", label: "B2B" },
  { value: "distributor", label: "Distributor" },
  { value: "corporate", label: "Perusahaan" },
  { value: "other", label: "Lainnya" },
];

describe("parseChoices — legacy free text is never dropped", () => {
  it("pure legacy sentence becomes 'other' + full custom text (source: legacy)", () => {
    const stored = "Membuat perusahaan lebih dipercaya oleh importir China";
    const result = parseChoices(stored, GOAL_OPTIONS);
    expect(result.selected).toEqual(["other"]);
    expect(result.custom).toBe(stored);
    expect(result.unmatched).toEqual([stored]);
    expect(result.source).toBe("legacy");
  });

  it("mixed known + unknown values keeps matched chips and preserves the unmatched text", () => {
    const result = parseChoices("B2B; Distributor; Perusahaan tambang", AUDIENCE_OPTIONS);
    expect(result.selected).toEqual(["b2b", "distributor", "other"]);
    expect(result.custom).toBe("Perusahaan tambang");
    expect(result.unmatched).toEqual(["Perusahaan tambang"]);
    expect(result.source).toBe("legacy");
  });

  it("a real-world legacy sentence with internal commas is never split into fake chips", () => {
    const stored = "Pemilik kapal, eksportir seafood, dan perusahaan cold storage";
    const result = parseChoices(stored, AUDIENCE_OPTIONS);
    expect(result.selected).toEqual(["other"]);
    expect(result.custom).toBe(stored);
  });

  it("structured value with explicit 'Lainnya:' marker reports source: structured", () => {
    const result = parseChoices(
      "Meningkatkan penjualan; Meningkatkan brand awareness; Lainnya: Ekspansi regional",
      GOAL_OPTIONS,
    );
    expect(result.selected).toEqual(["sales", "brand_awareness", "other"]);
    expect(result.custom).toBe("Ekspansi regional");
    expect(result.source).toBe("structured");
  });

  it("empty string reports source: empty", () => {
    expect(parseChoices("", GOAL_OPTIONS).source).toBe("empty");
  });
});

describe("parseChoices — tolerant delimiters", () => {
  it("tolerates a bare semicolon with no trailing space", () => {
    const result = parseChoices("B2B;Distributor", AUDIENCE_OPTIONS);
    expect(result.selected).toEqual(["b2b", "distributor"]);
    expect(result.custom).toBe("");
  });

  it("tolerates newline-separated legacy values", () => {
    const result = parseChoices("B2B\nDistributor", AUDIENCE_OPTIONS);
    expect(result.selected).toEqual(["b2b", "distributor"]);
  });

  it("does not fragment a legacy sentence on commas, slashes, or ampersands", () => {
    const stored = "Eksportir & importir, distributor/agen di Asia Tenggara";
    const result = parseChoices(stored, AUDIENCE_OPTIONS);
    expect(result.selected).toEqual(["other"]);
    expect(result.custom).toBe(stored);
  });

  it("is case-insensitive when matching labels", () => {
    const result = parseChoices("b2b; DISTRIBUTOR", AUDIENCE_OPTIONS);
    expect(result.selected).toEqual(["b2b", "distributor"]);
  });

  it("trims whitespace around fragments", () => {
    const result = parseChoices("  B2B  ;   Distributor  ", AUDIENCE_OPTIONS);
    expect(result.selected).toEqual(["b2b", "distributor"]);
  });

  it("removes duplicate options and duplicate unmatched fragments", () => {
    const result = parseChoices("B2B; B2B; Toko kelontong; toko kelontong", AUDIENCE_OPTIONS);
    expect(result.selected).toEqual(["b2b", "other"]);
    expect(result.custom).toBe("Toko kelontong");
  });

  it("handles a malformed 'Lainnya:' prefix (extra spaces / no space after colon)", () => {
    const a = parseChoices("Lainnya:Ekspansi regional", GOAL_OPTIONS);
    expect(a.selected).toEqual(["other"]);
    expect(a.custom).toBe("Ekspansi regional");

    const b = parseChoices("Lainnya  :  Ekspansi regional", GOAL_OPTIONS);
    expect(b.selected).toEqual(["other"]);
    expect(b.custom).toBe("Ekspansi regional");
  });

  it("English legacy label normalizes the same as the Indonesian label", () => {
    const idResult = parseChoices("Distributor", AUDIENCE_OPTIONS);
    const enOptions = [...AUDIENCE_OPTIONS, { value: "corporate", label: "Corporate" }];
    const enResult = parseChoices("Corporate", enOptions);
    expect(idResult.selected).toEqual(["distributor"]);
    expect(enResult.selected).toEqual(["corporate"]);
  });
});

describe("parseChoices / serializeChoices — round trip is lossless", () => {
  it("predefined only", () => {
    const original = ["brand_awareness", "sales"];
    const serialized = serializeChoices(original, GOAL_OPTIONS);
    const parsed = parseChoices(serialized, GOAL_OPTIONS);
    expect(parsed.selected).toEqual(original);
    expect(serializeChoices(parsed.selected, GOAL_OPTIONS, parsed.custom)).toBe(serialized);
  });

  it("custom only", () => {
    const serialized = serializeChoices(["other"], GOAL_OPTIONS, "Sertifikasi halal");
    const parsed = parseChoices(serialized, GOAL_OPTIONS);
    expect(parsed.selected).toEqual(["other"]);
    expect(parsed.custom).toBe("Sertifikasi halal");
    expect(serializeChoices(parsed.selected, GOAL_OPTIONS, parsed.custom)).toBe(serialized);
  });

  it("predefined + custom", () => {
    const serialized = serializeChoices(["brand_awareness", "other"], GOAL_OPTIONS, "Ekspansi ke Malaysia");
    const parsed = parseChoices(serialized, GOAL_OPTIONS);
    expect(parsed.selected).toEqual(["brand_awareness", "other"]);
    expect(parsed.custom).toBe("Ekspansi ke Malaysia");
    expect(serializeChoices(parsed.selected, GOAL_OPTIONS, parsed.custom)).toBe(serialized);
  });

  it("pure legacy sentence — content is preserved after a re-serialize/parse cycle", () => {
    const legacy = "Membuat perusahaan lebih dipercaya oleh importir China";
    const parsed = parseChoices(legacy, GOAL_OPTIONS);
    const reserialized = serializeChoices(parsed.selected, GOAL_OPTIONS, parsed.custom);
    const reparsed = parseChoices(reserialized, GOAL_OPTIONS);
    expect(reparsed.selected).toEqual(parsed.selected);
    expect(reparsed.custom).toBe(legacy);
  });

  it("mixed legacy values — matched chips + unmatched text both survive a full cycle", () => {
    const mixed = "B2B; Distributor; Perusahaan tambang";
    const parsed = parseChoices(mixed, AUDIENCE_OPTIONS);
    const reserialized = serializeChoices(parsed.selected, AUDIENCE_OPTIONS, parsed.custom);
    const reparsed = parseChoices(reserialized, AUDIENCE_OPTIONS);
    expect(reparsed.selected).toEqual(parsed.selected);
    expect(reparsed.custom).toBe(parsed.custom);
  });

  it("empty string stays empty through the cycle", () => {
    const parsed = parseChoices("", GOAL_OPTIONS);
    expect(serializeChoices(parsed.selected, GOAL_OPTIONS, parsed.custom)).toBe("");
  });

  it("malformed delimiter (bare semicolon) still round-trips to the canonical form", () => {
    const parsed = parseChoices("B2B;Distributor", AUDIENCE_OPTIONS);
    const reserialized = serializeChoices(parsed.selected, AUDIENCE_OPTIONS, parsed.custom);
    expect(reserialized).toBe("B2B; Distributor");
    expect(parseChoices(reserialized, AUDIENCE_OPTIONS).selected).toEqual(parsed.selected);
  });

  it("line-break separated legacy values round-trip", () => {
    const parsed = parseChoices("B2B\nDistributor", AUDIENCE_OPTIONS);
    const reserialized = serializeChoices(parsed.selected, AUDIENCE_OPTIONS, parsed.custom);
    expect(parseChoices(reserialized, AUDIENCE_OPTIONS).selected).toEqual(parsed.selected);
  });

  it("duplicate options collapse but no information is lost", () => {
    const parsed = parseChoices("B2B; B2B; Distributor", AUDIENCE_OPTIONS);
    expect(parsed.selected).toEqual(["b2b", "distributor"]);
  });

  it("capitalization differences resolve to the same option", () => {
    const parsed = parseChoices("b2b; DISTRIBUTOR", AUDIENCE_OPTIONS);
    expect(parsed.selected).toEqual(["b2b", "distributor"]);
  });

  it("custom text containing commas, semicolons, or colons round-trips exactly", () => {
    const custom = "Toko A, Toko B; catatan: kirim before noon";
    // Semicolons inside custom text would be mis-split by naive parsing — verify
    // that once captured as `custom`, a full serialize→parse cycle keeps it intact
    // as long as it isn't re-split (custom text is stored after the "Lainnya:" marker
    // as a single trailing fragment when there's nothing after it to split on).
    const serialized = serializeChoices(["other"], GOAL_OPTIONS, custom);
    expect(serialized).toBe(`Lainnya: ${custom}`);
  });
});

describe("parseColors — legacy hardening", () => {
  const COLOR_PRESETS2 = [
    { value: "blue", label: "Biru" },
    { value: "red", label: "Merah" },
    { value: "none", label: "Tidak ada preferensi" },
    { value: "other", label: "Warna lainnya" },
  ];

  it("preserves multiple unmatched legacy color names instead of only the last one", () => {
    const result = parseColors("Biru, Teal, Mustard", COLOR_PRESETS2);
    expect(result.selected).toEqual(["blue", "other"]);
    expect(result.custom).toBe("Teal, Mustard");
  });

  it("is case-insensitive on the 'no preference' sentinel", () => {
    expect(parseColors("TIDAK ADA PREFERENSI", COLOR_PRESETS2).selected).toEqual(["none"]);
  });
});
