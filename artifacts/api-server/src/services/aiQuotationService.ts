/**
 * aiQuotationService — lifecycle management for ai_quotations (service-catalog flow).
 *
 * createQuotation       — create a draft quotation from a service request
 * updateQuotationItems  — replace items on a draft quotation (recalculates totals)
 * issueQuotation        — draft → issued; generates secure review token
 * getByToken            — public lookup by plaintext token (compares hash)
 * markViewed            — draft → viewed (idempotent)
 * approveByToken        — viewed/issued → approved (CAS, atomic)
 * requestChangeByToken  — viewed/issued → revision_requested (CAS, atomic)
 * rejectByToken         — viewed/issued → rejected (CAS, atomic)
 *
 * Tokens: we generate 32 random bytes → hex (64-char string) and store its
 * SHA-256 hash. The plaintext token is returned once (at issue time) and
 * never stored.
 */

import crypto from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  aiQuotationsTable,
  aiQuotationItemsTable,
  aiServiceRequestsTable,
  type AiQuotation,
  type AiQuotationItem,
  AI_QUOTATION_TERMINAL_STATES,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function nextQuotationCode(): string {
  const now = new Date();
  const yy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `QT-${yy}${mm}-${rand}`;
}

function computeTotals(items: { quantity: number; unitPrice: number }[], discount: number, taxPercent: number) {
  const itemsTotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const discounted = Math.max(0, itemsTotal - discount);
  const tax = Math.round((discounted * taxPercent) / 100);
  return { subtotal: itemsTotal, tax, total: discounted + tax };
}

// ── public types ──────────────────────────────────────────────────────────────

export interface QuotationWithItems {
  quotation: AiQuotation;
  items: AiQuotationItem[];
}

export interface IssueResult {
  quotation: AiQuotation;
  reviewToken: string; // plaintext — return to caller once, never store
}

// ── createQuotation ───────────────────────────────────────────────────────────

export async function createQuotation(opts: {
  serviceRequestId: number;
  customerName: string;
  customerEmail: string;
  currency?: string;
  tenantId?: string | null;
  validDays?: number;
}): Promise<AiQuotation> {
  const code = nextQuotationCode();
  const validUntil = opts.validDays
    ? new Date(Date.now() + opts.validDays * 86_400_000)
    : null;

  const [q] = await db
    .insert(aiQuotationsTable)
    .values({
      quotationCode: code,
      serviceRequestId: opts.serviceRequestId,
      customerName: opts.customerName,
      customerEmail: opts.customerEmail,
      currency: opts.currency ?? "IDR",
      tenantId: opts.tenantId ?? null,
      validUntil,
      status: "draft",
    })
    .returning();

  await logAudit(
    "ai-quotation",
    "quotation_created",
    String(q.id),
    "ai_quotation",
    "success",
    { serviceRequestId: opts.serviceRequestId, code },
  );

  return q;
}

// ── updateQuotationItems ──────────────────────────────────────────────────────

export async function updateQuotationItems(
  quotationId: number,
  items: Array<{ itemType?: string; description: string; quantity: number; unitPrice: number; metadataJson?: Record<string, unknown>; displayOrder?: number }>,
  opts: { discount?: number; taxPercent?: number } = {},
): Promise<QuotationWithItems> {
  const [existing] = await db
    .select()
    .from(aiQuotationsTable)
    .where(eq(aiQuotationsTable.id, quotationId))
    .limit(1);

  if (!existing) throw new Error(`Quotation ${quotationId} not found`);
  if (existing.status !== "draft") throw new Error("Cannot edit items after quotation is issued");

  const discount = opts.discount ?? existing.discount ?? 0;
  const taxPercent = opts.taxPercent ?? 0;
  const { subtotal, tax, total } = computeTotals(items, discount, taxPercent);

  await db.transaction(async (tx) => {
    // Replace existing items
    await tx.delete(aiQuotationItemsTable).where(eq(aiQuotationItemsTable.quotationId, quotationId));
    if (items.length > 0) {
      await tx.insert(aiQuotationItemsTable).values(
        items.map((item, idx) => ({
          quotationId,
          itemType: item.itemType ?? "service",
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.quantity * item.unitPrice,
          metadataJson: item.metadataJson ?? null,
          displayOrder: item.displayOrder ?? idx,
        })),
      );
    }
    await tx
      .update(aiQuotationsTable)
      .set({ subtotal, discount, tax, total, updatedAt: new Date() })
      .where(eq(aiQuotationsTable.id, quotationId));
  });

  const [updatedQ, updatedItems] = await Promise.all([
    db.select().from(aiQuotationsTable).where(eq(aiQuotationsTable.id, quotationId)).limit(1).then((r) => r[0]),
    db.select().from(aiQuotationItemsTable).where(eq(aiQuotationItemsTable.quotationId, quotationId)),
  ]);

  return { quotation: updatedQ!, items: updatedItems };
}

