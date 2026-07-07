/**
 * guardrailService — reads provider guardrail configuration from ai_settings.
 * All values are stored as key-value rows with category = "guardrail".
 */

import { like } from "drizzle-orm";
import { db, aiSettingsTable } from "@workspace/db";

export interface GuardrailConfig {
  maxCostPerWorkflow: number;  // USD; 0 = unlimited
  maxCostPerRequest: number;   // USD; 0 = unlimited
  maxRetryPerProvider: number;
  providerTimeoutMs: number;
  disableOnErrorRate: number;  // 0–1; 0 = never disable
  fallbackEnabled: boolean;
}

const DEFAULTS: GuardrailConfig = {
  maxCostPerWorkflow: 5.0,
  maxCostPerRequest: 0.5,
  maxRetryPerProvider: 3,
  providerTimeoutMs: 30000,
  disableOnErrorRate: 0.5,
  fallbackEnabled: true,
};

export async function readGuardrails(): Promise<GuardrailConfig> {
  try {
    const rows = await db
      .select({ key: aiSettingsTable.key, value: aiSettingsTable.value })
      .from(aiSettingsTable)
      .where(like(aiSettingsTable.key, "guardrail.%"));

    const s: Record<string, string> = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    return {
      maxCostPerWorkflow: parseFloat(s["guardrail.max_cost_per_workflow"] ?? String(DEFAULTS.maxCostPerWorkflow)),
      maxCostPerRequest: parseFloat(s["guardrail.max_cost_per_request"] ?? String(DEFAULTS.maxCostPerRequest)),
      maxRetryPerProvider: parseInt(s["guardrail.max_retry_per_provider"] ?? String(DEFAULTS.maxRetryPerProvider), 10),
      providerTimeoutMs: parseInt(s["guardrail.provider_timeout_ms"] ?? String(DEFAULTS.providerTimeoutMs), 10),
      disableOnErrorRate: parseFloat(s["guardrail.disable_provider_on_error_rate"] ?? String(DEFAULTS.disableOnErrorRate)),
      fallbackEnabled: (s["guardrail.fallback_enabled"] ?? "true") !== "false",
    };
  } catch {
    return DEFAULTS;
  }
}
