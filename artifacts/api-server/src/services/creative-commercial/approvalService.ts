/**
 * creative-commercial/approvalService.ts — Team 03
 *
 * ADAPTER over ai_commercial_gates (existing system).
 *
 * Audit remediation (P1 — Duplicate Approval Flow):
 *   - REMOVED parallel cc_pending_approvals state machine.
 *   - NOW backed by ai_commercial_gates with gate_type='admin_approval'.
 *   - Uses existing verifyGate() / failGate() from commercialGateService.
 *   - Idempotent: requesting the same (customerProfileId, actionType) twice
 *     returns the existing pending gate, not a new one.
 *   - Approved gates cannot be re-approved (verifyGate guards pending→verified).
 *   - Notes JSON stores: {actionType, actionPayload, requestedBy, customerProfileId, source}.
 *
 * Status mapping:
 *   ai_commercial_gates.status  →  PendingApproval.status
 *   pending                     →  pending
 *   verified                    →  approved
 *   failed                      →  rejected
 *   waived                      →  rejected  (waive = admin override rejection)
 *
 * Events published (on approval):
 *   commercial.approval.granted — payload includes gateId, actionType, actionPayload,
 *   customerProfileId, approvedBy. Downstream handlers execute the actual action.
 *
 * Gates without a quotationId or serviceQuotationId are legal — the schema
 * allows both FK columns to be null; only gate_type='admin_approval' is used here.
 */

import { db, aiCommercialGatesTable, type AiCommercialGate } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  verifyGate,
  failGate,
} from "../commercialGateService.js";
import { publishSafe } from "../aiEventBusService.js";
import type { ApprovalActionType, ApprovalStatus, PendingApproval } from "./types.js";

// ── Internal note shape stored in gate.notes ──────────────────────────────────

interface GateNotes {
  actionType: ApprovalActionType;
  actionPayload: Record<string, unknown>;
  requestedBy: string;
  customerProfileId: number;
  source: "creative-commercial";
  rejectionReason?: string;
}

// ── Raw row type — db.execute() returns snake_case column names ───────────────
// AiCommercialGate is the Drizzle camelCase type, but db.execute<T> rows come
// back from postgres as snake_case. We accept either shape in mapGate.

type RawGateRow = {
  id: number;
  gate_type?: string;
  status?: string;
  notes?: string | null;
  verified_by?: string | null;
  verified_at?: string | Date | null;
  created_at?: string | Date;
  tenant_id?: string | null;
  service_request_id?: number | null;
  quotation_id?: number | null;
  service_quotation_id?: number | null;
  required_amount?: string | null;
  verified_amount?: string | null;
  reference_number?: string | null;
  updated_at?: string | Date;
} & Record<string, unknown>;

// ── Map ai_commercial_gates → PendingApproval ─────────────────────────────────

function mapGate(gate: AiCommercialGate | RawGateRow): PendingApproval {
  // Support both camelCase (Drizzle ORM insert return) and snake_case (db.execute rows)
  const row = gate as RawGateRow;
  const rawStatus = (row.status ?? "pending") as string;
  const rawNotes  = row.notes ?? null;
  const verifiedBy = row.verified_by ?? (gate as AiCommercialGate).verifiedBy ?? null;
  const verifiedAtRaw = row.verified_at ?? (gate as AiCommercialGate).verifiedAt ?? null;
  const createdAtRaw  = row.created_at  ?? (gate as AiCommercialGate).createdAt;

  let notes: Partial<GateNotes> = {};
  try {
    if (typeof rawNotes === "string") {
      notes = JSON.parse(rawNotes) as GateNotes;
    }
  } catch {
    // notes is malformed JSON — treat as empty
  }

  const status: ApprovalStatus =
    rawStatus === "verified"
      ? "approved"
      : rawStatus === "failed" || rawStatus === "waived"
        ? "rejected"
        : "pending";

  return {
    id: row.id,
    customerProfileId: notes.customerProfileId ?? 0,
    actionType: (notes.actionType ?? "issue_recovery_coupon") as ApprovalActionType,
    actionPayload: notes.actionPayload ?? {},
    requestedBy: notes.requestedBy ?? "unknown",
    status,
    approvedBy:   verifiedBy ?? undefined,
    approvedAt:   verifiedAtRaw ? new Date(String(verifiedAtRaw)) : undefined,
    // Gates don't expire — set far-future value for API compatibility
    expiresAt:    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    createdAt:    createdAtRaw ? new Date(String(createdAtRaw)) : new Date(),
  };
}

// ── createPendingApproval ─────────────────────────────────────────────────────

/**
 * Idempotent: if a pending admin_approval gate already exists for this
 * (customerProfileId, actionType) pair, return it instead of creating a new one.
 * This prevents duplicate reward issuance from double-clicks or retries.
 */
