import { Router } from "express";
import {
  listAffiliates, createAffiliate, updateAffiliate,
  recordClick, recordConversion, getAffiliateStats,
} from "../services/affiliateService";

const router = Router();

// GET /ai/affiliates
router.get("/ai/affiliates", async (_req, res): Promise<void> => {
  const affiliates = await listAffiliates();
  res.json({ items: affiliates, total: affiliates.length });
});

// POST /ai/affiliates
router.post("/ai/affiliates", async (req, res): Promise<void> => {
  const { name, email, affiliateCode, commissionRate } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: "name and email are required" });
    return;
  }

  const affiliate = await createAffiliate({
    name,
    email,
    affiliateCode: affiliateCode ?? undefined,
    commissionRate: commissionRate ? parseInt(String(commissionRate), 10) : 10,
    status: "active",
  });

  res.status(201).json(affiliate);
});

// PATCH /ai/affiliates/:id
router.patch("/ai/affiliates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updated = await updateAffiliate(id, req.body);
  if (!updated) { res.status(404).json({ error: "Affiliate not found" }); return; }
  res.json(updated);
});

// GET /ai/affiliates/:id/stats
router.get("/ai/affiliates/:id/stats", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const stats = await getAffiliateStats(id);
  if (!stats) { res.status(404).json({ error: "Affiliate not found" }); return; }
  res.json(stats);
});

// POST /ai/affiliates/track-click  (called from customer-portal)
router.post("/ai/affiliates/track-click", async (req, res): Promise<void> => {
  const { affiliateCode, visitorId, sessionId, landingPage, device, country } = req.body;
  if (!affiliateCode) {
    res.status(400).json({ error: "affiliateCode is required" });
    return;
  }

  const affiliates = await listAffiliates();
  const affiliate = affiliates.find((a) => a.affiliateCode === affiliateCode);
  if (!affiliate) { res.status(404).json({ error: "Affiliate not found" }); return; }

  const clickId = await recordClick({
    affiliateId: affiliate.id,
    visitorId, sessionId, landingPage, device, country,
  });

  res.json({ ok: true, clickId });
});

// POST /ai/affiliates/track-conversion
router.post("/ai/affiliates/track-conversion", async (req, res): Promise<void> => {
  const { affiliateId, clickId, serviceRequestId, orderAmount } = req.body;
  if (!affiliateId || !orderAmount) {
    res.status(400).json({ error: "affiliateId and orderAmount are required" });
    return;
  }

  await recordConversion({
    affiliateId: parseInt(String(affiliateId), 10),
    clickId: clickId ? parseInt(String(clickId), 10) : undefined,
    serviceRequestId: serviceRequestId ? parseInt(String(serviceRequestId), 10) : undefined,
    orderAmount: parseInt(String(orderAmount), 10),
  });

  res.json({ ok: true });
});

export default router;
