import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { logAudit } from "./aiAuditService.js";
import {
  sendCodingApprovalRequest,
  sendCodingApprovalResult,
} from "./codingWhatsappNotificationService.js";
import { ensureCodingControlBridgeTables } from "./codingControlBridgeSchemaService.js";

export type CriticalApprovalActionType =
  | "WORKSTREAM_AI_HANDOFF"
  | "MERGE_PR"
  | "PRODUCTION_DEPLOY"
  | "PRODUCTION_DB_MIGRATION"
  | "DESTRUCTIVE_DB_CHANGE"
  | "SECURITY_CHANGE"
  | "PRODUCTION_SERVICE_RESTART";

export type CriticalApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED";

const HUMAN_APPROVAL_ACTIONS = new Set<CriticalApprovalActionType>([
  "PRODUCTION_DB_MIGRATION",
  "DESTRUCTIVE_DB_CHANGE",
  "SECURITY_CHANGE",
]);

export function requiresHumanCriticalApproval(
  actionType: CriticalApprovalActionType,
): boolean {
  return HUMAN_APPROVAL_ACTIONS.has(actionType);
}

export interface CriticalApprovalRow {
  id: string;
  taskId: string | null;
  commandId: string | null;
  actionType: CriticalApprovalActionType;
  actionDigest: string;
  summary: string;
  metadata: Record<string, unknown>;
  status: CriticalApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBySuffix: string | null;
  executionStartedAt: string | null;
  executionError: string | null;
}

export interface ApprovalCommand {
  decision: "APPROVE" | "REJECT";
  token: string;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function actionDigest(input: {
  taskId: string | null;
  actionType: CriticalApprovalActionType;
  metadata: Record<string, unknown>;
}): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      taskId: input.taskId,
      actionType: input.actionType,
      metadata: input.metadata,
    }))
    .digest("hex");
}

function normalizeRow(row: Record<string, unknown>): CriticalApprovalRow {
  return {
    id: String(row["id"]),
    taskId: typeof row["task_id"] === "string" ? row["task_id"] : null,
    commandId: typeof row["command_id"] === "string" ? row["command_id"] : null,
    actionType: String(row["action_type"]) as CriticalApprovalActionType,
    actionDigest: String(row["action_digest"]),
    summary: String(row["summary"]),
    metadata:
      row["metadata_json"] && typeof row["metadata_json"] === "object"
        ? (row["metadata_json"] as Record<string, unknown>)
        : {},
    status: String(row["status"]) as CriticalApprovalStatus,
    requestedAt: new Date(String(row["requested_at"])).toISOString(),
    expiresAt: new Date(String(row["expires_at"])).toISOString(),
    decidedAt: row["decided_at"] ? new Date(String(row["decided_at"])).toISOString() : null,
    decidedBySuffix:
      typeof row["decided_by_suffix"] === "string"
        ? row["decided_by_suffix"]
        : null,
    executionStartedAt: row["execution_started_at"]
      ? new Date(String(row["execution_started_at"])).toISOString()
      : null,
    executionError:
      typeof row["execution_error"] === "string" ? row["execution_error"] : null,
  };
}

export function parseCriticalApprovalCommand(text: string): ApprovalCommand | null {
  const match = text
    .trim()
    .match(/^(APPROVE|REJECT|SETUJUI|TOLAK)\s+([A-Za-z0-9_-]{12,80})$/i);
  if (!match) return null;
  const verb = match[1]!.toUpperCase();
  return {
    decision: verb === "APPROVE" || verb === "SETUJUI" ? "APPROVE" : "REJECT",
    token: match[2]!,
  };
}

async function expireStaleApprovals(): Promise<void> {
  await db.execute(sql`
    UPDATE ai_platform.ai_coding_critical_approvals
    SET status = 'EXPIRED'
    WHERE status = 'PENDING' AND expires_at <= NOW()
  `);
}

async function loadByToken(token: string): Promise<CriticalApprovalRow | null> {
  const result = await db.execute(sql`
    SELECT *
    FROM ai_platform.ai_coding_critical_approvals
    WHERE token_hash = ${hashToken(token)}
    LIMIT 1
  `);
  if (!Array.isArray(result.rows) || result.rows.length === 0) return null;
  return normalizeRow(result.rows[0] as Record<string, unknown>);
}

