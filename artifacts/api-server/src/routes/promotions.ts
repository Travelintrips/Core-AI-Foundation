import { Router } from "express";
import {
  listPromotions, createPromotion, updatePromotion, deletePromotion,
  getApplicablePromotions,
} from "../services/promotionService";

const router = Router();

// GET /ai/promotions
router.get("/ai/promotions", async (req, res): Promise<void> => {
  const includeExpired = req.query.includeExpired === "true";
  const promotions = await listPromotions(includeExpired);
  res.json({ items: promotions, total: promotions.length });
});

// GET /ai/promotions/applicable
router.get("/ai/promotions/applicable", async (req, res): Promise<void> => {
  const serviceId = req.query.serviceId ? parseInt(String(req.query.serviceId), 10) : undefined;
  const packageId = req.query.packageId ? parseInt(String(req.query.packageId), 10) : undefined;
  const industry = req.query.industry ? String(req.query.industry) : undefined;
  const promotions = await getApplicablePromotions({ serviceId, packageId, industry });
  res.json({ items: promotions, total: promotions.length });
});

// POST /ai/promotions
router.post("/ai/promotions", async (req, res): Promise<void> => {
  const { name, description, discountType, discountValue, benefitLabel, serviceId,
    packageId, industry, startDate, endDate, usageLimit } = req.body;

  if (!name || !discountType) {
    res.status(400).json({ error: "name and discountType are required" });
    return;
  }

  const VALID_TYPES = ["percentage","fixed","free_revision","free_source_file","free_consultation","bundle"];
  if (!VALID_TYPES.includes(discountType)) {
    res.status(400).json({ error: `discountType must be one of: ${VALID_TYPES.join(", ")}` });
    return;
  }

  const promotion = await createPromotion({
    name, description, discountType, discountValue, benefitLabel,
    serviceId, packageId, industry,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    usageLimit,
    status: "active",
  });

  res.status(201).json(promotion);
});

// PATCH /ai/promotions/:id
router.patch("/ai/promotions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updated = await updatePromotion(id, req.body);
  if (!updated) { res.status(404).json({ error: "Promotion not found" }); return; }
  res.json(updated);
});

// DELETE /ai/promotions/:id
router.delete("/ai/promotions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const deleted = await deletePromotion(id);
  if (!deleted) { res.status(404).json({ error: "Promotion not found" }); return; }
  res.json({ ok: true });
});

export default router;
