/**
 * creative-commercial/routes/index.ts — Team 03
 *
 * Router barrel for the Creative Commercial Automation domain.
 *
 * Mount point: /ai/creative-commercial
 * (registered by Team 24 into the global route registry — see integration manifest)
 *
 * This file MUST NOT import from routes/index.ts or app.ts.
 * Team 24 will mount this router.
 */

import { Router } from "express";
import recommendationsRouter from "./recommendations.js";
import funnelRouter from "./funnel.js";
import attributionRouter from "./attribution.js";

const router = Router();

// All sub-routes share the /ai/creative-commercial prefix
router.use(recommendationsRouter);
router.use(funnelRouter);
router.use(attributionRouter);

export default router;
