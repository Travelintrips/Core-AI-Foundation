import { eq, sql } from "drizzle-orm";
import { aiCodingTasksTable, db } from "@workspace/db";
import { logger } from "../lib/logger.js";

type CodingBridgeKind =
  | "ACK"
  | "PROGRESS"
  | "CHECKPOINT"
  | "BLOCKER"
  | "COMPLETED"
  | "FAILED";

// WhatsApp admin is reserved for critical human-review requests only.
const LIFECYCLE_NOTIFICATIONS_ENABLED = false;
const NOTIFIABLE_KINDS = new Set<CodingBridgeKind>([
  "CHECKPOINT",
  "BLOCKER",
  "COMPLETED",
  "FAILED",
]);

type CodingLifecycleStatus =
  | "CHECKPOINT"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "MERGED"
  | "DEPLOYED";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function lifecycleStatus(input: {
  kind: CodingBridgeKind;
  message: string;
  checkpoint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): CodingLifecycleStatus {
  const checkpoint = isRecord(input.checkpoint) ? input.checkpoint : {};
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  for (const value of [checkpoint["eventType"], metadata["eventType"]]) {
    if (
      typeof value === "string" &&
      ["COMPLETED", "FAILED", "BLOCKED", "MERGED", "DEPLOYED"].includes(value)
    ) {
      return value as CodingLifecycleStatus;
    }
  }

  if (input.kind === "BLOCKER") return "BLOCKED";
  if (input.kind === "FAILED") return "FAILED";
  if (input.kind === "CHECKPOINT") return "CHECKPOINT";

  const haystack = `${input.message} ${JSON.stringify(checkpoint)} ${JSON.stringify(metadata)}`.toLowerCase();
  if (/\bdeploy(?:ed|ment)?\b/.test(haystack) && /(success|succeed|completed|selesai|deployed)/.test(haystack)) {
    return "DEPLOYED";
  }
  if (/\bmerge(?:d)?\b/.test(haystack)) return "MERGED";
  return "COMPLETED";
}

async function taskNotificationDetails(taskId: string | null | undefined) {
  if (!taskId) return null;
  const [task] = await db
    .select({
      taskNumber: aiCodingTasksTable.taskNumber,
      projectName: aiCodingTasksTable.projectName,
      repository: aiCodingTasksTable.repository,
      branch: aiCodingTasksTable.branch,
      resultSummary: aiCodingTasksTable.resultSummary,
    })
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId))
    .limit(1)
    .catch(() => []);
  return task ?? null;
}

function config() {
  const baseUrl = (process.env.CST_WA_GATEWAY_URL ?? "").trim().replace(/\/$/, "");
  const apiKey = (process.env.CST_WA_GATEWAY_API_KEY ?? "").trim();
  const to = (process.env.AI_CODING_WA_NOTIFY_TO ?? "").trim();
  return { baseUrl, apiKey, to };
}

