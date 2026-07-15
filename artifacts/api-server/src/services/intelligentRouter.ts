/**
 * intelligentRouter — Multi-factor model scoring and selection.
 *
 * Scoring factors (per spec):
 *   1. Capability Match   — from ai_capabilities table (accuracy/speed/cost scores)
 *   2. Priority           — from capability.priority + model priority in DB
 *   3. Historical Latency — average latency_ms from ai_cost_records
 *   4. Historical Cost    — average estimated_cost_usd from ai_cost_records
 *   5. Provider Health    — error rate check + provider.isActive guard
 *   6. Model Status       — model.isActive
 *   7. Context Length     — model.contextWindow vs required context size
 *   8. Project Requirement — agent slug → skill mapping
 *
 * Phase 4.5 additions:
 *   - readGuardrails()         → guardrail-aware provider filtering
 *   - getProviderErrorRate()   → health check from recent cost records
 *   - fallbackEnabled flag     → exposed in RoutingResult
 *
 * Falls back to the existing aiModelRouter for agents with no capability matrix entry.
 */

import { eq, and, avg, sql, count } from "drizzle-orm";
import { db, aiCostRecordsTable } from "@workspace/db";
import { getAllActiveModels, type ModelWithProvider } from "./aiModelService.js";
import { getProviderApiKey } from "./aiSecretService.js";
import { getCapabilitiesForSkill, computeCapabilityScore } from "./capabilityService.js";
import { routeToModel, getFallbackModels } from "./aiModelRouter.js";
import { readGuardrails } from "./guardrailService.js";

// ── Agent slug → capability skill mapping ─────────────────────────────────────

const AGENT_SKILL_MAP: Record<string, string> = {
  "brand-strategist":           "branding",
  "creative-director":          "creative_direction",
  "copywriter":                 "copywriting",
  "quality-control":            "quality_control",
  "fashion-design-specialist":  "fashion_design",
  "interior-design-specialist": "interior_design",
};

// ── Scoring weights ───────────────────────────────────────────────────────────

const WEIGHTS = {
  capabilityMatch: 0.35,
  priority:        0.15,
  latency:         0.15,
  cost:            0.20,
  contextFit:      0.15,
};

// ── Historical stats from cost records ───────────────────────────────────────

interface HistoricalStats {
  avgLatencyMs: number | null;
  avgCostUsd: number | null;
}

async function getHistoricalStats(
  provider: string,
  model: string,
): Promise<HistoricalStats> {
  try {
    const [row] = await db
      .select({
        avgLatencyMs: avg(aiCostRecordsTable.latencyMs),
        avgCostUsd: avg(sql<number>`estimated_cost_usd::numeric`),
      })
      .from(aiCostRecordsTable)
      .where(
        and(
          eq(aiCostRecordsTable.provider, provider),
          eq(aiCostRecordsTable.model, model),
          eq(aiCostRecordsTable.status, "success"),
        ),
      );

    return {
      avgLatencyMs: row?.avgLatencyMs != null ? Number(row.avgLatencyMs) : null,
      avgCostUsd: row?.avgCostUsd != null ? Number(row.avgCostUsd) : null,
    };
  } catch {
    return { avgLatencyMs: null, avgCostUsd: null };
  }
}

// ── Provider health: error rate over last 24 hours ────────────────────────────

