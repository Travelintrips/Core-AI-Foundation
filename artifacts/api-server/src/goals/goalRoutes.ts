/**
 * goals/goalRoutes.ts — Goal Taxonomy API
 *
 * Public endpoints (no auth):
 *   GET  /ai/goals                    — list active goals
 *   GET  /ai/goals/:slug              — single goal metadata
 *   GET  /ai/goals/:slug/services     — goal + mapped services
 *
 * Admin endpoints (ADMIN_API_KEY required via global adminAuthWithExceptions):
 *   POST   /ai/goals                          — create goal
 *   PATCH  /ai/goals/:slug                    — update goal
 *   POST   /ai/goals/:slug/services           — map a service to a goal
 *   DELETE /ai/goals/:slug/services/:serviceId — unmap a service
 *   POST   /ai/goals/:slug/services/bulk      — bulk map by service codes
 *
 * NOTE: Route prefix must NOT include /api — that prefix is added by app.ts.
 */
import { Router, type Request, type Response } from "express";
import * as goalService from "./goalService.js";
import {
  GoalNotFoundError,
  GoalConflictError,
  GoalValidationError,
  MappingConflictError,
} from "./goalService.js";

const router = Router();

// ── Error handler helper ──────────────────────────────────────────────────────

function handleError(res: Response, err: unknown): void {
  if (err instanceof GoalNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof GoalConflictError || err instanceof MappingConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof GoalValidationError) {
    res.status(400).json({ error: err.message, field: err.field });
    return;
  }
  console.error("[goalRoutes] unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
}

// ── Public: List goals ────────────────────────────────────────────────────────

/**
 * GET /ai/goals
 *
 * Query params:
 *   withChildren=true   — nest child goals under their parent (tree view)
 *   rootOnly=true       — return only top-level goals (flat)
 */
router.get("/ai/goals", async (req: Request, res: Response) => {
  try {
    const withChildren = req.query["withChildren"] === "true";
    const rootOnly     = req.query["rootOnly"] === "true";

    const goals = await goalService.listGoals({ withChildren, rootOnly });
    res.json({ goals });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Public: Single goal ───────────────────────────────────────────────────────

/**
 * GET /ai/goals/:slug
 */
router.get("/ai/goals/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const goal = await goalService.getGoal(slug);
    res.json({ goal });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Public: Goal + services ───────────────────────────────────────────────────

/**
 * GET /ai/goals/:slug/services
 *
 * Returns the goal metadata AND the list of services mapped to it,
 * ordered by display_order + relevance_score descending.
 */
router.get("/ai/goals/:slug/services", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const result = await goalService.getGoalWithServices(slug);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Create goal ────────────────────────────────────────────────────────

/**
 * POST /ai/goals
 *
 * Body: { slug, name, description?, icon?, parentGoalId?, displayOrder?, status?, metadataJson? }
 */
router.post("/ai/goals", async (req: Request, res: Response) => {
  try {
    const { slug, name, description, icon, parentGoalId, displayOrder, status, metadataJson } =
      req.body as Record<string, unknown>;

    if (!slug || typeof slug !== "string") {
      res.status(400).json({ error: "slug is required", field: "slug" });
      return;
    }
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required", field: "name" });
      return;
    }

    const goal = await goalService.createGoal({
      slug,
      name,
      description: typeof description === "string" ? description : undefined,
      icon: typeof icon === "string" ? icon : undefined,
      parentGoalId: typeof parentGoalId === "number" ? parentGoalId : undefined,
      displayOrder: typeof displayOrder === "number" ? displayOrder : undefined,
      status: status as "active" | "draft" | undefined,
      metadataJson: metadataJson as Record<string, unknown> | undefined,
    });

    res.status(201).json({ goal });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Update goal ────────────────────────────────────────────────────────

/**
 * PATCH /ai/goals/:slug
 *
 * Body: any subset of { name, description, icon, parentGoalId, displayOrder, status, metadataJson }
 */
router.patch("/ai/goals/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { name, description, icon, parentGoalId, displayOrder, status, metadataJson } =
      req.body as Record<string, unknown>;

    const goal = await goalService.updateGoal(slug, {
      name: typeof name === "string" ? name : undefined,
      description: typeof description === "string" ? description : undefined,
      icon: typeof icon === "string" ? icon : undefined,
      parentGoalId:
        parentGoalId === null
          ? null
          : typeof parentGoalId === "number"
          ? parentGoalId
          : undefined,
      displayOrder: typeof displayOrder === "number" ? displayOrder : undefined,
      status: status as "active" | "draft" | "archived" | undefined,
      metadataJson: metadataJson as Record<string, unknown> | undefined,
    });

    res.json({ goal });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Map service to goal ────────────────────────────────────────────────

/**
 * POST /ai/goals/:slug/services
 *
 * Body: { serviceId, relevanceScore?, isPrimary?, displayOrder? }
 */
router.post("/ai/goals/:slug/services", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { serviceId, relevanceScore, isPrimary, displayOrder } =
      req.body as Record<string, unknown>;

    if (!serviceId || typeof serviceId !== "number") {
      res.status(400).json({ error: "serviceId (number) is required", field: "serviceId" });
      return;
    }

    const result = await goalService.addServiceToGoal(slug, {
      serviceId,
      relevanceScore: typeof relevanceScore === "number" ? relevanceScore : undefined,
      isPrimary: typeof isPrimary === "boolean" ? isPrimary : undefined,
      displayOrder: typeof displayOrder === "number" ? displayOrder : undefined,
    });

    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Bulk map service codes to goal ─────────────────────────────────────

/**
 * POST /ai/goals/:slug/services/bulk
 *
 * Body: { mappings: Array<{ serviceCode, relevanceScore?, isPrimary? }> }
 * Uses service codes (not IDs) — easier for seed scripts.
 */
router.post("/ai/goals/:slug/services/bulk", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };
    const { mappings } = req.body as { mappings?: unknown[] };

    if (!Array.isArray(mappings) || mappings.length === 0) {
      res.status(400).json({ error: "mappings array is required and must not be empty" });
      return;
    }

    const result = await goalService.bulkMapServiceCodesToGoal(slug, mappings as any);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── Admin: Unmap service from goal ────────────────────────────────────────────

/**
 * DELETE /ai/goals/:slug/services/:serviceId
 */
router.delete("/ai/goals/:slug/services/:serviceId", async (req: Request, res: Response) => {
  try {
    const { slug, serviceId } = req.params as { slug: string; serviceId: string };
    const id = parseInt(serviceId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "serviceId must be a valid integer" });
      return;
    }

    const deleted = await goalService.removeServiceFromGoal(slug, id);
    if (!deleted) {
      res.status(404).json({ error: "Mapping not found" });
      return;
    }

    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
