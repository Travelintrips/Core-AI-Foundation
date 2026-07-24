/**
 * providerHealthAlertService — Background poller that checks all providers
 * periodically and sends alerts (email / webhook) when consecutive failures
 * cross a configurable threshold.
 *
 * Settings stored in aiSettingsTable (category: "provider_alerts"):
 *   provider_alert.enabled             — "true" | "false"
 *   provider_alert.failure_threshold   — integer string, e.g. "3"
 *   provider_alert.poll_interval_minutes — integer string, e.g. "5"
 *   provider_alert.email               — comma-separated email addresses
 *   provider_alert.webhook_url         — HTTPS URL to POST alert JSON to
 */

import { eq } from "drizzle-orm";
import { db, aiSettingsTable } from "@workspace/db";
import { runAllHealthChecks } from "./providerHealthService.js";
import { sendEmail } from "./emailService.js";
import { logger } from "../lib/logger.js";
import { validateExternalUrl } from "../middleware/ssrfGuard.js";

// ── Default settings ──────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = [
  {
    key: "provider_alert.enabled",
    value: "true",
    valueType: "boolean",
    category: "provider_alerts",
    description: "Enable automatic provider health alerts",
    isSecret: false,
  },
  {
    key: "provider_alert.failure_threshold",
    value: "3",
    valueType: "number",
    category: "provider_alerts",
    description: "Number of consecutive failures before an alert fires",
    isSecret: false,
  },
  {
    key: "provider_alert.poll_interval_minutes",
    value: "5",
    valueType: "number",
    category: "provider_alerts",
    description: "How often to poll all providers (minutes)",
    isSecret: false,
  },
  {
    key: "provider_alert.email",
    value: "",
    valueType: "string",
    category: "provider_alerts",
    description: "Comma-separated email addresses to notify when a provider goes down",
    isSecret: false,
  },
  {
    key: "provider_alert.webhook_url",
    value: "",
    valueType: "string",
    category: "provider_alerts",
    description: "HTTPS webhook URL to POST alert payloads to",
    isSecret: false,
  },
] as const;

/**
 * Seed default alert settings into the DB (no-op if they already exist).
 * Called at startup.
 */
export async function ensureAlertSettings(): Promise<void> {
  for (const setting of DEFAULT_SETTINGS) {
    const existing = await db
      .select({ key: aiSettingsTable.key })
      .from(aiSettingsTable)
      .where(eq(aiSettingsTable.key, setting.key));

    if (existing.length === 0) {
      await db.insert(aiSettingsTable).values(setting).catch((err) => {
        logger.warn({ err, key: setting.key }, "[health-alerts] Failed to seed default setting");
      });
    }
  }
}

async function getSetting(key: string): Promise<string> {
  const [row] = await db
    .select({ value: aiSettingsTable.value })
    .from(aiSettingsTable)
    .where(eq(aiSettingsTable.key, key));
  return row?.value ?? "";
}

// ── In-memory alert state ─────────────────────────────────────────────────────
// Tracks provider IDs that have already fired an alert so we don't spam.
// Cleared when the provider recovers.

const _alertedProviders = new Set<number>();

// ── Alert delivery ────────────────────────────────────────────────────────────

async function fireAlert(providerId: number, slug: string, consecutiveFailures: number, error: string | null): Promise<void> {
  if (_alertedProviders.has(providerId)) return; // already alerted successfully, don't spam

  logger.warn({ providerId, slug, consecutiveFailures, error }, "[health-alerts] Provider alert threshold reached — attempting delivery");

  const subject = `⚠️ AI Provider Down: ${slug}`;
  const html = `
    <h2>Provider Health Alert</h2>
    <p>The provider <strong>${slug}</strong> has failed <strong>${consecutiveFailures}</strong> consecutive health checks.</p>
    ${error ? `<p><strong>Last error:</strong> <code>${error}</code></p>` : ""}
    <p>Please check the <a href="#">AI Platform dashboard</a> for details.</p>
    <p>This alert will auto-clear when the provider recovers.</p>
  `;

  const emailList = await getSetting("provider_alert.email");
  const webhookUrl = await getSetting("provider_alert.webhook_url");

  // Track whether at least one channel delivered successfully.
  // We only mark this provider as "alerted" if a delivery succeeds so that
  // future poll cycles will retry if no channel is configured yet.
  let delivered = false;

  // Email
  if (emailList.trim()) {
    const addresses = emailList.split(",").map((e) => e.trim()).filter(Boolean);
    for (const to of addresses) {
      const result = await sendEmail({
        to,
        subject,
        html,
        module: "health-alerts",
        action: "provider_alert_sent",
        resourceId: String(providerId),
      });
      if (result.ok) delivered = true;
    }
  }

  // Webhook
  if (webhookUrl.trim()) {
    const guard = validateExternalUrl(webhookUrl);
    if (!guard.valid) {
      logger.warn({ webhookUrl, reason: guard.reason }, "[health-alerts] Webhook URL blocked by SSRF guard");
    } else {
      try {
        const resp = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "provider.down",
            providerId,
            slug,
            consecutiveFailures,
            error,
            timestamp: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok) delivered = true;
      } catch (err) {
        logger.warn({ err, webhookUrl }, "[health-alerts] Webhook delivery failed");
      }
    }
  }

  if (delivered) {
    // At least one channel confirmed delivery — suppress duplicate alerts
    // until the provider recovers (clearAlert will remove from this set).
    _alertedProviders.add(providerId);
    logger.info({ providerId, slug }, "[health-alerts] Alert delivered and suppression activated");
  } else {
    // No channel configured or all deliveries failed — do NOT mark as alerted
    // so the next poll cycle retries when config is fixed or delivery recovers.
    logger.warn({ providerId, slug, emailConfigured: !!emailList.trim(), webhookConfigured: !!webhookUrl.trim() },
      "[health-alerts] Alert delivery failed or no channels configured — will retry next cycle");
  }
}

