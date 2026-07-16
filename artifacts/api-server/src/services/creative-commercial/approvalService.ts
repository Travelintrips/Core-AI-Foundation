/**
 * creative-commercial/approvalService.ts — Team 03
 *
 * Manages cc_pending_approvals: financial actions that require a manager
 * to approve before execution. All money-mutating commercial automation
 * actions go through this gate.
 *
 * Pattern:
 *   1. Service creates a pending approval (requiresApproval=true)
 *   2. Admin approves/rejects via the route
 *   3. Approval triggers the actual financial action via the event bus
 *   4. Expired approvals (24h default) are auto-rejected on read
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { publishSafe } from "../aiEventBusService.js";
import type { ApprovalActionType, ApprovalStatus, PendingApproval } from "./types.js";

// ── Raw-SQL helpers (team-03 table, not in shared barrel) ─────────────────────

type ApprovalRow = {
  id: number;
  customer_profile_id: number;
  action_type: string;
  action_payload: Record<string, unknown>;
  requested_by: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  expires_at: string;
  created_at: string;
} & Record<string, unknown>;

function mapRow(row: ApprovalRow): PendingApproval {
  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    actionType: row.action_type as ApprovalActionType,
    actionPayload: row.action_payload,
    requestedBy: row.requested_by,
    status: row.status as ApprovalStatus,
    approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
  };
}

export async function createPendingApproval(opts: {
  customerProfileId: number;
  actionType: ApprovalActionType;
  actionPayload: Record<string, unknown>;
  requestedBy: string;
  expiresInHours?: number;
}): Promise<PendingApproval> {
  const expiresInHours = opts.expiresInHours ?? 24;

  const result = await db.execute<ApprovalRow>(sql`
    INSERT INTO ai_platform.cc_pending_approvals
      (customer_profile_id, action_type, action_payload, requested_by, status, expires_at)
    VALUES (
      ${opts.customerProfileId},
      ${opts.actionType},
      ${JSON.stringify(opts.actionPayload)}::jsonb,
      ${opts.requestedBy},
      'pending',
      now() + ${expiresInHours} * interval '1 hour'
    )
    RETURNING *
  `);
  const rows = (result as unknown as { rows: ApprovalRow[] }).rows ?? [];
  return mapRow(rows[0]);
}

export async function approveApproval(
  approvalId: number,
  approvedBy: string,
): Promise<PendingApproval> {
  const approval = await getApproval(approvalId);
  if (!approval) throw new Error(`Approval #${approvalId} not found`);
  if (approval.status !== "pending") throw new Error(`Approval #${approvalId} is already ${approval.status}`);
  if (new Date() > approval.expiresAt) {
    await expireApproval(approvalId);
    throw new Error(`Approval #${approvalId} has expired`);
  }

  const result = await db.execute<ApprovalRow>(sql`
    UPDATE ai_platform.cc_pending_approvals
    SET status = 'approved', approved_by = ${approvedBy}, approved_at = now()
    WHERE id = ${approvalId}
    RETURNING *
  `);
  const rows = (result as unknown as { rows: ApprovalRow[] }).rows ?? [];
  const updated = mapRow(rows[0]);

  // Publish event so downstream systems can execute the action
  publishSafe({
    eventType: "commercial.approval.granted",
    sourceModule: "creative-commercial",
    sourceId: String(approvalId),
    payload: {
      approvalId,
      actionType: updated.actionType,
      actionPayload: updated.actionPayload,
      customerProfileId: updated.customerProfileId,
      approvedBy,
    },
  });

  return updated;
}

export async function rejectApproval(
  approvalId: number,
  rejectedBy: string,
  reason?: string,
): Promise<PendingApproval> {
  const result = await db.execute<ApprovalRow>(sql`
    UPDATE ai_platform.cc_pending_approvals
    SET
      status = 'rejected',
      approved_by = ${rejectedBy},
      approved_at = now(),
      action_payload = action_payload || ${JSON.stringify({ rejectionReason: reason ?? "" })}::jsonb
    WHERE id = ${approvalId} AND status = 'pending'
    RETURNING *
  `);
  const rows = (result as unknown as { rows: ApprovalRow[] }).rows ?? [];
  if (rows.length === 0) throw new Error(`Approval #${approvalId} not found or not pending`);
  return mapRow(rows[0]);
}

export async function getApproval(approvalId: number): Promise<PendingApproval | null> {
  const result = await db.execute<ApprovalRow>(sql`
    SELECT * FROM ai_platform.cc_pending_approvals WHERE id = ${approvalId}
  `);
  const rows = (result as unknown as { rows: ApprovalRow[] }).rows ?? [];
  if (rows.length === 0) return null;

  const approval = mapRow(rows[0]);
  // Auto-expire on read
  if (approval.status === "pending" && new Date() > approval.expiresAt) {
    await expireApproval(approvalId);
    approval.status = "expired";
  }
  return approval;
}

export async function listPendingApprovals(
  customerProfileId?: number,
): Promise<PendingApproval[]> {
  const whereClause = customerProfileId
    ? sql`WHERE customer_profile_id = ${customerProfileId} AND status = 'pending' AND expires_at > now()`
    : sql`WHERE status = 'pending' AND expires_at > now()`;

  const result = await db.execute<ApprovalRow>(sql`
    SELECT * FROM ai_platform.cc_pending_approvals
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT 100
  `);
  return ((result as unknown as { rows: ApprovalRow[] }).rows ?? []).map(mapRow);
}

async function expireApproval(approvalId: number): Promise<void> {
  await db.execute(sql`
    UPDATE ai_platform.cc_pending_approvals
    SET status = 'expired'
    WHERE id = ${approvalId} AND status = 'pending'
  `);
}
