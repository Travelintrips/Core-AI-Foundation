/**
 * catalog.ts — AI Service Catalog & Pricing Center
 *
 * GET/POST   /ai/catalog/categories
 * PATCH/DEL  /ai/catalog/categories/:id
 * GET/POST   /ai/catalog/services            (?categoryId=)
 * GET/PATCH/DEL /ai/catalog/services/:id
 * POST       /ai/catalog/services/:id/packages
 * POST       /ai/catalog/services/:id/request
 * PATCH/DEL  /ai/catalog/packages/:id
 * GET        /ai/catalog/requests
 * PATCH      /ai/catalog/requests/:id/status
 * GET        /ai/catalog/analytics
 */
import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  aiServiceCategoriesTable,
  aiServicesTable,
  aiServicePackagesTable,
  aiServiceRequestsTable,
  aiServicePriceRulesTable,
  aiQuotationsTable,
  aiQuotationItemsTable,
  creativeProjectsTable,
  insertAiServiceCategorySchema,
  insertAiServiceSchema,
  insertAiServicePackageSchema,
  insertAiServiceRequestSchema,
  insertAiServicePriceRuleSchema,
} from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";
import { sendEmail } from "../services/emailService.js";
import { generatePricingSnapshot, toCustomerFacingBreakdown, type PricingSelections } from "../services/aiPricingService.js";
import { generateScheduleForProject, type PaymentPolicy } from "../services/paymentScheduleService.js";
import { publishSafe } from "../services/aiEventBusService.js";
import { createHash, randomBytes } from "crypto";
import { getGateForServiceQuotation, gateIsCleared } from "../services/commercialGateService.js";

// Statuses that must only be reached once the commercial gate (if one exists
// for this request's quotation) has been verified or waived. Without this
// guard, PATCH /ai/catalog/requests/:id/status can be called directly (e.g.
// from admin NEXT_ACTIONS buttons) to skip straight past an unresolved
// commercial gate, leaving the customer-facing "Verifikasi Komersial" step
// permanently stuck at "pending" while the backend claims to be much further
// along (see .agents/memory/provider-health-check-slug-baseurl.md-adjacent
// bug class — status vocabulary vs. real gate state diverging).
const POST_GATE_STATUSES = new Set([
  "ready_to_build",
  "in_progress",
  "orchestrating",
  "waiting_review",
  "completed",
  "converted_to_project",
]);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function generateToken(): string { return randomBytes(32).toString("base64url"); }
function hashToken(t: string): string { return createHash("sha256").update(t).digest("hex"); }

/** Build the base URL for constructing portal links */
function buildBaseUrl(req: import("express").Request): string {
  if (process.env["REPLIT_DEV_DOMAIN"]) return `https://${process.env["REPLIT_DEV_DOMAIN"]}`;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

const router = Router();

function parseId(raw: string | undefined, res: import("express").Response): number | null {
  const id = parseInt(raw ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

// ── Categories ────────────────────────────────────────────────────────────────

router.get("/ai/catalog/categories", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(aiServiceCategoriesTable)
    .orderBy(aiServiceCategoriesTable.displayOrder, aiServiceCategoriesTable.name);
  res.json(rows);
});

router.post("/ai/catalog/categories", async (req, res): Promise<void> => {
  const parsed = insertAiServiceCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [row] = await db.insert(aiServiceCategoriesTable).values(parsed.data).returning();
    await logAudit("catalog", "create_category", String(row.id), "ai_service_category", "success", { name: row.name });
    res.status(201).json(row);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "Category code already exists" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

router.patch("/ai/catalog/categories/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const parsed = insertAiServiceCategorySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(aiServiceCategoriesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(aiServiceCategoriesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Category not found" }); return; }
  await logAudit("catalog", "update_category", String(id), "ai_service_category", "success", parsed.data);
  res.json(row);
});

router.delete("/ai/catalog/categories/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  await db.delete(aiServiceCategoriesTable).where(eq(aiServiceCategoriesTable.id, id));
  await logAudit("catalog", "delete_category", String(id), "ai_service_category", "success");
  res.status(204).send();
});

// ── Services ──────────────────────────────────────────────────────────────────

router.get("/ai/catalog/services", async (req, res): Promise<void> => {
  const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId), 10) : null;
  const query = db.select().from(aiServicesTable);
  const rows = categoryId && !Number.isNaN(categoryId)
    ? await query.where(eq(aiServicesTable.categoryId, categoryId)).orderBy(aiServicesTable.serviceName)
    : await query.orderBy(aiServicesTable.serviceName);
  res.json(rows);
});

