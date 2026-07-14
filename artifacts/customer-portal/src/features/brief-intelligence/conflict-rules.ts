/**
 * Lightweight conflict detection (section 17) — non-blocking warnings only.
 * Never removes/blocks a recommendation; the UI just shows the warning.
 */

import type { ConflictWarning } from "./types";

interface PairConflictRule {
  kind: "pair";
  code: string;
  a: { category: "style" | "audience"; key: string };
  b: { category: "style" | "audience"; key: string };
  message: string;
}

/** Context-aware rule: checks broader inputs beyond style/audience pairs. */
interface ContextConflictRule {
  kind: "context";
  code: string;
  severity: "info" | "warning";
  message: string;
  affectedKeys: string[];
  check: (ctx: ConflictContext) => boolean;
}

type ConflictRule = PairConflictRule | ContextConflictRule;

/** Extended context available for conflict detection. Optional — legacy callers
 *  pass only styleKeys/audienceKeys; context rules gracefully skip if absent. */
export interface ConflictContext {
  existingAssetKeys: string[];
  priorityKey: string | null;
  /** Number of deliverable-category recommendations produced by the engine. */
  deliverableCount: number;
  /** True if the engine produced any photographyDirection recommendations. */
  hasPhotographyRecommendation: boolean;
}

const CONFLICT_RULES: ConflictRule[] = [
  // ── Pair rules (Phase 2.2 originals) ──────────────────────────────────────
  {
    kind: "pair",
    code: "luxury-playful",
    a: { category: "style", key: "luxury" },
    b: { category: "style", key: "playful" },
    message: "Kombinasi gaya \"Luxury\" dan \"Playful\" bisa terasa bertentangan — pertimbangkan menonjolkan salah satu sebagai gaya utama.",
  },
  {
    kind: "pair",
    code: "government-highly-playful",
    a: { category: "audience", key: "government" },
    b: { category: "style", key: "playful" },
    message: "Audiens \"Pemerintah\" biasanya mengharapkan kesan formal — gaya \"Playful\" berisiko terasa kurang sesuai.",
  },
  {
    kind: "pair",
    code: "corporate-colorful",
    a: { category: "style", key: "corporate" },
    b: { category: "style", key: "colorful" },
    message: "\"Corporate\" dan \"Colorful\" bisa saling menarik ke arah berbeda — pastikan tetap ada satu arah visual dominan.",
  },

  // ── Context-aware rules (Phase 3.1) ────────────────────────────────────────

  /**
   * Premium audience + highly colorful/playful style.
   * Overly vivid or playful visual styles can undercut a premium brand image.
   * Non-blocking: the styles may still work as accent elements.
   */
  {
    kind: "context",
    code: "premium-colorful-playful",
    severity: "warning",
    message: "Gaya sangat colorful atau playful dapat mengurangi kesan premium. Pertimbangkan penggunaannya sebagai aksen, bukan gaya utama.",
    affectedKeys: ["colorful", "playful"],
    check: () => false, // evaluated inline in detectConflicts with full keys
  },

  /**
   * No existing assets + photography-dependent recommendation.
   * If the user has no assets AND the engine recommends photography direction,
   * surface a gentle reminder without blocking the recommendation.
   */
  {
    kind: "context",
    code: "no-assets-photography",
    severity: "warning",
    message: "Arah visual ini membutuhkan aset foto. Pertimbangkan image generation, stock imagery, atau sesi fotografi.",
    affectedKeys: ["photographyDirection"],
    check: (ctx) =>
      ctx.existingAssetKeys.includes("none") && ctx.hasPhotographyRecommendation,
  },

  /**
   * Speed priority + excessive optional deliverables.
   * When the client prioritises speed, a large deliverable list adds scope risk.
   */
  {
    kind: "context",
    code: "speed-excessive-deliverables",
    severity: "warning",
    message: "Untuk target pengerjaan cepat, prioritaskan deliverable inti terlebih dahulu.",
    affectedKeys: ["deliverable"],
    check: (ctx) =>
      ctx.priorityKey === "speed" && ctx.deliverableCount > 3,
  },
];

/** Detect conflicts among a flat set of selected style/audience keys
 *  (both already-selected-by-user AND recommended values are checked).
 *  Pass `context` for the Phase 3.1 context-aware rules. */
export function detectConflicts(
  styleKeys: string[],
  audienceKeys: string[],
  context?: ConflictContext,
): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];

  const has = (cat: "style" | "audience", key: string) =>
    cat === "style" ? styleKeys.includes(key) : audienceKeys.includes(key);

  const ctx: ConflictContext = context ?? {
    existingAssetKeys: [],
    priorityKey: null,
    deliverableCount: 0,
    hasPhotographyRecommendation: false,
  };

  for (const rule of CONFLICT_RULES) {
    if (rule.kind === "pair") {
      if (has(rule.a.category, rule.a.key) && has(rule.b.category, rule.b.key)) {
        warnings.push({
          code: rule.code,
          severity: "warning",
          message: rule.message,
          affectedKeys: [rule.a.key, rule.b.key],
        });
      }
    } else {
      // context rule
      let triggered = false;

      // Special inline check for premium-colorful-playful (needs style + audience keys)
      if (rule.code === "premium-colorful-playful") {
        const hasPremium = audienceKeys.includes("premium");
        const isColorfulOrPlayful =
          styleKeys.includes("colorful") || styleKeys.includes("playful");
        triggered = hasPremium && isColorfulOrPlayful;
      } else {
        triggered = rule.check(ctx);
      }

      if (triggered) {
        warnings.push({
          code: rule.code,
          severity: rule.severity,
          message: rule.message,
          affectedKeys: rule.affectedKeys,
        });
      }
    }
  }

  return warnings;
}