export async function createPendingApproval(opts: {
  customerProfileId: number;
  actionType: ApprovalActionType;
  actionPayload: Record<string, unknown>;
  requestedBy: string;
  expiresInHours?: number; // kept for API compat — gates don't expire, value is stored in notes
}): Promise<PendingApproval> {
  // Idempotency check: find existing pending gate for same customer + actionType
  const existing = await db.execute<RawGateRow>(sql`
    SELECT *
    FROM ai_platform.ai_commercial_gates
    WHERE gate_type = 'admin_approval'
      AND status = 'pending'
      AND (notes->>'customerProfileId')::int = ${opts.customerProfileId}
      AND notes->>'actionType' = ${opts.actionType}
      AND notes->>'source' = 'creative-commercial'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const existingRows = (existing as unknown as { rows: RawGateRow[] }).rows ?? [];
  if (existingRows.length > 0 && existingRows[0]) {
    return mapGate(existingRows[0]);
  }

  // Create new gate backed by ai_commercial_gates
  const notes: GateNotes = {
    actionType: opts.actionType,
    actionPayload: opts.actionPayload,
    requestedBy: opts.requestedBy,
    customerProfileId: opts.customerProfileId,
    source: "creative-commercial",
  };

  const [gate] = await db
    .insert(aiCommercialGatesTable)
    .values({
      gateType: "admin_approval",
      status: "pending",
      notes: JSON.stringify(notes),
      tenantId: null, // default tenant
    })
    .returning();

  if (!gate) throw new Error("Failed to create approval gate");

  return mapGate(gate);
}

// ── approveApproval ───────────────────────────────────────────────────────────

/**
 * Approve a pending gate. Guards:
 *   - Gate must exist.
 *   - Gate must be pending (verifyGate enforces pending→verified, prevents double-approve).
 * On success publishes commercial.approval.granted for downstream handlers.
 */
export async function approveApproval(
  approvalId: number,
  approvedBy: string,
): Promise<PendingApproval> {
  // Load gate first so we can check it belongs to creative-commercial domain
  const rawGate = await loadGate(approvalId);
  if (!rawGate) throw new Error(`Approval #${approvalId} not found`);
  // Map to PendingApproval so status is in our vocabulary (approved/rejected/pending)
  const current = mapGate(rawGate);
  if (current.status !== "pending") {
    throw new Error(`Approval #${approvalId} is already ${current.status}`);
  }

  // verifyGate handles the pending→verified CAS internally (guards double-approve at DB level)
  const updated = await verifyGate(approvalId, approvedBy);
  const approval = mapGate(updated);

  // Publish event — downstream handlers execute the actual financial action
  publishSafe({
    eventType: "commercial.approval.granted",
    sourceModule: "creative-commercial",
    sourceId: String(approvalId),
    payload: {
      gateId: approvalId,
      actionType: approval.actionType,
      actionPayload: approval.actionPayload,
      customerProfileId: approval.customerProfileId,
      approvedBy,
    },
  });

  return approval;
}

// ── rejectApproval ────────────────────────────────────────────────────────────

/**
 * Reject a pending gate. failGate is idempotent: if already failed, returns
 * current state. If already verified, this will fail (verifyGate took precedence).
 */
export async function rejectApproval(
  approvalId: number,
  rejectedBy: string,
  reason?: string,
): Promise<PendingApproval> {
  const rawGate = await loadGate(approvalId);
  if (!rawGate) throw new Error(`Approval #${approvalId} not found or not pending`);
  const current = mapGate(rawGate);
  if (current.status !== "pending") {
    throw new Error(`Approval #${approvalId} is already ${current.status}`);
  }

  const updated = await failGate(approvalId, reason ?? `Rejected by ${rejectedBy}`);
  return mapGate(updated);
}

// ── getApproval ───────────────────────────────────────────────────────────────

export async function getApproval(approvalId: number): Promise<PendingApproval | null> {
  const gate = await loadGate(approvalId);
  if (!gate) return null;
  return mapGate(gate);
}

// ── listPendingApprovals ──────────────────────────────────────────────────────

// Hard cap: maximum rows returned by listPendingApprovals regardless of caller input.
// Regression guard: do not remove or raise without updating tests.
const LIST_APPROVALS_MAX_LIMIT  = 100;
const LIST_APPROVALS_DEFAULT_LIMIT = 50;

export async function listPendingApprovals(
  customerProfileId?: number,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ items: PendingApproval[]; total: number; limit: number; offset: number }> {
  const limit  = Math.min(Math.max(opts.limit  ?? LIST_APPROVALS_DEFAULT_LIMIT, 1), LIST_APPROVALS_MAX_LIMIT);
  const offset = Math.max(opts.offset ?? 0, 0);

  const customerFilter = customerProfileId
    ? sql`AND (notes->>'customerProfileId')::int = ${customerProfileId}`
    : sql``;

  const [result, countResult] = await Promise.all([
    db.execute<RawGateRow>(sql`
      SELECT *
      FROM ai_platform.ai_commercial_gates
      WHERE gate_type = 'admin_approval'
        AND status = 'pending'
        AND notes->>'source' = 'creative-commercial'
        ${customerFilter}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total
      FROM ai_platform.ai_commercial_gates
      WHERE gate_type = 'admin_approval'
        AND status = 'pending'
        AND notes->>'source' = 'creative-commercial'
        ${customerFilter}
    `),
  ]);

  const resultRows = (result as unknown as { rows: RawGateRow[] }).rows ?? [];
  const total = (countResult as unknown as { rows: Array<{ total: number }> }).rows?.[0]?.total ?? 0;

  return { items: resultRows.map(mapGate), total: Number(total), limit, offset };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Load a gate row, validating it belongs to the creative-commercial domain. */
async function loadGate(approvalId: number): Promise<RawGateRow | null> {
  const result = await db.execute<RawGateRow>(sql`
    SELECT *
    FROM ai_platform.ai_commercial_gates
    WHERE id = ${approvalId}
      AND gate_type = 'admin_approval'
      AND notes->>'source' = 'creative-commercial'
    LIMIT 1
  `);
  const rows = (result as unknown as { rows: RawGateRow[] }).rows ?? [];
  return rows[0] ?? null;
}
