/**
 * Creative AI Brief — Serialization & Parsing Utilities
 *
 * All chip/card selections are serialized into human-readable strings
 * using the format: "Label A; Label B; Lainnya: Custom text"
 *
 * This keeps the backend payload (BriefData) unchanged while supporting
 * visual chip selectors in the form UI.
 */

export interface ChipLike {
  value: string;
  label: string;
}

/** Detailed parse result — exposes unmatched legacy fragments and provenance. */
export interface ParsedChoice {
  selected: string[];
  custom: string;
  /** Raw fragments that did not match any known option (always folded into `custom`). */
  unmatched: string[];
  /** "structured" = every fragment matched a known option or an explicit "Lainnya:" marker.
   *  "legacy" = at least one fragment was free text that had to be treated as "other".
   *  "empty" = nothing stored. */
  source: "structured" | "legacy" | "empty";
}

/** Separator used between multi-choice items */
const SEP = "; ";
/** Tolerant splitter for legacy data: semicolon (with/without trailing space) or a line break. */
const LEGACY_SPLIT_RE = /\s*;\s*|\r?\n+/;

// ── Multi-choice ─────────────────────────────────────────────────────────────

/**
 * Converts an array of selected chip values + optional "Lainnya" custom text
 * into a single human-readable string for storage in a BriefData string field.
 *
 * @example
 * serializeChoices(["brand_awareness", "sales"], GOAL_OPTIONS)
 * // → "Meningkatkan brand awareness; Meningkatkan penjualan"
 *
 * serializeChoices(["brand_awareness", "other"], GOAL_OPTIONS, "Cari investor pasar Asia")
 * // → "Meningkatkan brand awareness; Lainnya: Cari investor pasar Asia"
 */
export function serializeChoices(
  selected: string[],
  options: ChipLike[],
  customText = "",
): string {
  const parts: string[] = [];
  for (const val of selected) {
    if (val === "other") {
      if (customText.trim()) parts.push(`Lainnya: ${customText.trim()}`);
      else parts.push("Lainnya");
    } else {
      const opt = options.find((o) => o.value === val);
      parts.push(opt?.label ?? val);
    }
  }
  return parts.filter(Boolean).join(SEP);
}

/**
 * Recovers chip selected values + custom text from a stored string.
 * Handles both serialized (Phase 2) format and legacy free-text values.
 *
 * Any fragment that cannot be matched to a known option is NEVER dropped:
 * it activates "other" and is folded into `custom` so it stays visible and
 * editable in the UI (never silently lost, never review-only).
 */
export function parseChoices(
  stored: string,
  options: ChipLike[],
): ParsedChoice {
  if (!stored?.trim()) return { selected: [], custom: "", unmatched: [], source: "empty" };

  // Tolerate legacy data that used a bare ";" or a line break instead of the
  // canonical "; " separator (e.g. copy-pasted or hand-edited old drafts).
  const parts = stored
    .split(LEGACY_SPLIT_RE)
    .map((p) => p.trim())
    .filter(Boolean);

  const selected: string[] = [];
  const seen = new Set<string>();
  const unmatched: string[] = [];
  const customFromMarker: string[] = [];
  let sawStructuredMarker = false;

  const addSelected = (value: string) => {
    if (!seen.has(value)) {
      seen.add(value);
      selected.push(value);
    }
  };

  for (const part of parts) {
    if (/^Lainnya\s*:\s*/i.test(part)) {
      addSelected("other");
      const text = part.replace(/^Lainnya\s*:\s*/i, "").trim();
      if (text) customFromMarker.push(text);
      sawStructuredMarker = true;
      continue;
    }
    if (/^Lainnya$/i.test(part)) {
      addSelected("other");
      sawStructuredMarker = true;
      continue;
    }

    const opt = options.find(
      (o) => o.value === part || o.label.toLowerCase() === part.toLowerCase(),
    );
    if (opt) {
      addSelected(opt.value);
    } else {
      // Legacy free text: never discard — surface as "other" + custom.
      addSelected("other");
      unmatched.push(part);
    }
  }

  // Deduplicate unmatched fragments (case-insensitive) while preserving order.
  const dedupedUnmatched: string[] = [];
  const seenUnmatched = new Set<string>();
  for (const u of [...customFromMarker, ...unmatched]) {
    const key = u.toLowerCase();
    if (!seenUnmatched.has(key)) {
      seenUnmatched.add(key);
      dedupedUnmatched.push(u);
    }
  }

  const custom = dedupedUnmatched.join(SEP);
  const source: ParsedChoice["source"] =
    unmatched.length > 0 ? "legacy" : sawStructuredMarker || selected.length > 0 ? "structured" : "empty";

  return { selected, custom, unmatched, source };
}

