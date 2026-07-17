/**
 * creative-workflow-v2 — Router
 *
 * Mounts all Team 1 sub-routers under their respective paths.
 *
 * Integration note for Team 24:
 *   1. Mount the ADMIN router:
 *        app.use("/api/ai/creative-workflow/v2", adminAuthWithExceptions, creativeWorkflowV2Router)
 *
 *   2. Mount the PUBLIC progress handler BEFORE adminAuthWithExceptions,
 *      OR add "/api/ai/creative-workflow/v2/public" to PUBLIC_PATH_PREFIXES
 *      in middleware/adminAuth.ts so it bypasses the admin key check:
 *        app.use("/api/ai/creative-workflow/v2", creativeWorkflowPublicRouter)
 *
 *   3. Wire injection hooks:
 *        setDefinitionResolver(fn)      — DB-backed definition lookup
 *        setContextTokenResolver(fn)    — customer token → { contextId, contextType }
 *        setPublicPlanReader(fn)        — contextId → ExecutionPlan[] (filtered)
 *
 * Auth boundaries:
 *   - /definitions/* and /plans/* → admin-only (explicit adminAuth in each router)
 *   - /public/progress             → token-only (no admin key; token resolved server-side)
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import { Router } from "express";
import { definitionsRouter } from "./definitions.js";
import { plansRouter } from "./plans.js";
import { publicProgressRouter } from "./publicProgress.js";

// ── Admin router (definitions + plans — both require admin auth) ──────────────
export const creativeWorkflowV2Router = Router();

creativeWorkflowV2Router.use("/definitions", definitionsRouter);
creativeWorkflowV2Router.use("/plans",       plansRouter);

// ── Public router (progress — token auth, no admin key) ──────────────────────
// Mount this router separately from the admin router so it is reachable
// without an admin API key. See integration notes above.
export const creativeWorkflowPublicRouter = Router();

creativeWorkflowPublicRouter.use(publicProgressRouter);

// ── Re-export injection hooks for Team 24 wiring ─────────────────────────────
export { setDefinitionResolver }            from "./plans.js";
export { setContextTokenResolver, setPublicPlanReader } from "./publicProgress.js";