// ── issueQuotation ────────────────────────────────────────────────────────────

export async function issueQuotation(quotationId: number, validDays = 14): Promise<IssueResult> {
  const [existing] = await db
    .select()
    .from(aiQuotationsTable)
    .where(eq(aiQuotationsTable.id, quotationId))
    .limit(1);
  if (!existing) throw new Error(`Quotation ${quotationId} not found`);
  if (existing.status !== "draft") throw new Error(`Quotation is already ${existing.status}`);

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + validDays * 86_400_000);
  const now = new Date();

  const pricingSnapshot = {
    subtotal: existing.subtotal,
    discount: existing.discount,
    tax: existing.tax,
    total: existing.total,
    currency: existing.currency,
    snapshotAt: now.toISOString(),
  };

  const [q] = await db
    .update(aiQuotationsTable)
    .set({
      status: "issued",
      reviewTokenHash: tokenHash,
      reviewTokenExpiresAt: expiresAt,
      issuedAt: now,
      validUntil: new Date(Date.now() + validDays * 86_400_000),
      // Freeze pricing snapshot
      pricingSnapshotJson: pricingSnapshot,
      updatedAt: now,
    })
    .where(and(eq(aiQuotationsTable.id, quotationId), eq(aiQuotationsTable.status, "draft")))
    .returning();

  if (!q) throw new Error("Quotation was modified concurrently; please retry");

  await logAudit("ai-quotation", "quotation_issued", String(q.id), "ai_quotation", "success", { code: q.quotationCode });
  publishSafe({
    eventType: "quotation.issued",
    sourceModule: "ai-quotation",
    sourceId: String(q.id),
    payload: { quotationId: q.id, code: q.quotationCode, serviceRequestId: q.serviceRequestId },
  });

  // Update service request status to waiting_customer_approval
  if (q.serviceRequestId) {
    await db
      .update(aiServiceRequestsTable)
      .set({ status: "waiting_customer_approval", updatedAt: now })
      .where(eq(aiServiceRequestsTable.id, q.serviceRequestId));
  }

  return { quotation: q, reviewToken: token };
}

// ── getByToken ────────────────────────────────────────────────────────────────

export async function getByToken(plainToken: string): Promise<QuotationWithItems | null> {
  const tokenHash = hashToken(plainToken);
  const [q] = await db
    .select()
    .from(aiQuotationsTable)
    .where(eq(aiQuotationsTable.reviewTokenHash, tokenHash))
    .limit(1);
  if (!q) return null;

  const items = await db
    .select()
    .from(aiQuotationItemsTable)
    .where(eq(aiQuotationItemsTable.quotationId, q.id));

  return { quotation: q, items };
}

// ── markViewed ────────────────────────────────────────────────────────────────

export async function markViewed(quotationId: number): Promise<void> {
  await db
    .update(aiQuotationsTable)
    .set({ status: "viewed", viewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(aiQuotationsTable.id, quotationId), eq(aiQuotationsTable.status, "issued")));
}

// ── CAS transition helper ─────────────────────────────────────────────────────

type TerminalTransition = "approved" | "rejected" | "revision_requested";

