/**
 * Lightweight conflict detection (section 17) — non-blocking warnings only.
 * Never removes/blocks a recommendation; the UI just shows the warning.
 */

import type { ConflictWarning } from "./types";

interface ConflictRule {
  code: string;
  a: { category: "style" | "audience"; key: string };
  b: { category: "style" | "audience"; key: string };
  message: string;
}

const CONFLICT_RULES: ConflictRule[] = [
  {
    code: "luxury-playful",
    a: { category: "style", key: "luxury" },
    b: { category: "style", key: "playful" },
    message: "Kombinasi gaya \"Luxury\" dan \"Playful\" bisa terasa bertentangan — pertimbangkan menonjolkan salah satu sebagai gaya utama.",
  },
  {
    code: "government-highly-playful",
    a: { category: "audience", key: "government" },
    b: { category: "style", key: "playful" },
    message: "Audiens \"Pemerintah\" biasanya mengharapkan kesan formal — gaya \"Playful\" berisiko terasa kurang sesuai.",
  },
  {
    code: "corporate-colorful",
    a: { category: "style", key: "corporate" },
    b: { category: "style", key: "colorful" },
    message: "\"Corporate\" dan \"Colorful\" bisa saling menarik ke arah berbeda — pastikan tetap ada satu arah visual dominan.",
  },
];

/** Detect conflicts among a flat set of selected style/audience keys
 *  (both already-selected-by-user AND recommended values are checked). */
export function detectConflicts(styleKeys: string[], audienceKeys: string[]): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];
  const has = (cat: "style" | "audience", key: string) =>
    cat === "style" ? styleKeys.includes(key) : audienceKeys.includes(key);

  for (const rule of CONFLICT_RULES) {
    if (has(rule.a.category, rule.a.key) && has(rule.b.category, rule.b.key)) {
      warnings.push({
        code: rule.code,
        severity: "warning",
        message: rule.message,
        affectedKeys: [rule.a.key, rule.b.key],
      });
    }
  }
  return warnings;
}
