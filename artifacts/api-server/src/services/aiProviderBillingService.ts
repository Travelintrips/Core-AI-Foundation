import { GoogleAuth } from "google-auth-library";
import { logger } from "../lib/logger.js";
import { enqueueAiCoreSystemInboxAlert } from "./aiCoreChatInboxService.js";
import { sendAdminWhatsappNotification } from "./codingWhatsappNotificationService.js";

export type AiProviderBillingStatus =
  | "OK"
  | "WARNING"
  | "TOP_UP_REQUIRED"
  | "UNCONFIGURED"
  | "ERROR";

export type AiProviderBillingSnapshotItem = {
  provider: "openai" | "anthropic" | "gemini";
  label: string;
  configured: boolean;
  status: AiProviderBillingStatus;
  source: "provider_api" | "gcp_billing_export" | "unavailable";
  currency: string;
  monthCost: number | null;
  todayCost: number | null;
  monthlyBudget: number | null;
  remainingBudget: number | null;
  usagePercent: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  requests: number | null;
  message: string;
};

export type AiProviderBillingSnapshot = {
  checkedAt: string;
  alertThresholdPercent: number;
  providers: AiProviderBillingSnapshotItem[];
};

class ProviderBillingHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

let monitorTimer: NodeJS.Timeout | null = null;
let monitorKickoff: NodeJS.Timeout | null = null;

function numericEnv(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function alertThreshold(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.AI_PROVIDER_BILLING_ALERT_PERCENT ?? "80");
  return Math.max(1, Math.min(99, Number.isFinite(parsed) ? parsed : 80));
}

function monthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    start,
    today,
    end: now,
    startUnix: Math.floor(start.getTime() / 1000),
    todayUnix: Math.floor(today.getTime() / 1000),
    endUnix: Math.floor(now.getTime() / 1000),
  };
}

