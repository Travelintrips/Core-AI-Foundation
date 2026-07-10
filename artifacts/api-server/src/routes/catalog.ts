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
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  aiServiceCategoriesTable,
  aiServicesTable,
  aiServicePackagesTable,
  aiServiceRequestsTable,
  aiServicePriceRulesTable,
  insertAiServiceCategorySchema,
  insertAiServiceSchema,
  insertAiServicePackageSchema,
  insertAiServiceRequestSchema,
  insertAiServicePriceRuleSchema,
} from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";
import { generatePricingSnapshot, toCustomerFacingBreakdown, type PricingSelections } from "../services/aiPricingService.js";

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
      status: "quoted",
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
  const [row] = await db
    .update(aiServiceRequestsTable)
    .set({ status, createdProjectId: createdProjectId ?? undefined, updatedAt: new Date() })
    .where(eq(aiServiceRequestsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Request not found" }); return; }
  await logAudit("catalog", "update_request_status", String(id), "ai_service_request", "success", { status });
  res.json(row);
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

  res.json({
    mostRequestedServices,
    revenuePerCategory,
    averageDeliveryTimeDays,
    mostPopularPackage,
    conversionRate,
    totalRequests,
    completedRequests: completed,
  });
});

export default router;