router.post("/ai/catalog/services", async (req, res): Promise<void> => {
  const parsed = insertAiServiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [row] = await db.insert(aiServicesTable).values(parsed.data).returning();
    await logAudit("catalog", "create_service", String(row.id), "ai_service", "success", { name: row.serviceName });
    res.status(201).json(row);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "Service code already exists" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

router.get("/ai/catalog/services/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const [service] = await db.select().from(aiServicesTable).where(eq(aiServicesTable.id, id)).limit(1);
  if (!service) { res.status(404).json({ error: "Service not found" }); return; }
  const packages = await db
    .select()
    .from(aiServicePackagesTable)
    .where(eq(aiServicePackagesTable.serviceId, id))
    .orderBy(aiServicePackagesTable.oneTimePrice);
  res.json({ ...service, packages });
});

router.patch("/ai/catalog/services/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const parsed = insertAiServiceSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(aiServicesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(aiServicesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Service not found" }); return; }
  await logAudit("catalog", "update_service", String(id), "ai_service", "success", parsed.data);
  res.json(row);
});

router.delete("/ai/catalog/services/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  await db.delete(aiServicesTable).where(eq(aiServicesTable.id, id));
  await logAudit("catalog", "delete_service", String(id), "ai_service", "success");
  res.status(204).send();
});

// ── Packages ──────────────────────────────────────────────────────────────────

