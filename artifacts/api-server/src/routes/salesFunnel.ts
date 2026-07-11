import { Router } from "express";
import { trackFunnelEvent, getFunnelAnalytics } from "../services/funnelEventService";

const router = Router();

// POST /ai/funnel/track
router.post("/ai/funnel/track", async (req, res): Promise<void> => {
  const { eventType, visitorId, customerId, sessionId, serviceId, portfolioId, projectId,
    packageId, campaignId, utmSource, utmMedium, utmCampaign, device, country, metadata } = req.body;

  if (!eventType) { res.status(400).json({ error: "eventType is required" }); return; }

  const VALID_TYPES = [
    "portfolio_view","portfolio_open","preview_start","preview_complete",
    "package_select","checkout","payment","project_created","project_completed",
    "repeat_order","referral","affiliate",
  ];
  if (!VALID_TYPES.includes(eventType)) {
    res.status(400).json({ error: `Invalid eventType. Must be one of: ${VALID_TYPES.join(", ")}` });
    return;
  }

  await trackFunnelEvent({
    eventType, visitorId, customerId, sessionId, serviceId, portfolioId, projectId,
    packageId, campaignId, utmSource, utmMedium, utmCampaign, device, country,
    metadata: metadata ?? {},
  });

  res.json({ ok: true });
});

// GET /ai/funnel/analytics
router.get("/ai/funnel/analytics", async (req, res): Promise<void> => {
  const days = Math.min(parseInt(String(req.query.days ?? 30), 10) || 30, 365);
  const data = await getFunnelAnalytics(days);
  res.json(data);
});

export default router;
