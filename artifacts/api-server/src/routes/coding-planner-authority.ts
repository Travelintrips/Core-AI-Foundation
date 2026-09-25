import { Router, type Response } from "express";
import { z } from "zod";
import {
  acquirePlannerAuthority,
  assertPlannerAuthority,
  getPlannerAuthority,
  PlannerAuthorityError,
  renewPlannerAuthority,
} from "../services/localCodingPlannerAuthorityService.js";

const router = Router();
const scopeSchema = z.string().min(1).max(200).default("global");
const holderSchema = z.object({
  scope: scopeSchema.optional(),
  holderId: z.string().min(1).max(200),
  holderType: z.enum(["chatgpt", "fallback"]),
  leaseSeconds: z.number().int().min(30).max(300).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
const fenceSchema = z.object({
  scope: scopeSchema.optional(),
  holderId: z.string().min(1).max(200),
  leaseToken: z.string().uuid(),
  fencingGeneration: z.number().int().positive(),
}).strict();

function known(res: Response, error: unknown) {
  if (!(error instanceof PlannerAuthorityError)) return false;
  res.status(["AUTHORITY_HELD", "STALE_FENCE", "LEASE_EXPIRED", "NOT_HOLDER"].includes(error.code) ? 409 : 422)
    .json({ error: error.message, code: error.code });
  return true;
}

router.post("/ai/coding/planner-authority/acquire", async (req, res): Promise<void> => {
  const p = holderSchema.safeParse(req.body ?? {});
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  try { res.status(201).json(await acquirePlannerAuthority(p.data)); }
  catch (error) { if (known(res, error)) return; throw error; }
});

router.post("/ai/coding/planner-authority/renew", async (req, res): Promise<void> => {
  const p = fenceSchema.extend({ leaseSeconds: z.number().int().min(30).max(300).optional() }).safeParse(req.body ?? {});
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  try { res.json(await renewPlannerAuthority(p.data)); }
  catch (error) { if (known(res, error)) return; throw error; }
});

router.post("/ai/coding/planner-authority/assert", async (req, res): Promise<void> => {
  const p = fenceSchema.safeParse(req.body ?? {});
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  try { res.json(await assertPlannerAuthority(p.data)); }
  catch (error) { if (known(res, error)) return; throw error; }
});

router.get("/ai/coding/planner-authority", async (req, res): Promise<void> => {
  const p = scopeSchema.safeParse(req.query["scope"] ?? "global");
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  res.json(await getPlannerAuthority(p.data));
});

export default router;