router.post("/ai/catalog/services/:id/packages", async (req, res): Promise<void> => {
  const serviceId = parseId(req.params.id, res);
  if (serviceId === null) return;
  const parsed = insertAiServicePackageSchema.safeParse({ ...req.body, serviceId });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(aiServicePackagesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/ai/catalog/packages/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const parsed = insertAiServicePackageSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(aiServicePackagesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(aiServicePackagesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Package not found" }); return; }
  res.json(row);
});

router.delete("/ai/catalog/packages/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  await db.delete(aiServicePackagesTable).where(eq(aiServicePackagesTable.id, id));
  res.status(204).send();
});

// ── Pricing Calculator ───────────────────────────────────────────────────────

async function loadServiceAndPackage(serviceId: number, packageId: number | null | undefined, res: import("express").Response) {
  const [service] = await db.select().from(aiServicesTable).where(eq(aiServicesTable.id, serviceId)).limit(1);
  if (!service) { res.status(404).json({ error: "Service not found" }); return null; }
  let pkg = null;
  if (packageId != null) {
    const [row] = await db.select().from(aiServicePackagesTable).where(eq(aiServicePackagesTable.id, packageId)).limit(1);
    if (!row || row.serviceId !== serviceId) { res.status(400).json({ error: "packageId does not belong to the requested service" }); return null; }
    pkg = row;
  }
  return { service, pkg };
}

router.post("/ai/catalog/services/:id/quote", async (req, res): Promise<void> => {
  const serviceId = parseId(req.params.id, res);
  if (serviceId === null) return;
  const body = req.body as { packageId?: number; pricingModelSelected?: string; discount?: number; tenantId?: string } & PricingSelections;

  const loaded = await loadServiceAndPackage(serviceId, body.packageId, res);
  if (!loaded) return;
  const { service, pkg } = loaded;

  const breakdown = await generatePricingSnapshot(
    service,
    pkg,
    body.pricingModelSelected ?? service.pricingModel,
    body,
    body.discount ?? 0,
    body.tenantId ?? null,
  );

  // Customer-facing quote preview never includes internal cost/margin.
  res.json(toCustomerFacingBreakdown(breakdown));
});

// ── Requests (Request Service → intake for AI Orchestrator) ─────────────────

router.post("/ai/catalog/services/:id/request", async (req, res): Promise<void> => {
  const serviceId = parseId(req.params.id, res);
  if (serviceId === null) return;

  const parsed = insertAiServiceRequestSchema.safeParse({ ...req.body, serviceId });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const loaded = await loadServiceAndPackage(serviceId, parsed.data.packageId, res);
  if (!loaded) return;
  const { service, pkg } = loaded;

  const breakdown = await generatePricingSnapshot(
    service,
    pkg,
    parsed.data.pricingModelSelected ?? service.pricingModel,
    parsed.data as PricingSelections,
    0,
    parsed.data.tenantId ?? null,
  );

  const [row] = await db
    .insert(aiServiceRequestsTable)
    .values({
      ...parsed.data,
      requestId: randomUUID(),
      status: "draft",
      currency: breakdown.currency,
      subtotal: String(breakdown.subtotal),
      rushFee: String(breakdown.rushFee),
      revisionFee: String(breakdown.revisionFee),
      humanReviewFee: String(breakdown.humanReviewFee),
      additionalServiceFee: String(breakdown.additionalServiceFee),
      discount: String(breakdown.discount),
      tax: String(breakdown.tax),
      total: String(breakdown.total),
      pricingSnapshotJson: breakdown as unknown as Record<string, unknown>,
      estimatedAiCost: String(breakdown.estimatedAiCost),
      humanLaborEstimate: String(breakdown.humanLaborEstimate),
      grossMargin: String(breakdown.grossMargin),
      grossMarginPercent: String(breakdown.grossMarginPercent),
      marginApprovalRequired: breakdown.marginApprovalRequired,
    })
    .returning();

  await logAudit("catalog", "request_service", String(row.id), "ai_service_request", "success", {
    serviceId,
    serviceName: service.serviceName,
    customerEmail: row.customerEmail,
    total: row.total,
    marginApprovalRequired: row.marginApprovalRequired,
  });

  // Customer-facing response — strip internal cost/margin fields, including
  // the nested pricingSnapshotJson blob (which also carries cost/margin data).
  const { estimatedAiCost, actualAiCost, humanLaborEstimate, grossMargin, grossMarginPercent, marginApprovalRequired, marginApprovedBy, marginApprovedAt, pricingSnapshotJson, ...customerFacing } = row;
  res.status(201).json({ ...customerFacing, pricingSnapshotJson: toCustomerFacingBreakdown(breakdown) });
});

router.get("/ai/catalog/requests", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(aiServiceRequestsTable)
    .orderBy(desc(aiServiceRequestsTable.createdAt));
  res.json(rows);
});

router.get("/ai/catalog/requests/:id/margin-review", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const [row] = await db.select().from(aiServiceRequestsTable).where(eq(aiServiceRequestsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Request not found" }); return; }
  res.json({
    estimatedAiCost: row.estimatedAiCost,
    humanLaborEstimate: row.humanLaborEstimate,
    grossMargin: row.grossMargin,
    grossMarginPercent: row.grossMarginPercent,
    marginApprovalRequired: row.marginApprovalRequired,
    marginApprovedBy: row.marginApprovedBy,
    marginApprovedAt: row.marginApprovedAt,
  });
});

router.post("/ai/catalog/requests/:id/approve-margin", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const { approvedBy } = req.body as { approvedBy?: string };
  if (!approvedBy) { res.status(400).json({ error: "approvedBy is required" }); return; }
  const [row] = await db
    .update(aiServiceRequestsTable)
    .set({ marginApprovalRequired: false, marginApprovedBy: approvedBy, marginApprovedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiServiceRequestsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Request not found" }); return; }
  await logAudit("catalog", "approve_margin", String(id), "ai_service_request", "success", { approvedBy });
  res.json({ ok: true });
});

router.patch("/ai/catalog/requests/:id/status", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const { status, createdProjectId } = req.body as { status?: string; createdProjectId?: string };
  if (!status) { res.status(400).json({ error: "status is required" }); return; }

  if (POST_GATE_STATUSES.has(status)) {
    const [existing] = await db
      .select({ id: aiServiceRequestsTable.id, createdProjectId: aiServiceRequestsTable.createdProjectId })
      .from(aiServiceRequestsTable)
      .where(eq(aiServiceRequestsTable.id, id))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Request not found" }); return; }

    const [quotation] = await db
      .select({ id: aiQuotationsTable.id })
      .from(aiQuotationsTable)
      .where(eq(aiQuotationsTable.serviceRequestId, id))
      .limit(1);

    if (quotation) {
      const gate = await getGateForServiceQuotation(quotation.id);
      if (gate && !gateIsCleared(gate)) {
        res.status(409).json({
          error: `Cannot move to "${status}": commercial gate ${gate.id} is still "${gate.status}". Verify or waive it first via /commercial-gates/${gate.id}/verify or /waive.`,
        });
        return;
      }
    }

    if (status === "completed" || status === "converted_to_project") {
      const finalProjectId = createdProjectId ?? existing.createdProjectId;
      if (!finalProjectId) {
        res.status(409).json({ error: `Cannot move to "${status}" without a createdProjectId — production must actually exist first.` });
        return;
      }
      const [project] = await db
        .select({ status: creativeProjectsTable.status })
        .from(creativeProjectsTable)
        .where(eq(creativeProjectsTable.id, Number(finalProjectId)))
        .limit(1);
      if (!project || project.status !== "completed") {
        res.status(409).json({ error: `Cannot move to "${status}": linked project ${finalProjectId} is not marked completed.` });
        return;
      }
    }
  }

  const [row] = await db
    .update(aiServiceRequestsTable)
    .set({ status, createdProjectId: createdProjectId ?? undefined, updatedAt: new Date() })
    .where(eq(aiServiceRequestsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Request not found" }); return; }
  await logAudit("catalog", "update_request_status", String(id), "ai_service_request", "success", { status });
  res.json(row);
});

// ── Completion Notes & Links (admin → customer deliverable handoff) ────────────
// PATCH /ai/catalog/requests/:id/completion
// Admin saves notes + downloadable links that appear on the customer portal
// results page once a request is marked as completed.

router.patch("/ai/catalog/requests/:id/completion", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const { notes, links } = req.body as {
    notes?: string;
    links?: Array<{ label: string; url: string }>;
  };

  const [row] = await db
    .update(aiServiceRequestsTable)
    .set({
      completionNotes: notes ?? null,
      completionLinks: links ?? null,
      updatedAt: new Date(),
    })
    .where(eq(aiServiceRequestsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Request not found" }); return; }
  await logAudit("catalog", "update_completion", String(id), "ai_service_request", "success", {
    notesLength: notes?.length ?? 0,
    linkCount: links?.length ?? 0,
  });
  res.json({ ok: true });
});

// ── Issue Quotation Link ──────────────────────────────────────────────────────
// POST /ai/catalog/requests/:id/issue-quotation
// Creates (or re-issues) an ai_quotation from the request's pricing snapshot,
// returns the plaintext token + full quotation URL once so admin can share it.

router.post("/ai/catalog/requests/:id/issue-quotation", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;

  const [serviceReq] = await db
    .select()
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.id, id))
    .limit(1);

  if (!serviceReq) { res.status(404).json({ error: "Request not found" }); return; }

  const snapshot = serviceReq.pricingSnapshotJson as Record<string, unknown> | null;
  if (!snapshot) { res.status(400).json({ error: "No pricing snapshot available — quote the service first" }); return; }

  const now = new Date();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const validUntil = new Date(Date.now() + 14 * 86_400_000); // 14 days

  // Find existing quotation for this service request
  const [existing] = await db
    .select({ id: aiQuotationsTable.id, status: aiQuotationsTable.status })
    .from(aiQuotationsTable)
    .where(eq(aiQuotationsTable.serviceRequestId, id))
    .limit(1);

  let quotationId: number;

  if (existing) {
    // Re-issue: overwrite token (invalidates previous link) and reset to issued
    await db
      .update(aiQuotationsTable)
      .set({
        status: "issued",
        reviewTokenHash: tokenHash,
        reviewTokenExpiresAt: validUntil,
        issuedAt: now,
        validUntil,
        updatedAt: now,
      })
      .where(eq(aiQuotationsTable.id, existing.id));
    quotationId = existing.id;
  } else {
    // Sequential quotation code: QT-YYYY-NNNN
    const year = now.getFullYear();
    const countRow = await db
      .select({ cnt: aiQuotationsTable.id })
      .from(aiQuotationsTable)
      .orderBy(desc(aiQuotationsTable.id))
      .limit(1);
    const seq = (countRow[0]?.cnt ?? 0) + 1;
    const quotationCode = `QT-${year}-${String(seq).padStart(4, "0")}`;

    const total = Number(serviceReq.total) || 0;
    const subtotal = Number(serviceReq.subtotal) || total;
    const discount = Number(serviceReq.discount) || 0;
    const tax = Number(serviceReq.tax) || 0;

    const [newQ] = await db
      .insert(aiQuotationsTable)
      .values({
        quotationCode,
        serviceRequestId: id,
        customerName: serviceReq.customerName,
        customerEmail: serviceReq.customerEmail,
        currency: serviceReq.currency,
        subtotal,
        discount,
        tax,
        total,
        pricingSnapshotJson: snapshot,
        status: "issued",
        reviewTokenHash: tokenHash,
        reviewTokenExpiresAt: validUntil,
        issuedAt: now,
        validUntil,
      })
      .returning({ id: aiQuotationsTable.id });

    quotationId = newQ!.id;

    // Insert line items from snapshot if available
    const lineItems = (snapshot?.lineItems ?? []) as { code: string; label: string; amount: number }[];
    if (lineItems.length > 0) {
      await db.insert(aiQuotationItemsTable).values(
        lineItems.map((item, idx) => ({
          quotationId,
          itemCode: item.code,
          description: item.label,
          quantity: 1,
          unitPrice: item.amount,
          amount: item.amount,
          displayOrder: idx,
        })),
      );
    }
  }

  // Advance service request status to quotation_ready
  await db
    .update(aiServiceRequestsTable)
    .set({ status: "quotation_ready", updatedAt: now })
    .where(eq(aiServiceRequestsTable.id, id));

  await logAudit("catalog", "issue_quotation_link", String(id), "ai_service_request", "success", {
    quotationId,
    customerEmail: serviceReq.customerEmail,
  });

  const base = buildBaseUrl(req);
  const quotationUrl = `${base}/request-service/${serviceReq.requestId}/quotation?token=${token}`;

  const emailResult = await sendEmail({
    to: serviceReq.customerEmail,
    subject: `Penawaran Harga Siap — ${serviceReq.requestId}`,
    html: `
      <p>Halo ${escapeHtml(serviceReq.customerName)},</p>
      <p>Penawaran harga untuk permintaan Anda (<strong>${escapeHtml(serviceReq.requestId)}</strong>) sudah siap untuk ditinjau.</p>
      <p><a href="${quotationUrl}" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;border-radius:8px;">Lihat Penawaran</a></p>
      <p>Link ini berlaku sampai ${validUntil.toLocaleDateString("id-ID")}.</p>
      <p>Jika tombol di atas tidak berfungsi, salin tautan berikut ke browser Anda:<br/>${quotationUrl}</p>
    `,
    module: "catalog",
    action: "quotation_email_sent",
    resourceId: String(quotationId),
  });

  res.json({
    ok: true,
    quotationId,
    quotationUrl,
    validUntil: validUntil.toISOString(),
    customerEmail: serviceReq.customerEmail,
    emailSent: emailResult.ok,
    emailError: emailResult.ok ? undefined : emailResult.error,
    note: "Store or share this URL immediately — the plaintext token is not stored and cannot be recovered.",
  });
});

// ── Price Rules ───────────────────────────────────────────────────────────────

router.get("/ai/catalog/price-rules", async (req, res): Promise<void> => {
  const serviceId = req.query.serviceId ? parseInt(String(req.query.serviceId), 10) : null;
  const rows = await db.select().from(aiServicePriceRulesTable).orderBy(aiServicePriceRulesTable.priority);
  res.json(serviceId && !Number.isNaN(serviceId) ? rows.filter((r) => r.serviceId === serviceId || r.serviceId === null) : rows);
});

router.post("/ai/catalog/price-rules", async (req, res): Promise<void> => {
  const parsed = insertAiServicePriceRuleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const [row] = await db.insert(aiServicePriceRulesTable).values(parsed.data).returning();
    await logAudit("catalog", "create_price_rule", String(row.id), "ai_service_price_rule", "success", { ruleCode: row.ruleCode });
    res.status(201).json(row);
  } catch (err) {
    const msg = String(err);
    res.status(msg.includes("unique") || msg.includes("duplicate") ? 409 : 500).json({ error: msg });
  }
});

router.patch("/ai/catalog/price-rules/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const parsed = insertAiServicePriceRuleSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db
    .update(aiServicePriceRulesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(aiServicePriceRulesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Price rule not found" }); return; }
  await logAudit("catalog", "update_price_rule", String(id), "ai_service_price_rule", "success", parsed.data);
  res.json(row);
});

router.delete("/ai/catalog/price-rules/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  await db.delete(aiServicePriceRulesTable).where(eq(aiServicePriceRulesTable.id, id));
  await logAudit("catalog", "delete_price_rule", String(id), "ai_service_price_rule", "success");
  res.status(204).send();
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get("/ai/catalog/analytics", async (_req, res): Promise<void> => {
  const [requests, services, categories, packages] = await Promise.all([
    db.select().from(aiServiceRequestsTable),
    db.select().from(aiServicesTable),
    db.select().from(aiServiceCategoriesTable),
    db.select().from(aiServicePackagesTable),
  ]);

  const serviceById = new Map(services.map((s) => [s.id, s]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const packageById = new Map(packages.map((p) => [p.id, p]));

  const requestCountByService = new Map<number, number>();
  const revenueByCategory = new Map<number, number>();
  const requestCountByPackage = new Map<number, number>();
  let completed = 0;

  for (const r of requests) {
    requestCountByService.set(r.serviceId, (requestCountByService.get(r.serviceId) ?? 0) + 1);
    if (r.packageId) {
      requestCountByPackage.set(r.packageId, (requestCountByPackage.get(r.packageId) ?? 0) + 1);
    }
    if (r.status === "completed") completed += 1;

    const service = serviceById.get(r.serviceId);
    if (service?.categoryId != null) {
      let amount = 0;
      const pkg = r.packageId ? packageById.get(r.packageId) : undefined;
      if (pkg) {
        amount = Number(pkg.oneTimePrice ?? pkg.monthlyPrice ?? pkg.yearlyPrice ?? 0);
      } else {
        amount = Number(service.startingPrice ?? 0);
      }
      revenueByCategory.set(service.categoryId, (revenueByCategory.get(service.categoryId) ?? 0) + amount);
    }
  }

  const mostRequestedServices = [...requestCountByService.entries()]
    .map(([serviceId, requestCount]) => ({
      serviceId,
      serviceName: serviceById.get(serviceId)?.serviceName ?? "Unknown",
      requestCount,
    }))
    .sort((a, b) => b.requestCount - a.requestCount)
    .slice(0, 10);

  const revenuePerCategory = [...revenueByCategory.entries()]
    .map(([categoryId, estimatedRevenue]) => ({
      categoryId,
      categoryName: categoryById.get(categoryId)?.name ?? "Unknown",
      estimatedRevenue,
    }))
    .sort((a, b) => b.estimatedRevenue - a.estimatedRevenue);

  const mostPopularPackageEntry = [...requestCountByPackage.entries()].sort((a, b) => b[1] - a[1])[0];
  const mostPopularPackage = mostPopularPackageEntry
    ? {
        packageId: mostPopularPackageEntry[0],
        packageName: packageById.get(mostPopularPackageEntry[0])?.packageName ?? "Unknown",
        requestCount: mostPopularPackageEntry[1],
      }
    : null;

  // Average delivery time: parse leading integer out of estimatedDelivery strings like "3-5 days"
  const deliveryDays: number[] = [];
  for (const r of requests) {
    const service = serviceById.get(r.serviceId);
    const match = service?.estimatedDelivery?.match(/(\d+)/);
    if (match) deliveryDays.push(parseInt(match[1], 10));
  }
  const averageDeliveryTimeDays = deliveryDays.length
    ? Math.round((deliveryDays.reduce((a, b) => a + b, 0) / deliveryDays.length) * 10) / 10
    : null;

  const totalRequests = requests.length;
  const conversionRate = totalRequests > 0 ? Math.round((completed / totalRequests) * 1000) / 10 : 0;

  // ── Funnel counts ──
  const countByStatus = new Map<string, number>();
  for (const r of requests) countByStatus.set(r.status, (countByStatus.get(r.status) ?? 0) + 1);

  const countForStatuses = (...statuses: string[]) =>
    statuses.reduce((sum, s) => sum + (countByStatus.get(s) ?? 0), 0);

  const briefCompletedCount = countForStatuses("brief_completed", "pricing_calculated", "quotation_ready", "waiting_customer_approval", "approved", "waiting_commercial_gate", "in_progress", "orchestrating", "pending", "waiting_review", "completed", "converted_to_project");
  const quotationReadyCount = countForStatuses("quotation_ready", "waiting_customer_approval", "approved", "waiting_commercial_gate", "in_progress", "orchestrating", "pending", "waiting_review", "completed", "converted_to_project");
  const approvedCount = countForStatuses("approved", "waiting_commercial_gate", "in_progress", "orchestrating", "pending", "waiting_review", "completed", "converted_to_project");
  const projectCount = countForStatuses("completed", "converted_to_project", "in_progress", "orchestrating", "waiting_review");

  const briefCompletionRate = totalRequests > 0 ? Math.round((briefCompletedCount / totalRequests) * 1000) / 10 : 0;
  const quotationApprovalRate = quotationReadyCount > 0 ? Math.round((approvedCount / quotationReadyCount) * 1000) / 10 : 0;
  const approvalToPaymentRate = approvedCount > 0 ? Math.round((projectCount / approvedCount) * 1000) / 10 : 0;
  const requestToProjectRate = totalRequests > 0 ? Math.round((projectCount / totalRequests) * 1000) / 10 : 0;

  // Average quotation value from total field
  const totals = requests.map((r) => parseFloat(r.total ?? "0")).filter((n) => n > 0);
  const averageQuotationValue = totals.length > 0 ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null;

  // Average time to approval (days)
  const approvalTimes: number[] = [];
  for (const r of requests) {
    if (r.status === "approved" || r.status === "converted_to_project") {
      const created = new Date(r.createdAt).getTime();
      const updated = new Date(r.updatedAt).getTime();
      if (updated > created) {
        approvalTimes.push((updated - created) / 86_400_000);
      }
    }
  }
  const averageTimeToApprovalDays = approvalTimes.length > 0
    ? Math.round((approvalTimes.reduce((a, b) => a + b, 0) / approvalTimes.length) * 10) / 10
    : null;

  const funnelCounts = {
    // Include "quoted" (legacy status) in newRequests for backward compat
    newRequests: countForStatuses("draft", "quoted"),
    briefInProgress: countForStatuses("brief_in_progress"),
    briefCompleted: countForStatuses("brief_completed", "pricing_calculated"),
    quotationReady: countForStatuses("quotation_ready"),
    waitingApproval: countForStatuses("waiting_customer_approval"),
    approved: countForStatuses("approved"),
    inProduction: countForStatuses("in_progress", "orchestrating", "pending", "waiting_review"),
    completed: countForStatuses("completed", "converted_to_project"),
  };

  // averageQuotationValue: only count requests that reached quotation stage or later
  const quotationStageTotals = requests
    .filter((r) => ["quotation_ready", "waiting_customer_approval", "waiting_commercial_gate", "approved", "in_progress", "orchestrating", "pending", "waiting_review", "completed", "converted_to_project"].includes(r.status))
    .map((r) => parseFloat(r.total ?? "0"))
    .filter((n) => n > 0);
  const correctedAverageQuotationValue = quotationStageTotals.length > 0
    ? Math.round(quotationStageTotals.reduce((a, b) => a + b, 0) / quotationStageTotals.length)
    : averageQuotationValue; // fall back to all-requests value

  res.json({
    mostRequestedServices,
    revenuePerCategory,
    averageDeliveryTimeDays,
    mostPopularPackage,
    conversionRate,
    totalRequests,
    completedRequests: completed,
    briefCompletionRate,
    quotationApprovalRate,
    approvalToPaymentRate,
    requestToProjectRate,
    averageQuotationValue: correctedAverageQuotationValue,
    averageTimeToApprovalDays,
    funnelCounts,
  });
});

// ── Public: start brief (draft → brief_in_progress) ──────────────────────────

router.patch("/public/catalog/requests/:requestId/start-brief", async (req, res): Promise<void> => {
  const { requestId } = req.params as { requestId: string };
  if (!requestId || requestId.length < 8) {
    res.status(400).json({ error: "Invalid requestId" });
    return;
  }

  const [existing] = await db
    .select({ id: aiServiceRequestsTable.id, status: aiServiceRequestsTable.status })
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.requestId, requestId))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Service request not found" });
    return;
  }

  const TERMINAL = new Set(["completed", "cancelled", "converted_to_project", "rejected", "expired"]);
  if (TERMINAL.has(existing.status)) {
    res.status(409).json({ error: `Cannot start brief on ${existing.status} request` });
    return;
  }

  // Only advance from draft; idempotent if already further along
  if (existing.status !== "draft") {
    res.json({ ok: true, status: existing.status });
    return;
  }

  const [updated] = await db
    .update(aiServiceRequestsTable)
    .set({ status: "brief_in_progress", updatedAt: new Date() })
    .where(and(eq(aiServiceRequestsTable.id, existing.id), eq(aiServiceRequestsTable.status, "draft")))
    .returning({ requestId: aiServiceRequestsTable.requestId, status: aiServiceRequestsTable.status });

  res.json({ ok: true, status: updated?.status ?? "brief_in_progress" });
});

// ── Public: get service request by UUID (customer-facing, no admin auth) ──────

router.get("/public/catalog/requests/:requestId", async (req, res): Promise<void> => {
  const { requestId } = req.params as { requestId: string };
  if (!requestId || requestId.length < 8) {
    res.status(400).json({ error: "Invalid requestId" });
    return;
  }

  const [row] = await db
    .select()
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.requestId, requestId))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Service request not found" });
    return;
  }

  const [service] = await db
    .select({ serviceFlow: aiServicesTable.serviceFlow })
    .from(aiServicesTable)
    .where(eq(aiServicesTable.id, row.serviceId))
    .limit(1);

  // Return customer-safe fields only (no margin/cost/internal pricing)
  const snapshot = row.pricingSnapshotJson as Record<string, unknown> | null;
  res.json({
    id: row.id,
    requestId: row.requestId,
    serviceId: row.serviceId,
    serviceFlow: service?.serviceFlow ?? "custom_project",
    createdProjectId: row.createdProjectId ?? null,
    packageId: row.packageId,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    companyName: row.companyName,
    currency: row.currency,
    // Keep individual fee columns for backward compat
    subtotal: row.subtotal,
    rushFee: row.rushFee,
    revisionFee: row.revisionFee,
    humanReviewFee: row.humanReviewFee,
    additionalServiceFee: row.additionalServiceFee,
    discount: row.discount,
    tax: row.tax,
    total: row.total,
    status: row.status,
    briefJson: row.briefJson,
    completionNotes: row.completionNotes ?? null,
    completionLinks: row.completionLinks ?? null,
    createdAt: row.createdAt,
    // Customer-facing breakdown: lineItems + basePrice from snapshot so
    // the portal can render an accurate itemised breakdown without
    // needing to re-derive values from the individual fee columns.
    pricingBreakdown: snapshot
      ? {
          basePrice: snapshot["basePrice"] ?? null,
          lineItems: snapshot["lineItems"] ?? [],
          taxPercent: snapshot["taxPercent"] ?? 0,
        }
      : null,
  });
});

