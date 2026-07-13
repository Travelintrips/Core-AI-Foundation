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

/** Separator used between multi-choice items */
const SEP = "; ";

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
 * Handles both serialized format and legacy free-text values.
 */
export function parseChoices(
  stored: string,
  options: ChipLike[],
): { selected: string[]; custom: string } {
  if (!stored?.trim()) return { selected: [], custom: "" };

  const parts = stored.split(SEP).map((p) => p.trim()).filter(Boolean);
  const selected: string[] = [];
  let custom = "";

  for (const part of parts) {
    if (part.startsWith("Lainnya: ")) {
      selected.push("other");
      custom = part.slice("Lainnya: ".length);
    } else if (part === "Lainnya") {
      selected.push("other");
    } else {
      const opt = options.find(
        (o) =>
          o.label === part || o.label.toLowerCase() === part.toLowerCase(),
      );
      if (opt) selected.push(opt.value);
      // Legacy unrecognized text: skip chip match (value preserved as-is in stored string)
    }
  }

  return { selected, custom };
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
 */
export function parseColors(
  stored: string,
  presets: ChipLike[],
): { selected: string[]; custom: string } {
  if (!stored?.trim()) return { selected: [], custom: "" };
  if (stored === "Tidak ada preferensi") return { selected: ["none"], custom: "" };

  const parts = stored.split(",").map((p) => p.trim()).filter(Boolean);
  const selected: string[] = [];
  let custom = "";

  for (const part of parts) {
    const preset = presets.find(
      (p) => p.label === part || p.label.toLowerCase() === part.toLowerCase(),
    );
    if (preset) {
      selected.push(preset.value);
    } else {
      // Unrecognized color label → treat as custom
      selected.push("other");
      custom = part;
    }
  }

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