async function getProviderErrorRate(providerSlug: string): Promise<number> {
  try {
    const [row] = await db
      .select({
        total: count(),
        failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      })
      .from(aiCostRecordsTable)
      .where(
        and(
          eq(aiCostRecordsTable.provider, providerSlug),
          sql`created_at >= now() - interval '1 day'`,
        ),
      );

    const total = Number(row?.total ?? 0);
    if (total < 5) return 0; // insufficient data — assume healthy
    return Number(row?.failed ?? 0) / total;
  } catch {
    return 0;
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

interface ScoredModel {
  model: ModelWithProvider;
  finalScore: number;
  breakdown: {
    capabilityScore: number;
    priorityScore: number;
    latencyScore: number;
    costScore: number;
    contextScore: number;
  };
}

async function scoreModel(
  mwp: ModelWithProvider,
  skill: string,
  requiredContextTokens = 0,
): Promise<ScoredModel> {
  const { model, provider } = mwp;

  // 1. Capability match — look up from ai_capabilities
  const caps = await getCapabilitiesForSkill(skill);
  const matchedCap = caps.find(
    (c) => c.model?.id === model.id || c.provider?.id === provider.id,
  );
  const capabilityScore = matchedCap
    ? computeCapabilityScore(matchedCap.capability)
    : 50; // default mid-score if no matrix entry

  // 2. Priority — from capability row or default
  const rawPriority = matchedCap?.capability.priority ?? 50;
  const priorityScore = Math.min(rawPriority, 100);

  // 3. Historical latency — lower is better; normalise to 0–100
  const stats = await getHistoricalStats(provider.slug, model.modelId);
  let latencyScore = 70; // default if no history
  if (stats.avgLatencyMs != null) {
    // <1s → 100, 5s → 50, 15s+ → 0
    latencyScore = Math.max(0, Math.min(100, 100 - (stats.avgLatencyMs / 150)));
  }

  // 4. Cost — lower is better; normalise to 0–100
  const costPerOutput = model.costPerOutputToken ? parseFloat(model.costPerOutputToken) : 0.00005;
  // Range roughly $0.0000006 (cheapest) to $0.00015 (most expensive)
  const costScore = Math.max(0, Math.min(100, 100 - (costPerOutput / 0.00002) * 100));

  // 5. Context fit — does the model have enough context window?
  const contextWindow = model.contextWindow ?? 8192;
  const contextScore = contextWindow >= requiredContextTokens * 1.2 ? 100 : 30;

  const finalScore =
    capabilityScore * WEIGHTS.capabilityMatch +
    priorityScore * WEIGHTS.priority +
    latencyScore * WEIGHTS.latency +
    costScore * WEIGHTS.cost +
    contextScore * WEIGHTS.contextFit;

  return {
    model: mwp,
    finalScore,
    breakdown: { capabilityScore, priorityScore, latencyScore, costScore, contextScore },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RoutingResult {
  selected: ModelWithProvider;
  fallbacks: ModelWithProvider[];
  score: number;
  usedCapabilityMatrix: boolean;
  fallbackEnabled: boolean;
}

/**
 * Route to the best model for a given agent slug.
 * Uses capability matrix scoring when available; falls back to keyword heuristics.
 * Respects guardrail settings: disabled providers are filtered out.
 */
export async function routeForAgent(
  agentSlug: string,
  opts: { requiredContextTokens?: number; prompt?: string } = {},
): Promise<RoutingResult | null> {
  const skill = AGENT_SKILL_MAP[agentSlug];

  // Load guardrail config (non-blocking on error)
  const guardrails = await readGuardrails().catch(() => ({
    disableOnErrorRate: 0.5,
    fallbackEnabled: true,
    maxCostPerRequest: 0,
  }));

  // Get all models with configured API keys
  const allModels = await getAllActiveModels();
  let available = allModels.filter(({ provider }) => !!getProviderApiKey(provider.slug));

  // Phase 4.5: Filter providers above error rate threshold
  if (guardrails.disableOnErrorRate > 0 && available.length > 1) {
    const healthChecks = await Promise.all(
      [...new Set(available.map((m) => m.provider.slug))].map(async (slug) => ({
        slug,
        errorRate: await getProviderErrorRate(slug),
      })),
    );
    const healthyProviders = new Set(
      healthChecks
        .filter((h) => h.errorRate < guardrails.disableOnErrorRate)
        .map((h) => h.slug),
    );
    // Only filter if we'd still have candidates left
    const filtered = available.filter((m) => healthyProviders.has(m.provider.slug));
    if (filtered.length > 0) {
      available = filtered;
    }
  }

  if (available.length === 0) return null;

  // Check if capability matrix has entries for this skill
  const capEntries = skill ? await getCapabilitiesForSkill(skill) : [];
  const usedCapabilityMatrix = capEntries.length > 0;

  let ranked: ModelWithProvider[];

  if (usedCapabilityMatrix) {
    // Score all available models against the capability matrix
    const scored = await Promise.all(
      available.map((mwp) => scoreModel(mwp, skill, opts.requiredContextTokens ?? 0)),
    );
    scored.sort((a, b) => b.finalScore - a.finalScore);
    ranked = scored.map((s) => s.model);
  } else {
    // Fall back to keyword-based heuristic router
    const best = await routeToModel(opts.prompt ?? agentSlug);
    if (!best) return null;
    const rest = await getFallbackModels(best.model.id);
    ranked = [best, ...rest];
  }

  const [selected, ...fallbacks] = ranked;
  if (!selected) return null;

  return {
    selected,
    fallbacks: fallbacks.slice(0, 3), // keep up to 3 fallbacks
    score: usedCapabilityMatrix
      ? (await scoreModel(selected, skill ?? "branding", opts.requiredContextTokens ?? 0)).finalScore
      : 0,
    usedCapabilityMatrix,
    fallbackEnabled: guardrails.fallbackEnabled,
  };
}
