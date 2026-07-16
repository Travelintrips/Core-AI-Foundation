/**
 * creative-workflow-v2 — Router
 *
 * Mounts all Team 1 sub-routers under their respective paths.
 *
 * Integration note for Team 24:
 *   Mount this router in the main route registry under:
 *     app.use("/api/ai/creative-workflow/v2", creativeWorkflowV2Router)
 *
 *   Then call setDefinitionResolver() to inject the DB-backed definition store.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import { Router } from "express";
import { definitionsRouter } from "./definitions.js";
import { plansRouter } from "./plans.js";

export const creativeWorkflowV2Router = Router();

creativeWorkflowV2Router.use("/definitions", definitionsRouter);
creativeWorkflowV2Router.use("/plans",       plansRouter);

// Re-export resolver hook for Team 24 wiring
export { setDefinitionResolver } from "./plans.js";