export async function requestCodingCriticalApproval(input: {
  taskId?: string | null;
  commandId?: string | null;
  actionType: CriticalApprovalActionType;
  summary: string;
  metadata?: Record<string, unknown>;
  ttlMinutes?: number;
}): Promise<{ approval: CriticalApprovalRow; token?: string; reused: boolean }> {
  if (!requiresHumanCriticalApproval(input.actionType)) {
    throw new Error(
      `NON_CRITICAL_ACTION_MUST_AUTO_ADVANCE:${input.actionType}`,
    );
  }

  await ensureCodingControlBridgeTables();
  await expireStaleApprovals();

  const taskId = input.taskId ?? null;
  const commandId = input.commandId ?? null;
  const metadata = input.metadata ?? {};
  const digest = actionDigest({
    taskId,
    actionType: input.actionType,
    metadata,
  });

  const existing = await db.execute(sql`
    SELECT *
    FROM ai_platform.ai_coding_critical_approvals
    WHERE action_digest = ${digest}
      AND status IN ('PENDING','APPROVED','EXECUTING')
      AND expires_at > NOW()
    ORDER BY requested_at DESC
    LIMIT 1
  `);
  if (Array.isArray(existing.rows) && existing.rows.length > 0) {
    return {
      approval: normalizeRow(existing.rows[0] as Record<string, unknown>),
      reused: true,
    };
  }

  const id = crypto.randomUUID();
  const token = crypto.randomBytes(18).toString("base64url");
  const ttlMinutes = Math.max(2, Math.min(30, Math.floor(input.ttlMinutes ?? 10)));
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  await db.execute(sql`
    INSERT INTO ai_platform.ai_coding_critical_approvals (
      id, task_id, command_id, action_type, action_digest, token_hash,
      summary, metadata_json, status, expires_at
    )
    VALUES (
      ${id}::uuid,
      ${taskId}::uuid,
      ${commandId}::uuid,
      ${input.actionType},
      ${digest},
      ${hashToken(token)},
      ${input.summary.trim().slice(0, 4000)},
      ${JSON.stringify(metadata)}::jsonb,
      'PENDING',
      ${expiresAt.toISOString()}::timestamptz
    )
  `);

  const approval = await getCriticalApproval(id);
  if (!approval) throw new Error("Critical approval could not be persisted");

  const notify = await sendCodingApprovalRequest({
    approvalId: id,
    taskId,
    actionType: input.actionType,
    summary: approval.summary,
    token,
    expiresAt: approval.expiresAt,
  });

  await logAudit(
    "coding-orchestrator",
    "critical_approval_requested",
    id,
    "coding_critical_approval",
    notify.status === "queued" ? "success" : "failure",
    {
      taskId,
      actionType: input.actionType,
      digest,
      expiresAt: approval.expiresAt,
      notificationStatus: notify.status,
    },
  ).catch(() => undefined);

  return { approval, token, reused: false };
}

export async function getCriticalApproval(id: string): Promise<CriticalApprovalRow | null> {
  await ensureCodingControlBridgeTables();
  await expireStaleApprovals();
  const result = await db.execute(sql`
    SELECT *
    FROM ai_platform.ai_coding_critical_approvals
    WHERE id = ${id}::uuid
    LIMIT 1
  `);
  if (!Array.isArray(result.rows) || result.rows.length === 0) return null;
  return normalizeRow(result.rows[0] as Record<string, unknown>);
}

