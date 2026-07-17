/**
 * creative-commercial/routes/index.ts — Team 03
 *
 * Router barrel for the Creative Commercial Automation domain.
 *
 * Mount point: /ai/creative-commercial
 * (registered by Team 24 into the global route registry — see integration manifest)
 *
 * Audit remediation (Global Remediation Rules):
 *   - Explicit adminAuth applied at router-level (P1-Security finding)
 *   - Global adminAuthWithExceptions also covers these routes, but belt-and-suspenders
 *     is required when the sub-router may be mounted independently.
 *
 * This file MUST NOT import from routes/index.ts or app.ts.
 * Team 24 will mount this router.
 */

import { Router } from "express";
import { adminAuth, adminAuthWithExceptions } from "../../middleware/adminAuth.js";
import recommendationsRouter from "./recommendations.js";
import funnelRouter from "./funnel.js";
import attributionRouter from "./attribution.js";

const router = Router();

// Belt-and-suspenders auth — use adminAuthWithExceptions so that /public/* routes
// that are mounted AFTER this barrel in the global router are not blocked.
// adminAuth is still applied for all /ai/* routes via the exception logic.
router.use(adminAuthWithExceptions);

// All sub-routes share the /ai/creative-commercial prefix
router.use(recommendationsRouter);
router.use(funnelRouter);
router.use(attributionRouter);

export default router;