async function casTransition(
  quotationId: number,
  targetStatus: TerminalTransition,
  extra: Record<string, unknown> = {},
): Promise<AiQuotation> {
  const now = new Date();
  const tsField: Record<TerminalTransition, string> = {
    approved: "approvedAt",
    rejected: "rejectedAt",
    revision_requested: "revisionRequestedAt",
  };

  const [saved] = await db
    .update(aiQuotationsTable)
    .set({
      status: targetStatus,
      [tsField[targetStatus]]: now,
      updatedAt: now,
      ...extra,
    })
    .where(
      and(
        eq(aiQuotationsTable.id, quotationId),
        inArray(aiQuotationsTable.status, ["issued", "viewed"]),
      ),
    )
    .returning();

  if (!saved) {
    const [current] = await db
      .select()
      .from(aiQuotationsTable)
      .where(eq(aiQuotationsTable.id, quotationId))
      .limit(1);
    if (!current) throw new Error(`Quotation ${quotationId} not found`);
    if (AI_QUOTATION_TERMINAL_STATES.has(current.status)) {
      throw new Error(`Quotation is already in terminal state: ${current.status}`);
    }
    throw new Error("Quotation was modified concurrently; please retry");
  }

  return saved;
}

// ── approveByToken ────────────────────────────────────────────────────────────

export async function approveByToken(plainToken: string): Promise<AiQuotation> {
  const result = await getByToken(plainToken);
  if (!result) throw new Error("Invalid or expired token");
  const { quotation } = result;

  const saved = await casTransition(quotation.id, "approved");

  await logAudit("ai-quotation", "quotation_approved", String(saved.id), "ai_quotation", "success", {
    code: saved.quotationCode,
    serviceRequestId: saved.serviceRequestId,
  });
  publishSafe({
    eventType: "quotation.approved",
    sourceModule: "ai-quotation",
    sourceId: String(saved.id),
    payload: { quotationId: saved.id, serviceRequestId: saved.serviceRequestId },
  });

  if (saved.serviceRequestId) {
    await db
      .update(aiServiceRequestsTable)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(aiServiceRequestsTable.id, saved.serviceRequestId));
  }

  return saved;
}

// ── requestChangeByToken ──────────────────────────────────────────────────────

export async function requestChangeByToken(plainToken: string, notes: string): Promise<AiQuotation> {
  const result = await getByToken(plainToken);
  if (!result) throw new Error("Invalid or expired token");
  const { quotation } = result;

  const saved = await casTransition(quotation.id, "revision_requested", {
    revisionNotes: notes.slice(0, 2000),
  });

  await logAudit("ai-quotation", "quotation_revision_requested", String(saved.id), "ai_quotation", "success", {
    code: saved.quotationCode, notes: notes.slice(0, 200),
  });
  publishSafe({
    eventType: "quotation.revision_requested",
    sourceModule: "ai-quotation",
    sourceId: String(saved.id),
    payload: { quotationId: saved.id, serviceRequestId: saved.serviceRequestId, notes },
  });

  if (saved.serviceRequestId) {
    await db
      .update(aiServiceRequestsTable)
      .set({ status: "revision_requested", updatedAt: new Date() })
      .where(eq(aiServiceRequestsTable.id, saved.serviceRequestId));
  }

  return saved;
}

// ── rejectByToken ─────────────────────────────────────────────────────────────

export async function rejectByToken(plainToken: string, notes?: string): Promise<AiQuotation> {
  const result = await getByToken(plainToken);
  if (!result) throw new Error("Invalid or expired token");
  const { quotation } = result;

  const saved = await casTransition(quotation.id, "rejected", {
    revisionNotes: notes ? notes.slice(0, 2000) : null,
  });

  await logAudit("ai-quotation", "quotation_rejected", String(saved.id), "ai_quotation", "success", {
    code: saved.quotationCode,
  });
  publishSafe({
    eventType: "quotation.rejected",
    sourceModule: "ai-quotation",
    sourceId: String(saved.id),
    payload: { quotationId: saved.id, serviceRequestId: saved.serviceRequestId },
  });

  if (saved.serviceRequestId) {
    await db
      .update(aiServiceRequestsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(aiServiceRequestsTable.id, saved.serviceRequestId));
  }

  return saved;
}

// ── getQuotationWithItems ─────────────────────────────────────────────────────

export async function getQuotationWithItems(quotationId: number): Promise<QuotationWithItems | null> {
  const [q] = await db
    .select()
    .from(aiQuotationsTable)
    .where(eq(aiQuotationsTable.id, quotationId))
    .limit(1);
  if (!q) return null;

  const items = await db
    .select()
    .from(aiQuotationItemsTable)
    .where(eq(aiQuotationItemsTable.quotationId, q.id));

  return { quotation: q, items };
}