export function evaluateAiProviderBillingStatus(input: {
  configured: boolean;
  monthCost: number | null;
  monthlyBudget: number | null;
  thresholdPercent?: number;
  paymentRequired?: boolean;
  error?: boolean;
}): {
  status: AiProviderBillingStatus;
  remainingBudget: number | null;
  usagePercent: number | null;
} {
  if (!input.configured) {
    return { status: "UNCONFIGURED", remainingBudget: null, usagePercent: null };
  }
  if (input.paymentRequired) {
    return { status: "TOP_UP_REQUIRED", remainingBudget: 0, usagePercent: 100 };
  }
  if (input.error) {
    return { status: "ERROR", remainingBudget: null, usagePercent: null };
  }

  const budget =
    input.monthlyBudget != null && input.monthlyBudget > 0
      ? input.monthlyBudget
      : null;
  const cost = input.monthCost ?? 0;
  if (budget == null) {
    return { status: "OK", remainingBudget: null, usagePercent: null };
  }

  const remainingBudget = Math.max(0, budget - cost);
  const usagePercent = Math.max(0, (cost / budget) * 100);
  if (cost >= budget) {
    return { status: "TOP_UP_REQUIRED", remainingBudget, usagePercent };
  }
  const threshold = Math.max(1, Math.min(99, input.thresholdPercent ?? 80));
  if (usagePercent >= threshold) {
    return { status: "WARNING", remainingBudget, usagePercent };
  }
  return { status: "OK", remainingBudget, usagePercent };
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new ProviderBillingHttpError(
        response.status,
        `Provider billing API returned HTTP ${response.status}`,
      );
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function openAiBilling(
  env: NodeJS.ProcessEnv,
  now: Date,
): Promise<AiProviderBillingSnapshotItem> {
  const key = (env.OPENAI_ADMIN_KEY ?? "").trim();
  const budget = numericEnv(env.OPENAI_MONTHLY_BUDGET_USD);
  const threshold = alertThreshold(env);
  if (!key) {
    return {
      provider: "openai",
      label: "OpenAI",
      configured: false,
      status: "UNCONFIGURED",
      source: "unavailable",
      currency: "USD",
      monthCost: null,
      todayCost: null,
      monthlyBudget: budget,
      remainingBudget: null,
      usagePercent: null,
      inputTokens: null,
      outputTokens: null,
      requests: null,
      message: "OPENAI_ADMIN_KEY belum dikonfigurasi untuk membaca Organization Usage & Costs.",
    };
  }

  const window = monthWindow(now);
  try {
    let monthCost = 0;
    let todayCost = 0;
    let page: string | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const params = new URLSearchParams({
        start_time: String(window.startUnix),
        end_time: String(window.endUnix),
        bucket_width: "1d",
        limit: "31",
      });
      if (page) params.set("page", page);
      const payload = object(await fetchJson(
        `https://api.openai.com/v1/organization/costs?${params.toString()}`,
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } },
      ));
      for (const bucket of records(payload["data"])) {
        const bucketStart = Number(bucket["start_time"] ?? 0);
        for (const result of records(bucket["results"])) {
          const amount = object(result["amount"]);
          const value = Number(amount["value"] ?? 0);
          if (!Number.isFinite(value)) continue;
          monthCost += value;
          if (bucketStart >= window.todayUnix) todayCost += value;
        }
      }
      if (payload["has_more"] !== true || typeof payload["next_page"] !== "string") break;
      page = String(payload["next_page"]);
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let requests = 0;
    page = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const params = new URLSearchParams({
        start_time: String(window.startUnix),
        end_time: String(window.endUnix),
        bucket_width: "1d",
        limit: "31",
      });
      params.append("group_by", "model");
      if (page) params.set("page", page);
      const payload = object(await fetchJson(
        `https://api.openai.com/v1/organization/usage/completions?${params.toString()}`,
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } },
      ));
      for (const bucket of records(payload["data"])) {
        for (const result of records(bucket["results"])) {
          inputTokens += Number(result["input_tokens"] ?? 0) || 0;
          outputTokens += Number(result["output_tokens"] ?? 0) || 0;
          requests += Number(result["num_model_requests"] ?? 0) || 0;
        }
      }
      if (payload["has_more"] !== true || typeof payload["next_page"] !== "string") break;
      page = String(payload["next_page"]);
    }

    const state = evaluateAiProviderBillingStatus({
      configured: true,
      monthCost,
      monthlyBudget: budget,
      thresholdPercent: threshold,
    });
    return {
      provider: "openai",
      label: "OpenAI",
      configured: true,
      ...state,
      source: "provider_api",
      currency: "USD",
      monthCost,
      todayCost,
      monthlyBudget: budget,
      inputTokens,
      outputTokens,
      requests,
      message: budget == null
        ? "Usage live. Set OPENAI_MONTHLY_BUDGET_USD untuk mengaktifkan alert top-up/budget."
        : state.status === "TOP_UP_REQUIRED"
          ? "Budget OpenAI habis atau terlewati; top up / tambah limit diperlukan."
          : state.status === "WARNING"
            ? "Budget OpenAI mendekati batas aman."
            : "Billing OpenAI dalam batas aman.",
    };
  } catch (error) {
    const paymentRequired = error instanceof ProviderBillingHttpError && error.status === 402;
    const state = evaluateAiProviderBillingStatus({
      configured: true,
      monthCost: null,
      monthlyBudget: budget,
      thresholdPercent: threshold,
      paymentRequired,
      error: !paymentRequired,
    });
    return {
      provider: "openai",
      label: "OpenAI",
      configured: true,
      ...state,
      source: "provider_api",
      currency: "USD",
      monthCost: null,
      todayCost: null,
      monthlyBudget: budget,
      inputTokens: null,
      outputTokens: null,
      requests: null,
      message: paymentRequired
        ? "OpenAI mengembalikan Payment Required; top up diperlukan."
        : error instanceof Error ? error.message : "OpenAI billing usage unavailable.",
    };
  }
}