// ── Public: update brief by UUID ──────────────────────────────────────────────

router.put("/public/catalog/requests/:requestId/brief", async (req, res): Promise<void> => {
  const { requestId } = req.params as { requestId: string };
  if (!requestId || requestId.length < 8) {
    res.status(400).json({ error: "Invalid requestId" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const brief = body.brief;
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
    res.status(400).json({ error: "brief object is required" });
    return;
  }

  const [existing] = await db
    .select({ id: aiServiceRequestsTable.id, status: aiServiceRequestsTable.status })
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.requestId, requestId))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Service request not found" });
    return;
  }

  const TERMINAL = new Set(["completed", "cancelled", "converted_to_project"]);
  if (TERMINAL.has(existing.status)) {
    res.status(409).json({ error: `Cannot update brief on ${existing.status} request` });
    return;
  }

  const [updated] = await db
    .update(aiServiceRequestsTable)
    .set({
      briefJson: brief as Record<string, unknown>,
      status: "brief_completed",
      updatedAt: new Date(),
    })
    .where(eq(aiServiceRequestsTable.id, existing.id))
    .returning({ requestId: aiServiceRequestsTable.requestId, status: aiServiceRequestsTable.status });

  await logAudit("catalog", "brief_updated", requestId, "ai_service_request", "success", {});

  res.json({ ok: true, status: updated.status });
});

