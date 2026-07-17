// Team 10 — Design Tokens combined router
// INTEGRATION NOTE (Team 24):
//   Mount this router at: app.use("/api/ai/design-tokens", adminAuth, designTokensRouter)
//   Or without adminAuth for public read endpoints if desired.

import { Router } from "express";
import fontPairsRouter from "./fontPairsRouter.js";
import colorPalettesRouter from "./colorPalettesRouter.js";
import {
  getIndustryRecommendation,
  listAllIndustries,
} from "../../services/design-tokens/industryRecommendationService.js";

const router = Router();

// Sub-routers
router.use("/font-pairs", fontPairsRouter);
router.use("/color-palettes", colorPalettesRouter);

// ── GET /design-tokens/industries ────────────────────────────────────────────
router.get("/industries", (_req, res) => {
  const industries = listAllIndustries();
  res.json({ data: industries });
});

// ── GET /design-tokens/industries/:industry ───────────────────────────────────
router.get("/industries/:industry", (req, res) => {
  const rec = getIndustryRecommendation(req.params.industry as any);
  res.json(rec);
});

// ── GET /design-tokens/health ─────────────────────────────────────────────────
router.get("/health", (_req, res) => {
  res.json({ status: "ok", domain: "design-tokens", team: 10 });
});

export { router as designTokensRouter };
export default router;
