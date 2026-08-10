/**
 * WP-07 — Layout Constraint Engine routes.
 *
 * Mounted under the authenticated /api router. Paths intentionally omit the
 * app-level /api prefix.
 */
import { Router, type Request, type Response } from "express";
import { uuidParamSchema, wp07ConstraintRequestSchema, wp07ConstraintResultSchema } from "@workspace/api-zod";
import { resolvePlacementTenantId } from "../security/tenantResolution.js";
import { PlacementEngineError } from "../services/placementEngineService.js";
import { evaluateLayoutSessionConstraints } from "../services/layoutConstraintEngineService.js";

const router = Router();

function handleError(error: unknown, res: Response): void {
  if (error instanceof PlacementEngineError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
}

router.post("/ai/layout-sessions/:sessionId/constraints/evaluate", async (req: Request, res: Response) => {
  const parsedId = uuidParamSchema.safeParse(req.params["sessionId"]);
  if (!parsedId.success) {
    res.status(400).json({ error: { code: "INVALID_UUID", message: "sessionId must be a valid UUID." } });
    return;
  }
  const parsedBody = wp07ConstraintRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid constraint evaluation request.", details: parsedBody.error.issues } });
    return;
  }
  try {
    const result = await evaluateLayoutSessionConstraints(parsedId.data, resolvePlacementTenantId(req));
    const response = wp07ConstraintResultSchema.safeParse(result);
    if (!response.success) {
      res.status(500).json({ error: { code: "RESPONSE_VALIDATION_ERROR", message: "Constraint evaluation returned an invalid response." } });
      return;
    }
    res.json(response.data);
  } catch (error) {
    handleError(error, res);
  }
});

export default router;