// ── Public: Standard (fixed_price) checkout ───────────────────────────────────
// POST /public/catalog/requests/:requestId/checkout
//
// Only valid for services with service_flow = 'fixed_price'. Never creates an
// ai_quotations row (the enterprise/custom flow owns quotations). Creates the
// creative_project immediately (status: waiting_payment) plus its payment
// schedule (full_payment or deposit+remaining_balance per the package's
// payment_policy) — actual AI production only starts once payment clears,
// see paymentScheduleService.verifyPayment().

router.post("/public/catalog/requests/:requestId/checkout", async (req, res): Promise<void> => {
  const { requestId } = req.params as { requestId: string };
  if (!requestId || requestId.length < 8) {
    res.status(400).json({ error: "Invalid requestId" });
    return;
  }

  const [request] = await db
    .select()
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.requestId, requestId))
    .limit(1);
  if (!request) { res.status(404).json({ error: "Service request not found" }); return; }

  if (request.createdProjectId) {
    res.json({ ok: true, alreadyCreated: true, createdProjectId: request.createdProjectId, status: request.status });
    return;
  }

  const TERMINAL = new Set(["completed", "cancelled", "converted_to_project", "rejected", "expired"]);
  if (TERMINAL.has(request.status)) {
    res.status(409).json({ error: `Cannot checkout a ${request.status} request` });
    return;
  }
  if (request.status !== "brief_completed" && request.status !== "pricing_calculated") {
    res.status(409).json({ error: "Complete the brief before checkout" });
    return;
  }

  const [service] = await db.select().from(aiServicesTable).where(eq(aiServicesTable.id, request.serviceId)).limit(1);
  if (!service) { res.status(404).json({ error: "Service not found" }); return; }
  if (service.serviceFlow !== "fixed_price") {
    res.status(409).json({ error: "This service requires a quotation — use the Enterprise/Custom flow" });
    return;
  }

  let pkg: typeof aiServicePackagesTable.$inferSelect | null = null;
  if (request.packageId != null) {
    const [row] = await db.select().from(aiServicePackagesTable).where(eq(aiServicePackagesTable.id, request.packageId)).limit(1);
    pkg = row ?? null;
  }
  const paymentPolicy = (pkg?.paymentPolicy ?? "full_payment") as PaymentPolicy;
  const depositPercentage = pkg?.depositPercentage ?? 50;

  const brief = (request.briefJson ?? {}) as Record<string, string>;
  const newProjectId = randomUUID();
  const now = new Date();
  const [project] = await db
    .insert(creativeProjectsTable)
    .values({
      projectId: newProjectId,
      sourceType: "service_catalog",
      serviceRequestId: request.id,
      brandName: request.companyName ?? request.customerName,
      businessType: brief.companyIndustry ?? service.department ?? "general",
      targetMarket: brief.audienceDemographics ?? "general",
      productOrService: brief.outputFormats ?? service.serviceName,
      stylePreference: brief.stylePreference ?? null,
      colorPreference: brief.colorPalette ?? null,
      referenceLinks: brief.referenceLinks ?? null,
      goal: brief.primaryGoal ?? `${service.serviceName} — Standard checkout`,
      notes: request.notes ?? null,
      deadline: brief.deadline ?? null,
      status: "waiting_payment",
      paymentPolicy,
      depositPercentage,
      paymentStatus: "pending",
    })
    .returning();

  const schedule = await generateScheduleForProject({
    projectId: project.id,
    paymentPolicy,
    depositPercentage,
    totalAmount: Number(request.total) || 0,
    currency: request.currency,
  });

  await db
    .update(aiServiceRequestsTable)
    .set({ status: "waiting_commercial_gate", createdProjectId: newProjectId, updatedAt: now })
    .where(eq(aiServiceRequestsTable.id, request.id));

  await logAudit("catalog", "checkout_created", String(request.id), "ai_service_request", "success", {
    projectId: newProjectId,
    paymentPolicy,
    total: request.total,
  });

  publishSafe({
    eventType: "project.checkout_created",
    sourceModule: "catalog",
    sourceId: newProjectId,
    payload: { serviceRequestId: request.id, projectId: newProjectId, paymentPolicy },
  });

  res.status(201).json({
    ok: true,
    createdProjectId: newProjectId,
    paymentPolicy,
    schedule,
  });
});

export default router;
