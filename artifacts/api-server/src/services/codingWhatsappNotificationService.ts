import { createHash } from "node:crypto";
import { logger } from "../lib/logger.js";

type CodingBridgeKind =
  | "ACK"
  | "PROGRESS"
  | "CHECKPOINT"
  | "BLOCKER"
  | "COMPLETED"
  | "FAILED";

const NOTIFIABLE_KINDS = new Set<CodingBridgeKind>([
  "CHECKPOINT",
  "BLOCKER",
  "COMPLETED",
  "FAILED",
]);

function config() {
  const baseUrl = (process.env.CST_WA_GATEWAY_URL ?? "").trim().replace(/\/$/, "");
  const apiKey = (process.env.CST_WA_GATEWAY_API_KEY ?? "").trim();
  const to = (process.env.AI_CODING_WA_NOTIFY_TO ?? "").trim();
  return { baseUrl, apiKey, to };
}

export type CodingWhatsappNotifyResult =
  | { status: "skipped"; reason: "kind_not_notifiable" | "missing_config"; configured: { baseUrl: boolean; apiKey: boolean; to: boolean } }
  | { status: "queued"; gatewayStatus: number }
  | { status: "rejected"; gatewayStatus: number; body: string }
  | { status: "failed"; error: string };

async function sendGatewayMessage(input: {
  idempotencyKey: string;
  clientMessageId: string;
  text: string;
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
      body: JSON.stringify({
        to,
        text: input.text,
        clientMessageId: input.clientMessageId,
      }),
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

    return { status: "queued", gatewayStatus: response.status };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getCodingWhatsappConfigStatus() {
  const { baseUrl, apiKey, to } = config();
  return {
    baseUrl: Boolean(baseUrl),
    apiKey: Boolean(apiKey),
    to: Boolean(to),
  };
}

export async function notifyCodingBridgeResponse(input: {
  responseId: string;
  commandId: string;
  taskId?: string | null;
  kind: CodingBridgeKind;
  message: string;
}): Promise<CodingWhatsappNotifyResult> {
  const configured = getCodingWhatsappConfigStatus();
  if (!NOTIFIABLE_KINDS.has(input.kind)) {
    return { status: "skipped", reason: "kind_not_notifiable", configured };
  }

  const taskLine = input.taskId ? `Task: ${input.taskId}\n` : "";
  const text = [
    "AI Core Coding Update",
    `Status: ${input.kind}`,
    taskLine.trimEnd(),
    input.message.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  const result = await sendGatewayMessage({
    idempotencyKey: `ai-core-coding-${input.responseId}`,
    clientMessageId: input.responseId,
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
  const text = [
    "AI Core - APPROVAL REQUIRED",
    input.taskId ? `Task: ${input.taskId}` : "",
    `Action: ${input.actionType}`,
    input.summary.trim(),
    `Berlaku sampai: ${input.expiresAt}`,
    "",
    `Balas: APPROVE ${input.token}`,
    `atau: REJECT ${input.token}`,
  ].filter(Boolean).join("\n");

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
  const text = [
    "AI Core - Approval Update",
    input.taskId ? `Task: ${input.taskId}` : "",
    `Action: ${input.actionType}`,
    `Status: ${input.status}`,
    input.message.trim(),
  ].filter(Boolean).join("\n");

  return sendGatewayMessage({
    idempotencyKey: `ai-core-approval-result-${input.approvalId}-${input.status}`,
    clientMessageId: `${input.approvalId}-${input.status.toLowerCase()}`,
    text,
  });
}


export async function sendCodingTaskStatusNotification(input: {
  taskId: string;
  taskNumber?: string | null;
  projectName?: string | null;
  repository?: string | null;
  branch?: string | null;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  message: string;
  changedFiles?: string[];
  verificationStatus?: string | null;
}): Promise<CodingWhatsappNotifyResult> {
  const text = [
    input.status === "COMPLETED"
      ? "✅ AI Core Coding Selesai"
      : input.status === "FAILED"
        ? "❌ AI Core Coding Gagal"
        : "🤖 AI Core Coding Berjalan",
    input.projectName ? `Project: ${input.projectName}` : "",
    input.taskNumber ? `Task: ${input.taskNumber}` : `Task ID: ${input.taskId}`,
    input.repository ? `Repository: ${input.repository}` : "",
    input.branch ? `Branch: ${input.branch}` : "",
    `Status: ${input.status}`,
    input.verificationStatus
      ? `Verification: ${input.verificationStatus}`
      : "",
    input.changedFiles?.length
      ? `File berubah: ${input.changedFiles.length}\n${input.changedFiles
          .slice(0, 8)
          .map((file) => `- ${file}`)
          .join("\n")}`
      : "",
    input.message.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  return sendGatewayMessage({
    idempotencyKey: `ai-core-task-${input.taskId}-${input.status.toLowerCase()}-${createHash("sha256").update(text).digest("hex").slice(0, 12)}`,
    clientMessageId: `coding-${input.taskId}-${input.status.toLowerCase()}-${Date.now()}`,
    text,
  });
}