async function anthropicBilling(
  env: NodeJS.ProcessEnv,
  now: Date,
): Promise<AiProviderBillingSnapshotItem> {
  const key = (env.ANTHROPIC_ADMIN_KEY ?? "").trim();
  const budget = numericEnv(env.ANTHROPIC_MONTHLY_BUDGET_USD);
  const threshold = alertThreshold(env);
  if (!key) {
    return {
      provider: "anthropic",
      label: "Anthropic",
      configured: false,
      status: "UNCONFIGURED",
      source: "unavailable",
      currency: "USD",
      monthCost: null,
      todayCost: null,
      monthlyBudget: budget,
      remainingBudget: null,
      usagePercent: null,
      inputTokens: null,
      outputTokens: null,
      requests: null,
      message: "ANTHROPIC_ADMIN_KEY belum dikonfigurasi untuk membaca Usage & Cost API.",
    };
  }

  const window = monthWindow(now);
  const finalizedEnd = window.today;
  try {
    let monthCost = 0;
    if (finalizedEnd.getTime() > window.start.getTime()) {
      let page: string | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const params = new URLSearchParams({
          starting_at: window.start.toISOString(),
          ending_at: finalizedEnd.toISOString(),
          bucket_width: "1d",
          limit: "31",
        });
        params.append("group_by[]", "description");
        if (page) params.set("page", page);
        const payload = object(await fetchJson(
          `https://api.anthropic.com/v1/organizations/cost_report?${params.toString()}`,
          {
            headers: {
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
              "User-Agent": "CST-AI-Core/1.0",
            },
          },
        ));
        for (const bucket of records(payload["data"])) {
          for (const result of records(bucket["results"])) {
            const cents = Number(result["amount"] ?? 0);
            if (Number.isFinite(cents)) monthCost += cents / 100;
          }
        }
        if (payload["has_more"] !== true || typeof payload["next_page"] !== "string") break;
        page = String(payload["next_page"]);
      }
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let requests = 0;
    let page: string | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const params = new URLSearchParams({
        starting_at: window.start.toISOString(),
        ending_at: now.toISOString(),
        bucket_width: "1d",
        limit: "31",
      });
      if (page) params.set("page", page);
      const payload = object(await fetchJson(
        `https://api.anthropic.com/v1/organizations/usage_report/messages?${params.toString()}`,
        {
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
            "User-Agent": "CST-AI-Core/1.0",
          },
        },
      ));
      for (const bucket of records(payload["data"])) {
        for (const result of records(bucket["results"])) {
          const cacheCreation = object(result["cache_creation"]);
          inputTokens += Number(result["uncached_input_tokens"] ?? 0) || 0;
          inputTokens += Number(result["cache_read_input_tokens"] ?? 0) || 0;
          inputTokens += Number(cacheCreation["ephemeral_1h_input_tokens"] ?? 0) || 0;
          inputTokens += Number(cacheCreation["ephemeral_5m_input_tokens"] ?? 0) || 0;
          outputTokens += Number(result["output_tokens"] ?? 0) || 0;
          requests += 1;
        }
      }
      if (payload["has_more"] !== true || typeof payload["next_page"] !== "string") break;
      page = String(payload["next_page"]);
    }

    const state = evaluateAiProviderBillingStatus({
      configured: true,
      monthCost,
      monthlyBudget: budget,
      thresholdPercent: threshold,
    });
    return {
      provider: "anthropic",
      label: "Anthropic",
      configured: true,
      ...state,
      source: "provider_api",
      currency: "USD",
      monthCost,
      todayCost: null,
      monthlyBudget: budget,
      inputTokens,
      outputTokens,
      requests,
      message: budget == null
        ? "Usage live. Set ANTHROPIC_MONTHLY_BUDGET_USD untuk mengaktifkan alert top-up/budget."
        : state.status === "TOP_UP_REQUIRED"
          ? "Budget Anthropic habis atau terlewati; top up / tambah limit diperlukan."
          : state.status === "WARNING"
            ? "Budget Anthropic mendekati batas aman."
            : "Billing Anthropic dalam batas aman.",
    };
  } catch (error) {
    const paymentRequired = error instanceof ProviderBillingHttpError && error.status === 402;
    const state = evaluateAiProviderBillingStatus({
      configured: true,
      monthCost: null,
      monthlyBudget: budget,
      thresholdPercent: threshold,
      paymentRequired,
      error: !paymentRequired,
    });
    return {
      provider: "anthropic",
      label: "Anthropic",
      configured: true,
      ...state,
      source: "provider_api",
      currency: "USD",
      monthCost: null,
      todayCost: null,
      monthlyBudget: budget,
      inputTokens: null,
      outputTokens: null,
      requests: null,
      message: paymentRequired
        ? "Anthropic mengembalikan Payment Required; top up diperlukan."
        : error instanceof Error ? error.message : "Anthropic billing usage unavailable.",
    };
  }
}