function formatJakartaTimestamp(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(safe);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} WIB`;
}

async function findDeliveredLifecycleDuplicate(input: {
  responseId: string;
  taskId?: string | null;
  status: CodingLifecycleStatus;
}): Promise<{ responseId: string; messageId: string | null } | null> {
  if (!input.taskId || input.status === "CHECKPOINT") return null;

  const result = await db.execute(sql`
    SELECT
      id,
      metadata_json #>> '{whatsappNotification,delivery,messageId}' AS message_id
    FROM ai_platform.ai_coding_bridge_responses
    WHERE task_id = ${input.taskId}::uuid
      AND id <> ${input.responseId}::uuid
      AND metadata_json #>> '{whatsappNotification,delivery,status}' = 'sent'
      AND COALESCE(
        NULLIF(checkpoint_json ->> 'eventType', ''),
        NULLIF(metadata_json ->> 'eventType', ''),
        CASE kind
          WHEN 'BLOCKER' THEN 'BLOCKED'
          WHEN 'FAILED' THEN 'FAILED'
          WHEN 'COMPLETED' THEN 'COMPLETED'
          ELSE kind::text
        END
      ) = ${input.status}::text
    ORDER BY created_at ASC
    LIMIT 1
  `);

  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    responseId: String(row["id"]),
    messageId:
      typeof row["message_id"] === "string" ? row["message_id"] : null,
  };
}

function approvalWebConfig() {
  const publicBaseUrl = (
    process.env.AI_CORE_PUBLIC_API_URL ??
    process.env.PUBLIC_APP_URL ??
    "https://aicore.cstlogistic.co.id"
  ).trim().replace(/\/$/, "");
  return { publicBaseUrl };
}

function buildApprovalWebLink(token: string): string | null {
  const { publicBaseUrl } = approvalWebConfig();
  if (!publicBaseUrl) return null;
  return `${publicBaseUrl}/api/a/${encodeURIComponent(token)}`;
}
function friendlyApprovalAction(actionType: string): string {
  switch (actionType) {
    case "WORKSTREAM_AI_HANDOFF":
      return "Serahkan eksekusi workstream ke AI";
    case "MERGE_PR":
      return "Merge perubahan ke branch utama";
    case "PRODUCTION_DEPLOY":
      return "Deploy ke production";
    case "PRODUCTION_DB_MIGRATION":
      return "Migrasi database production";
    case "DESTRUCTIVE_DB_CHANGE":
      return "Perubahan database yang bisa mengubah / menghapus data";
    case "SECURITY_CHANGE":
      return "Perubahan keamanan atau hak akses";
    case "PRODUCTION_SERVICE_RESTART":
      return "Restart service production";
    default:
      return actionType.replace(/_/g, " ").toLowerCase();
  }
}


export type CodingWhatsappNotifyResult =
  | {
      status: "skipped";
      reason:
        | "kind_not_notifiable"
        | "human_review_only_policy"
        | "approval_result_notifications_disabled"
        | "missing_config"
        | "duplicate_lifecycle_notification";
      configured: { baseUrl: boolean; apiKey: boolean; to: boolean };
      duplicateOfResponseId?: string;
      duplicateMessageId?: string | null;
    }
  | { status: "queued"; gatewayStatus: number; messageId: string | null }
  | { status: "rejected"; gatewayStatus: number; body: string }
  | { status: "failed"; error: string };

async function sendGatewayMessage(input: {
  idempotencyKey: string;
  clientMessageId: string;
  text: string;
  buttons?: Array<{ id: string; label: string }>;
  footer?: string;
}): Promise<CodingWhatsappNotifyResult> {
  const configured = getCodingWhatsappConfigStatus();
  const { baseUrl, apiKey, to } = config();
  if (!baseUrl || !apiKey || !to) {
    return { status: "skipped", reason: "missing_config", configured };
  }

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify(
        input.buttons?.length
          ? {
              type: "buttons",
              to,
              text: input.text,
              ...(input.footer ? { footer: input.footer } : {}),
              buttons: input.buttons,
              clientMessageId: input.clientMessageId,
            }
          : {
              type: "text",
              to,
              text: input.text,
              clientMessageId: input.clientMessageId,
            },
      ),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        status: "rejected",
        gatewayStatus: response.status,
        body: body.slice(0, 500),
      };
    }

    const body = await response.json().catch(() => null) as { messageId?: unknown } | null;
    return {
      status: "queued",
      gatewayStatus: response.status,
      messageId: typeof body?.messageId === "string" ? body.messageId : null,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type CodingWhatsappDeliveryResult =
  | { status: "sent"; messageId: string; gatewayStatus: number; sentAt?: string; waMessageId?: string | null }
  | { status: "failed"; messageId: string; reason: string; attemptsMade?: number }
  | { status: "timeout"; messageId: string; lastStatus: string | null; lastReason?: string | null }
  | { status: "unavailable"; reason: string };

export async function waitForCodingWhatsappDelivery(
  messageId: string | null,
  options?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<CodingWhatsappDeliveryResult> {
  if (!messageId) {
    return { status: "unavailable", reason: "Gateway did not return a messageId." };
  }

  const { baseUrl, apiKey } = config();
  if (!baseUrl || !apiKey) {
    return { status: "unavailable", reason: "WhatsApp gateway configuration is incomplete." };
  }

  const timeoutMs = Math.max(1_000, Math.min(options?.timeoutMs ?? 30_000, 120_000));
  const pollIntervalMs = Math.max(250, Math.min(options?.pollIntervalMs ?? 1_000, 5_000));
  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | null = null;
  let lastReason: string | null = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/v1/messages/${encodeURIComponent(messageId)}`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        const body = await response.json().catch(() => null) as {
          status?: unknown;
          sentAt?: unknown;
          waMessageId?: unknown;
          failedReason?: unknown;
          error?: unknown;
          attemptsMade?: unknown;
        } | null;

        lastStatus = typeof body?.status === "string" ? body.status : null;
        lastReason =
          typeof body?.failedReason === "string"
            ? body.failedReason
            : typeof body?.error === "string"
              ? body.error
              : lastReason;
        if (lastStatus === "sent") {
          return {
            status: "sent",
            messageId,
            gatewayStatus: response.status,
            ...(typeof body?.sentAt === "string" ? { sentAt: body.sentAt } : {}),
            waMessageId:
              typeof body?.waMessageId === "string" || body?.waMessageId === null
                ? body.waMessageId
                : null,
          };
        }
        if (lastStatus === "failed") {
          return {
            status: "failed",
            messageId,
            reason:
              typeof body?.failedReason === "string"
                ? body.failedReason
                : typeof body?.error === "string"
                  ? body.error
                  : "WhatsApp worker reported a failed send.",
            ...(typeof body?.attemptsMade === "number"
              ? { attemptsMade: body.attemptsMade }
              : {}),
          };
        }
      }
    } catch (error) {
      logger.warn(
        { messageId, err: error },
        "[coding-wa] delivery status poll failed",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { status: "timeout", messageId, lastStatus, lastReason };
}

export function getCodingWhatsappConfigStatus() {
  const { baseUrl, apiKey, to } = config();
  return {
    baseUrl: Boolean(baseUrl),
    apiKey: Boolean(apiKey),
    to: Boolean(to),
  };
}

export async function sendAdminWhatsappNotification(input: {
  idempotencyKey: string;
  text: string;
}): Promise<CodingWhatsappNotifyResult> {
  return sendGatewayMessage({
    idempotencyKey: input.idempotencyKey.trim(),
    clientMessageId: input.idempotencyKey.trim(),
    text: input.text.trim(),
  });
}

export async function notifyCodingBridgeResponse(input: {
  responseId: string;
  commandId: string;
  taskId?: string | null;
  kind: CodingBridgeKind;
  message: string;
  checkpoint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  eventTimestamp?: string | Date | null;
}): Promise<CodingWhatsappNotifyResult> {
  const configured = getCodingWhatsappConfigStatus();
  if (!LIFECYCLE_NOTIFICATIONS_ENABLED) {
    return {
      status: "skipped",
      reason: "human_review_only_policy",
      configured,
    };
  }
  if (!NOTIFIABLE_KINDS.has(input.kind)) {
    return { status: "skipped", reason: "kind_not_notifiable", configured };
  }

  const status = lifecycleStatus(input);
  const duplicate = await findDeliveredLifecycleDuplicate({
    responseId: input.responseId,
    taskId: input.taskId,
    status,
  });
  if (duplicate) {
    return {
      status: "skipped",
      reason: "duplicate_lifecycle_notification",
      configured,
      duplicateOfResponseId: duplicate.responseId,
      duplicateMessageId: duplicate.messageId,
    };
  }

  const task = await taskNotificationDetails(input.taskId);
  const { publicBaseUrl } = approvalWebConfig();
  const workspaceUrl =
    input.taskId && publicBaseUrl
      ? `${publicBaseUrl}/coding-workspace/${encodeURIComponent(input.taskId)}`
      : null;
  const text = [
    status === "CHECKPOINT" ? "AI Core Coding Update" : "AI Core Task Report",
    `Status: ${status}`,
    task?.taskNumber
      ? `Task: ${task.taskNumber}`
      : input.taskId
        ? `Task: ${input.taskId}`
        : "",
    task?.projectName ? `Project: ${task.projectName}` : "",
    task?.repository ? `Repository: ${task.repository}` : "",
    task?.branch ? `Branch: ${task.branch}` : "",
    `Timestamp: ${formatJakartaTimestamp(input.eventTimestamp)}`,
    "",
    input.message.trim() || task?.resultSummary?.trim() || "",
    task?.resultSummary && task.resultSummary.trim() !== input.message.trim()
      ? `Ringkasan: ${task.resultSummary.trim()}`
      : "",
    workspaceUrl ? `Workspace: ${workspaceUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const stableLifecycleKey =
    input.taskId && status !== "CHECKPOINT"
      ? `ai-core-coding-${input.taskId}-${status.toLowerCase()}`
      : `ai-core-coding-${input.responseId}`;

  const result = await sendGatewayMessage({
    idempotencyKey: stableLifecycleKey,
    clientMessageId: stableLifecycleKey,
    text,
  });

  if (result.status === "queued") {
    logger.info(
      {
        responseId: input.responseId,
        commandId: input.commandId,
        kind: input.kind,
      },
      "[coding-wa] coding notification queued",
    );
  } else if (result.status !== "skipped") {
    logger.warn(
      {
        result,
        responseId: input.responseId,
        commandId: input.commandId,
      },
      "[coding-wa] coding notification not queued",
    );
  }
  return result;
}


export async function sendCodingApprovalRequest(input: {
  approvalId: string;
  taskId: string | null;
  actionType: string;
  summary: string;
  token: string;
  expiresAt: string;
}): Promise<CodingWhatsappNotifyResult> {
  const approvalLink = buildApprovalWebLink(input.token);
  const task = await taskNotificationDetails(input.taskId);

  const text = [
    "🚨 Min, butuh keputusan dulu nih.",
    "Job ini masuk kategori kritis, jadi AI Core sengaja ngerem sebelum lanjut.",
    "",
    task?.taskNumber
      ? `Task: ${task.taskNumber}`
      : input.taskId
        ? `Task: ${input.taskId}`
        : "",
    task?.projectName ? `Project: ${task.projectName}` : "",
    `Yang mau dijalanin: ${friendlyApprovalAction(input.actionType)}`,
    `Kenapa perlu dicek: ${input.summary.trim()}`,
    `Batas keputusan: ${formatJakartaTimestamp(input.expiresAt)}`,
    "",
    "Kalau aman, pilih APPROVE. Kalau mau dibatalin atau masih ragu, pilih REJECT.",
    approvalLink ? `👉 Buka approval: ${approvalLink}` : "",
  ].filter(Boolean).join("\n");

  // Keep approval messages as plain text with a short signed HTTPS page. Some
  // WhatsApp clients render native-flow buttons as an undecryptable placeholder.
  return sendGatewayMessage({
    idempotencyKey: `ai-core-approval-${input.approvalId}`,
    clientMessageId: input.approvalId,
    text,
  });
}

export async function sendCodingApprovalResult(input: {
  approvalId: string;
  taskId: string | null;
  actionType: string;
  status: "REJECTED" | "EXECUTING" | "COMPLETED" | "FAILED";
  message: string;
}): Promise<CodingWhatsappNotifyResult> {
  void input;
  return {
    status: "skipped",
    reason: "approval_result_notifications_disabled",
    configured: getCodingWhatsappConfigStatus(),
  };
}