// ── Single-choice ─────────────────────────────────────────────────────────────

/**
 * Serializes a single chip selection to a human-readable string.
 * "other" + customText → stores the custom text directly (no prefix).
 */
export function serializeSingleChoice(
  selected: string,
  options: ChipLike[],
  customText = "",
): string {
  if (!selected) return "";
  if (selected === "other") return customText.trim();
  const opt = options.find((o) => o.value === selected);
  return opt?.label ?? selected;
}

/**
 * Recovers single chip value from a stored string.
 * Falls back to "other" + custom text if the string isn't recognized.
 */
export function parseSingleChoice(
  stored: string,
  options: ChipLike[],
): { selected: string; custom: string } {
  if (!stored?.trim()) return { selected: "", custom: "" };

  // Direct value match (for internal keys stored before Phase 2)
  if (options.find((o) => o.value === stored)) {
    return { selected: stored, custom: "" };
  }

  // Label match (normal case after Phase 2)
  const opt = options.find(
    (o) => o.label === stored || o.label.toLowerCase() === stored.toLowerCase(),
  );
  if (opt) return { selected: opt.value, custom: "" };

  // Explicit "Lainnya: ..." prefix
  if (stored.startsWith("Lainnya: ")) {
    return { selected: "other", custom: stored.slice("Lainnya: ".length) };
  }

  // Unrecognized → treat as custom text
  return { selected: "other", custom: stored };
}

// ── Color ─────────────────────────────────────────────────────────────────────

/**
 * Serialize color preset selections to a string for brief.colorPalette.
 * "none" → "Tidak ada preferensi"
 * "other" + customText → appended after known colors
 */
export function serializeColors(
  selected: string[],
  presets: ChipLike[],
  customText = "",
): string {
  if (selected.includes("none")) return "Tidak ada preferensi";

  const parts: string[] = selected
    .filter((v) => v !== "other")
    .map((v) => presets.find((p) => p.value === v)?.label ?? v);

  if (selected.includes("other") && customText.trim()) {
    parts.push(customText.trim());
  }

  return parts.filter(Boolean).join(", ");
}

/**
 * Parse color string back to selected preset values + custom text.
 * Legacy fragments that don't match a preset are never dropped — they are
 * folded into `custom` (joined, if more than one) and "other" is activated.
 */
export function parseColors(
  stored: string,
  presets: ChipLike[],
): { selected: string[]; custom: string } {
  if (!stored?.trim()) return { selected: [], custom: "" };
  if (stored.toLowerCase() === "tidak ada preferensi") return { selected: ["none"], custom: "" };

  const parts = stored.split(",").map((p) => p.trim()).filter(Boolean);
  const selected: string[] = [];
  const seen = new Set<string>();
  const unmatched: string[] = [];

  const addSelected = (value: string) => {
    if (!seen.has(value)) { seen.add(value); selected.push(value); }
  };

  for (const part of parts) {
    const preset = presets.find(
      (p) => p.value === part || p.label.toLowerCase() === part.toLowerCase(),
    );
    if (preset) {
      addSelected(preset.value);
    } else {
      // Unrecognized color label (legacy free text) → treat as custom, never discard.
      addSelected("other");
      unmatched.push(part);
    }
  }

  const custom = unmatched.join(", ");
  return { selected, custom };
}

// ── Legacy normalization ──────────────────────────────────────────────────────

/** Map old priority values (pre-Phase 2) to new ChoiceChip values. */
export function normalizeLegacyPriority(value: string): string {
  const map: Record<string, string> = {
    normal: "balanced",
    urgent: "speed",
    // "high" passes through — still valid
  };
  return map[value] ?? value;
}

/**
 * Check if a multi-choice string contains meaningful selections.
 * Used to validate required fields backed by chip selectors.
 */
export function hasAnySelection(serialized: string): boolean {
  return !!serialized?.trim();
}