function gcpCredentials(env: NodeJS.ProcessEnv) {
  const raw =
    env.GCP_AI_CORE_COMPUTE_SA_JSON ??
    env.GCP_CODING_WORKER_COMPUTE_SA_JSON ??
    env.GCP_OLLAMA_COMPUTE_SA_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function geminiBilling(
  env: NodeJS.ProcessEnv,
  now: Date,
): Promise<AiProviderBillingSnapshotItem> {
  const billingProject = (env.GCP_BILLING_EXPORT_PROJECT ?? "").trim();
  const dataset = (env.GCP_BILLING_EXPORT_DATASET ?? "").trim();
  const table = (env.GCP_BILLING_EXPORT_TABLE ?? "").trim();
  const projectId = (env.GEMINI_BILLING_PROJECT_ID ?? "").trim();
  const credentials = gcpCredentials(env);
  const currency = (env.GCP_BILLING_CURRENCY ?? "USD").trim() || "USD";
  const budget = numericEnv(env.GEMINI_MONTHLY_BUDGET);
  const threshold = alertThreshold(env);
  if (!billingProject || !dataset || !table || !projectId || !credentials) {
    return {
      provider: "gemini",
      label: "Gemini",
      configured: false,
      status: "UNCONFIGURED",
      source: "unavailable",
      currency,
      monthCost: null,
      todayCost: null,
      monthlyBudget: budget,
      remainingBudget: null,
      usagePercent: null,
      inputTokens: null,
      outputTokens: null,
      requests: null,
      message: "Set GEMINI_BILLING_PROJECT_ID dan konfigurasi GCP Billing export untuk memantau biaya Gemini.",
    };
  }

  try {
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    const accessToken = typeof token === "string" ? token : token.token;
    if (!accessToken) throw new Error("Unable to obtain GCP billing access token");

    const window = monthWindow(now);
    const query = `
      SELECT
        FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time)) AS period,
        SUM(CAST(cost AS FLOAT64)) AS cost
      FROM \`${billingProject}.${dataset}.${table}\`
      WHERE project.id = @projectId
        AND usage_start_time >= TIMESTAMP(@start)
        AND usage_start_time <= TIMESTAMP(@end)
        AND (
          LOWER(COALESCE(service.description, '')) LIKE '%gemini%'
          OR LOWER(COALESCE(service.description, '')) LIKE '%generative language%'
          OR LOWER(COALESCE(sku.description, '')) LIKE '%gemini%'
          OR LOWER(COALESCE(sku.description, '')) LIKE '%generative language%'
        )
      GROUP BY period
      ORDER BY period
    `;
    const payload = object(await fetchJson(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(billingProject)}/queries`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          useLegacySql: false,
          parameterMode: "NAMED",
          queryParameters: [
            { name: "projectId", parameterType: { type: "STRING" }, parameterValue: { value: projectId } },
            { name: "start", parameterType: { type: "STRING" }, parameterValue: { value: window.start.toISOString() } },
            { name: "end", parameterType: { type: "STRING" }, parameterValue: { value: now.toISOString() } },
          ],
        }),
      },
    ));
    const schema = object(payload["schema"]);
    const names = records(schema["fields"]).map((field) => String(field["name"] ?? ""));
    const rows = records(payload["rows"]).map((row) => {
      const fields = records(row["f"]);
      const record = Object.fromEntries(names.map((name, index) => {
        const wrapper = object(fields[index]);
        return [name, wrapper["v"] ?? null];
      }));
      return {
        period: String(record["period"] ?? ""),
        cost: Number(record["cost"] ?? 0) || 0,
      };
    });
    const todayKey = window.today.toISOString().slice(0, 10);
    const monthCost = rows.reduce((sum, row) => sum + row.cost, 0);
    const todayCost = rows
      .filter((row) => row.period === todayKey)
      .reduce((sum, row) => sum + row.cost, 0);
    const state = evaluateAiProviderBillingStatus({
      configured: true,
      monthCost,
      monthlyBudget: budget,
      thresholdPercent: threshold,
    });
    return {
      provider: "gemini",
      label: "Gemini",
      configured: true,
      ...state,
      source: "gcp_billing_export",
      currency,
      monthCost,
      todayCost,
      monthlyBudget: budget,
      inputTokens: null,
      outputTokens: null,
      requests: null,
      message: budget == null
        ? "Biaya Gemini live dari Cloud Billing. Set GEMINI_MONTHLY_BUDGET untuk mengaktifkan alert top-up/budget."
        : state.status === "TOP_UP_REQUIRED"
          ? "Budget Gemini habis atau terlewati; top up / tambah spend cap diperlukan."
          : state.status === "WARNING"
            ? "Budget Gemini mendekati batas aman."
            : "Billing Gemini dalam batas aman.",
    };
  } catch (error) {
    const state = evaluateAiProviderBillingStatus({
      configured: true,
      monthCost: null,
      monthlyBudget: budget,
      thresholdPercent: threshold,
      error: true,
    });
    return {
      provider: "gemini",
      label: "Gemini",
      configured: true,
      ...state,
      source: "gcp_billing_export",
      currency,
      monthCost: null,
      todayCost: null,
      monthlyBudget: budget,
      inputTokens: null,
      outputTokens: null,
      requests: null,
      message: error instanceof Error ? error.message : "Gemini billing usage unavailable.",
    };
  }
}

export async function getAiProviderBillingSnapshot(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<AiProviderBillingSnapshot> {
  const providers = await Promise.all([
    openAiBilling(env, now),
    anthropicBilling(env, now),
    geminiBilling(env, now),
  ]);
  return {
    checkedAt: now.toISOString(),
    alertThresholdPercent: alertThreshold(env),
    providers,
  };
}

function alertText(item: AiProviderBillingSnapshotItem): string {
  const spent = item.monthCost == null
    ? "unknown"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: item.currency, maximumFractionDigits: 2 }).format(item.monthCost);
  const budget = item.monthlyBudget == null
    ? "not set"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: item.currency, maximumFractionDigits: 2 }).format(item.monthlyBudget);
  return [
    "AI Provider Billing Alert",
    `Provider: ${item.label}`,
    `Status: ${item.status}`,
    `Monthly spend: ${spent}`,
    `Budget/limit: ${budget}`,
    item.usagePercent == null ? "" : `Used: ${item.usagePercent.toFixed(1)}%`,
    "",
    item.message,
    "",
    "Buka Workspace > AI Provider Billing untuk detail.",
  ].filter(Boolean).join("\n");
}

export async function checkAiProviderBillingAlerts(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<AiProviderBillingSnapshot> {
  const snapshot = await getAiProviderBillingSnapshot(env, now);
  const day = now.toISOString().slice(0, 10);
  for (const item of snapshot.providers) {
    if (item.status !== "WARNING" && item.status !== "TOP_UP_REQUIRED") continue;
    const sourceKey = `ai-provider-billing:${item.provider}:${item.status}:${day}`;
    const message = alertText(item);
    await Promise.allSettled([
      enqueueAiCoreSystemInboxAlert({
        sourceKey,
        eventType: "BILLING_ALERT",
        title: `${item.label} billing · ${item.status === "TOP_UP_REQUIRED" ? "Top up diperlukan" : "Mendekati batas"}`,
        message,
      }),
      sendAdminWhatsappNotification({
        idempotencyKey: sourceKey,
        text: message,
      }),
    ]);
  }
  return snapshot;
}

export function startAiProviderBillingMonitor(env: NodeJS.ProcessEnv = process.env): void {
  if (monitorTimer || monitorKickoff) return;
  if (/^(0|false|no|off)$/i.test((env.AI_PROVIDER_BILLING_MONITOR_ENABLED ?? "").trim())) {
    logger.info("[provider-billing] monitor disabled");
    return;
  }

  const raw = Number(env.AI_PROVIDER_BILLING_MONITOR_INTERVAL_MS ?? 900_000);
  const intervalMs = Math.max(60_000, Number.isFinite(raw) ? raw : 900_000);
  const run = () => {
    void checkAiProviderBillingAlerts(env).catch((error) => {
      logger.warn({ err: error }, "[provider-billing] monitor iteration failed");
    });
  };
  monitorKickoff = setTimeout(() => {
    monitorKickoff = null;
    run();
  }, 15_000);
  monitorKickoff.unref?.();
  monitorTimer = setInterval(run, intervalMs);
  monitorTimer.unref?.();
  logger.info({ intervalMs }, "[provider-billing] monitor started");
}

export function stopAiProviderBillingMonitor(): void {
  if (monitorKickoff) clearTimeout(monitorKickoff);
  if (monitorTimer) clearInterval(monitorTimer);
  monitorKickoff = null;
  monitorTimer = null;
}
