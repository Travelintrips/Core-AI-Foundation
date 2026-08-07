import { Router, type Request, type Response } from "express";
import { uuidParamSchema } from "@workspace/api-zod";
import { resolvePlacementTenantId } from "../security/tenantResolution.js";
import { PlacementEngineError } from "../services/placementEngineService.js";
import { applyPlacement, suggestPlacement } from "../services/placementRuleEngineService.js";

const router = Router();

function tenantId(req: Request): string {
  return resolvePlacementTenantId(req);
}

function sessionId(value: string | undefined, res: Response): string | null {
  const parsed = uuidParamSchema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "INVALID_UUID", message: "sessionId must be a valid UUID." } });
    return null;
  }
  return parsed.data;
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof PlacementEngineError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
}

router.post("/ai/layout-sessions/:sessionId/suggest-placement", async (req, res) => {
  try {
    const id = sessionId(req.params["sessionId"], res);
    if (!id) return;
    res.json(await suggestPlacement(id, tenantId(req), req.body));
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/ai/layout-sessions/:sessionId/apply-placement", async (req, res) => {
  try {
    const id = sessionId(req.params["sessionId"], res);
    if (!id) return;
    res.json(await applyPlacement(id, tenantId(req), req.body));
  } catch (error) {
    handleError(error, res);
  }
});

export default router;