function requiredMetadataString(
  approval: CriticalApprovalRow,
  key: string,
): string {
  const value = approval.metadata[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Critical approval metadata is missing ${key}`);
  }
  return value.trim();
}

async function executeApprovedAction(approval: CriticalApprovalRow): Promise<void> {
  if (!approval.taskId) {
    throw new Error("Critical approval does not have a coding task id");
  }

  switch (approval.actionType) {
    case "WORKSTREAM_AI_HANDOFF": {
      const workstreamId = requiredMetadataString(approval, "workstreamId");
      const handoffId = requiredMetadataString(approval, "handoffId");
      const expectedPackageHash = requiredMetadataString(
        approval,
        "packageHash",
      ).toLowerCase();

      const {
        approveWorkstreamAiExecutionHandoff,
        enqueueWorkstreamAiExecution,
      } = await import("./localCodingWorkstreamAiExecutionService.js");

      const lease = await approveWorkstreamAiExecutionHandoff(
        workstreamId,
        handoffId,
      );
      if (lease.packageHash.toLowerCase() !== expectedPackageHash) {
        throw new Error(
          "Approved workstream AI handoff package hash changed before execution.",
        );
      }

      await enqueueWorkstreamAiExecution(workstreamId, {
        expectedPackageHash: lease.packageHash,
        requestedBy: `admin-approval:${approval.id}`,
      });
      return;
    }
    case "MERGE_PR": {
      const { approveAndMergePullRequest } = await import(
        "./localCodingPullRequestGateService.js"
      );
      await approveAndMergePullRequest(approval.taskId);
      return;
    }
    default:
      throw new Error(
        `Critical action ${approval.actionType} is gated but does not yet have an execution adapter.`,
      );
  }
}

async function decideLoadedCriticalApproval(
  current: CriticalApprovalRow,
  decision: "APPROVE" | "REJECT",
  actorSuffix: string | null,
): Promise<CriticalApprovalRow> {
  if (current.status === "EXPIRED") throw new Error("APPROVAL_EXPIRED");
  if (current.status !== "PENDING") throw new Error("APPROVAL_NOT_PENDING");

  const nextStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";

  const updated = await db.execute(sql`
    UPDATE ai_platform.ai_coding_critical_approvals
    SET status = ${nextStatus},
        decided_at = NOW(),
        decided_by_suffix = ${actorSuffix}
    WHERE id = ${current.id}::uuid
      AND status = 'PENDING'
      AND expires_at > NOW()
    RETURNING *
  `);
  if (!Array.isArray(updated.rows) || updated.rows.length === 0) {
    throw new Error("APPROVAL_RACE_LOST");
  }

  let approval = normalizeRow(updated.rows[0] as Record<string, unknown>);

  await logAudit(
    "coding-orchestrator",
    decision === "APPROVE"
      ? "critical_approval_approved"
      : "critical_approval_rejected",
    approval.id,
    "coding_critical_approval",
    "success",
    {
      taskId: approval.taskId,
      actionType: approval.actionType,
      actorSuffix,
    },
  ).catch(() => undefined);

  if (decision === "REJECT") {
    await sendCodingApprovalResult({
      approvalId: approval.id,
      taskId: approval.taskId,
      status: "REJECTED",
      actionType: approval.actionType,
      message: "Aksi dibatalkan. AI Core tidak mengeksekusi perubahan krusial tersebut.",
    });
    return approval;
  }

  await db.execute(sql`
    UPDATE ai_platform.ai_coding_critical_approvals
    SET status = 'EXECUTING',
        execution_started_at = NOW()
    WHERE id = ${approval.id}::uuid
  `);
  approval = (await getCriticalApproval(approval.id)) ?? approval;

  try {
    await executeApprovedAction(approval);
    await sendCodingApprovalResult({
      approvalId: approval.id,
      taskId: approval.taskId,
      status: "EXECUTING",
      actionType: approval.actionType,
      message: "Persetujuan diterima. AI Core telah melanjutkan aksi dan akan memverifikasi hasilnya.",
    });
    return approval;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.execute(sql`
      UPDATE ai_platform.ai_coding_critical_approvals
      SET status = 'FAILED',
          execution_error = ${message.slice(0, 2000)}
      WHERE id = ${approval.id}::uuid
    `).catch(() => undefined);

    logger.warn(
      { err: error, approvalId: approval.id, actionType: approval.actionType },
      "[coding-approval] approved action failed to start",
    );

    await sendCodingApprovalResult({
      approvalId: approval.id,
      taskId: approval.taskId,
      status: "FAILED",
      actionType: approval.actionType,
      message: message.slice(0, 1200),
    });
    throw error;
  }
}

export async function decideCodingCriticalApproval(input: {
  token: string;
  decision: "APPROVE" | "REJECT";
  senderDigits: string;
}): Promise<CriticalApprovalRow> {
  await ensureCodingControlBridgeTables();
  await expireStaleApprovals();

  const current = await loadByToken(input.token);
  if (!current) throw new Error("APPROVAL_NOT_FOUND");

  const suffix = input.senderDigits.replace(/\D/g, "").slice(-4) || null;
  return decideLoadedCriticalApproval(current, input.decision, suffix);
}

export async function decideCodingCriticalApprovalById(input: {
  approvalId: string;
  decision: "APPROVE" | "REJECT";
  actor?: string | null;
}): Promise<CriticalApprovalRow> {
  await ensureCodingControlBridgeTables();
  await expireStaleApprovals();

  const current = await getCriticalApproval(input.approvalId);
  if (!current) throw new Error("APPROVAL_NOT_FOUND");

  const suffix =
    typeof input.actor === "string" && input.actor.trim()
      ? input.actor.replace(/\s+/g, "-").slice(-32)
      : "admin-api";

  return decideLoadedCriticalApproval(current, input.decision, suffix);
}

export async function finalizeCodingCriticalApproval(input: {
  taskId: string;
  actionType: CriticalApprovalActionType;
  status: "COMPLETED" | "FAILED";
  message: string;
}): Promise<CriticalApprovalRow | null> {
  await ensureCodingControlBridgeTables();

  const result = await db.execute(sql`
    UPDATE ai_platform.ai_coding_critical_approvals
    SET status = ${input.status},
        execution_error = CASE
          WHEN ${input.status} = 'FAILED' THEN ${input.message.slice(0, 2000)}
          ELSE NULL
        END
    WHERE id = (
      SELECT id
      FROM ai_platform.ai_coding_critical_approvals
      WHERE task_id = ${input.taskId}::uuid
        AND action_type = ${input.actionType}
        AND status IN ('APPROVED','EXECUTING')
      ORDER BY requested_at DESC
      LIMIT 1
    )
    RETURNING *
  `);

  if (!Array.isArray(result.rows) || result.rows.length === 0) return null;
  const approval = normalizeRow(result.rows[0] as Record<string, unknown>);

  await sendCodingApprovalResult({
    approvalId: approval.id,
    taskId: approval.taskId,
    status: input.status,
    actionType: approval.actionType,
    message: input.message,
  }).catch(() => undefined);

  await logAudit(
    "coding-orchestrator",
    input.status === "COMPLETED"
      ? "critical_approval_action_completed"
      : "critical_approval_action_failed",
    approval.id,
    "coding_critical_approval",
    input.status === "COMPLETED" ? "success" : "failure",
    {
      taskId: approval.taskId,
      actionType: approval.actionType,
      message: input.message.slice(0, 700),
    },
  ).catch(() => undefined);

  return approval;
}
