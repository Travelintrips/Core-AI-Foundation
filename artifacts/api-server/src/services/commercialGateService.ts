/**
 * commercialGateService — lifecycle management for ai_commercial_gates rows.
 *
 * createGateForQuotation  — idempotent: returns existing gate if one exists
 * verifyGate              — transitions pending → verified
 * failGate                — transitions pending → failed
 * waiveGate               — transitions pending → waived (reason required)
 *
 * All mutations emit audit log entries and publishSafe events.
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  aiCommercialGatesTable,
  creativeProjectQuotationsTable,
  aiServiceRequestsTable,
  type AiCommercialGate,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";

// ── createGateForQuotation ────────────────────────────────────────────────────

export async function createGateForQuotation(opts: {
  quotationId: number;
  serviceRequestId?: number | null;
  gateType?: string;
  requiredAmount?: number | null;
  tenantId?: string | null;
}): Promise<AiCommercialGate> {
  // Idempotency: return existing gate for this quotation if one already exists.
  const [existing] = await db
    .select()
    .from(aiCommercialGatesTable)
    .where(eq(aiCommercialGatesTable.quotationId, opts.quotationId))
    .limit(1);
  if (existing) return existing;

  const [gate] = await db
    .insert(aiCommercialGatesTable)
    .values({
      quotationId: opts.quotationId,
      serviceRequestId: opts.serviceRequestId ?? null,
      gateType: opts.gateType ?? "admin_approval",
      status: "pending",
      requiredAmount: opts.requiredAmount != null ? String(opts.requiredAmount) : null,
      tenantId: opts.tenantId ?? null,
    })
    .returning();

  await logAudit(
    "commercial-gate",
    "gate_created",
    String(gate.id),
    "ai_commercial_gate",
    "success",
    { quotationId: opts.quotationId, gateType: gate.gateType, serviceRequestId: opts.serviceRequestId ?? null },
  );

  publishSafe({
    eventType: "commercial_gate.created",
    sourceModule: "commercial-gate",
    sourceId: String(gate.id),
    payload: { gateId: gate.id, quotationId: opts.quotationId, gateType: gate.gateType },
  });

  return gate;
}

// ── verifyGate ────────────────────────────────────────────────────────────────

export async function verifyGate(
  gateId: number,
  verifiedBy: string,
  verifiedAmount?: number | null,
  referenceNumber?: string | null,
): Promise<AiCommercialGate> {
  const [gate] = await db
    .update(aiCommercialGatesTable)
    .set({
      status: "verified",
      verifiedBy,
      verifiedAt: new Date(),
      verifiedAmount: verifiedAmount != null ? String(verifiedAmount) : null,
      referenceNumber: referenceNumber ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiCommercialGatesTable.id, gateId),
        eq(aiCommercialGatesTable.status, "pending"),
      ),
    )
    .returning();

  if (!gate) {
    // Already transitioned — return current state
    const [current] = await db
      .select()
      .from(aiCommercialGatesTable)
      .where(eq(aiCommercialGatesTable.id, gateId))
      .limit(1);
    if (!current) throw new Error(`Commercial gate ${gateId} not found`);
    return current;
  }

  await logAudit(
    "commercial-gate",
    "gate_verified",
    String(gate.id),
    "ai_commercial_gate",
    "success",
    { verifiedBy, verifiedAmount, referenceNumber, quotationId: gate.quotationId },
  );

  publishSafe({
    eventType: "commercial_gate.verified",
    sourceModule: "commercial-gate",
    sourceId: String(gate.id),
    payload: {
      gateId: gate.id,
      quotationId: gate.quotationId,
      serviceRequestId: gate.serviceRequestId,
      verifiedBy,
    },
  });

  return gate;
}

// ── failGate ──────────────────────────────────────────────────────────────────

export async function failGate(gateId: number, reason: string): Promise<AiCommercialGate> {
  const [gate] = await db
    .update(aiCommercialGatesTable)
    .set({
      status: "failed",
      notes: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiCommercialGatesTable.id, gateId),
        eq(aiCommercialGatesTable.status, "pending"),
      ),
    )
    .returning();

  if (!gate) {
    const [current] = await db
      .select()
      .from(aiCommercialGatesTable)
      .where(eq(aiCommercialGatesTable.id, gateId))
      .limit(1);
    if (!current) throw new Error(`Commercial gate ${gateId} not found`);
    return current;
  }

  await logAudit(
    "commercial-gate",
    "gate_failed",
    String(gate.id),
    "ai_commercial_gate",
    "failure",
    { reason, quotationId: gate.quotationId },
  );

  publishSafe({
    eventType: "commercial_gate.failed",
    sourceModule: "commercial-gate",
    sourceId: String(gate.id),
    payload: { gateId: gate.id, quotationId: gate.quotationId, reason },
  });

  return gate;
}

// ── waiveGate ─────────────────────────────────────────────────────────────────

export async function waiveGate(
  gateId: number,
  waivedBy: string,
  reason: string,
): Promise<AiCommercialGate> {
  const [gate] = await db
    .update(aiCommercialGatesTable)
    .set({
      status: "waived",
      verifiedBy: waivedBy,
      verifiedAt: new Date(),
      notes: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiCommercialGatesTable.id, gateId),
        eq(aiCommercialGatesTable.status, "pending"),
      ),
    )
    .returning();

  if (!gate) {
    const [current] = await db
      .select()
      .from(aiCommercialGatesTable)
      .where(eq(aiCommercialGatesTable.id, gateId))
      .limit(1);
    if (!current) throw new Error(`Commercial gate ${gateId} not found`);
    return current;
  }

  await logAudit(
    "commercial-gate",
    "gate_waived",
    String(gate.id),
    "ai_commercial_gate",
    "success",
    { waivedBy, reason, quotationId: gate.quotationId },
  );

  publishSafe({
    eventType: "commercial_gate.waived",
    sourceModule: "commercial-gate",
    sourceId: String(gate.id),
    payload: {
      gateId: gate.id,
      quotationId: gate.quotationId,
      serviceRequestId: gate.serviceRequestId,
      waivedBy,
    },
  });

  return gate;
}

// ── getGateForQuotation ───────────────────────────────────────────────────────

export async function getGateForQuotation(
  quotationId: number,
): Promise<AiCommercialGate | null> {
  const [gate] = await db
    .select()
    .from(aiCommercialGatesTable)
    .where(eq(aiCommercialGatesTable.quotationId, quotationId))
    .limit(1);
  return gate ?? null;
}

// ── createGateForServiceQuotation ─────────────────────────────────────────────
// New service-catalog flow: gate linked to ai_quotations (serviceQuotationId).

export async function createGateForServiceQuotation(opts: {
  serviceQuotationId: number;
  serviceRequestId?: number | null;
  gateType?: string;
  requiredAmount?: number | null;
  tenantId?: string | null;
}): Promise<AiCommercialGate> {
  const [existing] = await db
    .select()
    .from(aiCommercialGatesTable)
    .where(eq(aiCommercialGatesTable.serviceQuotationId, opts.serviceQuotationId))
    .limit(1);
  if (existing) return existing;

  const [gate] = await db
    .insert(aiCommercialGatesTable)
    .values({
      serviceQuotationId: opts.serviceQuotationId,
      serviceRequestId: opts.serviceRequestId ?? null,
      gateType: opts.gateType ?? "admin_approval",
      status: "pending",
      requiredAmount: opts.requiredAmount != null ? String(opts.requiredAmount) : null,
      tenantId: opts.tenantId ?? null,
    })
    .returning();

  await logAudit(
    "commercial-gate",
    "gate_created",
    String(gate.id),
    "ai_commercial_gate",
    "success",
    { serviceQuotationId: opts.serviceQuotationId, gateType: gate.gateType },
  );

  publishSafe({
    eventType: "commercial_gate.created",
    sourceModule: "commercial-gate",
    sourceId: String(gate.id),
    payload: { gateId: gate.id, serviceQuotationId: opts.serviceQuotationId, gateType: gate.gateType },
  });

  return gate;
}

// ── getGateForServiceQuotation ────────────────────────────────────────────────

export async function getGateForServiceQuotation(
  serviceQuotationId: number,
): Promise<AiCommercialGate | null> {
  const [gate] = await db
    .select()
    .from(aiCommercialGatesTable)
    .where(eq(aiCommercialGatesTable.serviceQuotationId, serviceQuotationId))
    .limit(1);
  return gate ?? null;
}

// ── gateIsCleared ─────────────────────────────────────────────────────────────

export function gateIsCleared(gate: AiCommercialGate): boolean {
  return gate.status === "verified" || gate.status === "waived";
}