async function clearAlert(providerId: number, slug: string): Promise<void> {
  if (!_alertedProviders.has(providerId)) return;
  _alertedProviders.delete(providerId);

  logger.info({ providerId, slug }, "[health-alerts] Provider recovered — alert cleared");

  const emailList = await getSetting("provider_alert.email");
  const webhookUrl = await getSetting("provider_alert.webhook_url");

  const subject = `✅ AI Provider Recovered: ${slug}`;
  const html = `
    <h2>Provider Health Recovery</h2>
    <p>The provider <strong>${slug}</strong> has recovered and is responding normally.</p>
  `;

  if (emailList.trim()) {
    const addresses = emailList.split(",").map((e) => e.trim()).filter(Boolean);
    for (const to of addresses) {
      await sendEmail({
        to,
        subject,
        html,
        module: "health-alerts",
        action: "provider_recovery_sent",
        resourceId: String(providerId),
      });
    }
  }

  if (webhookUrl.trim()) {
    try {
      const guard = validateExternalUrl(webhookUrl);
      if (!guard.valid) {
        logger.warn({ webhookUrl, reason: guard.reason }, "[health-alerts] Recovery webhook URL blocked by SSRF guard");
        return;
      }
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "provider.recovered",
          providerId,
          slug,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger.warn({ err, webhookUrl }, "[health-alerts] Recovery webhook delivery failed");
    }
  }
}

// ── Poll cycle ────────────────────────────────────────────────────────────────

async function pollOnce(): Promise<void> {
  const enabled = await getSetting("provider_alert.enabled");
  if (enabled === "false") return;

  const thresholdRaw = await getSetting("provider_alert.failure_threshold");
  const threshold = Math.max(1, parseInt(thresholdRaw, 10) || 3);

  const results = await runAllHealthChecks();

  for (const result of results) {
    if ("notFound" in result) continue;
    const { providerId, slug, consecutiveFailures, pingOk } = result;

    if (consecutiveFailures >= threshold && !pingOk) {
      await fireAlert(providerId, slug, consecutiveFailures, result.error);
    } else if (pingOk && consecutiveFailures === 0) {
      await clearAlert(providerId, slug);
    }
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let _pollTimer: NodeJS.Timeout | null = null;
let _running = false;

export async function start(): Promise<void> {
  if (_running) {
    logger.warn("[health-alerts] Already running — ignoring start()");
    return;
  }
  _running = true;

  await ensureAlertSettings();

  const schedule = async () => {
    const intervalRaw = await getSetting("provider_alert.poll_interval_minutes");
    const intervalMinutes = Math.max(1, parseInt(intervalRaw, 10) || 5);
    const intervalMs = intervalMinutes * 60_000;

    try {
      await pollOnce();
    } catch (err) {
      logger.error({ err }, "[health-alerts] Poll cycle error");
    }

    if (_running) {
      _pollTimer = setTimeout(schedule, intervalMs);
    }
  };

  // Start the first poll after a short boot delay so the server is fully up
  _pollTimer = setTimeout(schedule, 30_000);
  logger.info("[health-alerts] Provider health alert poller started (first poll in 30s)");
}

export function shutdown(): void {
  _running = false;
  if (_pollTimer) {
    clearTimeout(_pollTimer);
    _pollTimer = null;
  }
  logger.info("[health-alerts] Provider health alert poller stopped");
}

export function getAlertedProviders(): number[] {
  return [..._alertedProviders];
}
