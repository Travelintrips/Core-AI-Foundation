import { Router } from "express";
import { getOrCreateReferral, listReferrals, convertReferral, getReferralStats } from "../services/referralService";

const router = Router();

const getBaseUrl = (req: { headers: { host?: string }; protocol: string }) => {
  if (process.env["PUBLIC_APP_URL"]) return process.env["PUBLIC_APP_URL"].replace(/\/$/, "");
  if (process.env["REPLIT_DEV_DOMAIN"]) return `https://${process.env["REPLIT_DEV_DOMAIN"]}`;
  return `${req.protocol}://${req.headers.host}`;
};

// GET /ai/referrals
router.get("/ai/referrals", async (req, res): Promise<void> => {
  const referrerProfileId = req.query.referrerProfileId
    ? parseInt(String(req.query.referrerProfileId), 10)
    : undefined;
  const referrals = await listReferrals(referrerProfileId ? { referrerProfileId } : undefined);
  res.json({ items: referrals, total: referrals.length });
});

// POST /ai/referrals/generate — create or return existing referral for a customer
router.post("/ai/referrals/generate", async (req, res): Promise<void> => {
  const { customerProfileId } = req.body;
  if (!customerProfileId) {
    res.status(400).json({ error: "customerProfileId is required" });
    return;
  }

  const referral = await getOrCreateReferral(
    parseInt(String(customerProfileId), 10),
    getBaseUrl(req as Parameters<typeof getBaseUrl>[0]),
  );

  res.json(referral);
});

// POST /ai/referrals/convert
router.post("/ai/referrals/convert", async (req, res): Promise<void> => {
  const { code, refereeProfileId } = req.body;
  if (!code || !refereeProfileId) {
    res.status(400).json({ error: "code and refereeProfileId are required" });
    return;
  }

  const result = await convertReferral(String(code), parseInt(String(refereeProfileId), 10));
  if (!result) {
    res.status(422).json({ error: "Referral not found, already converted, or self-referral detected" });
    return;
  }

  res.json(result);
});

// GET /ai/referrals/stats/:profileId
router.get("/ai/referrals/stats/:profileId", async (req, res): Promise<void> => {
  const profileId = parseInt(req.params.profileId, 10);
  if (isNaN(profileId)) { res.status(400).json({ error: "Invalid profileId" }); return; }

  const stats = await getReferralStats(profileId);
  res.json(stats);
});

export default router;
