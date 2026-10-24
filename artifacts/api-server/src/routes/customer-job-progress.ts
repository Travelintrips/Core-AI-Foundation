import { Router } from "express";
import { z } from "zod";
import { resolveVerifiedCustomerIdentityFromWorkspaceToken } from "../services/customerWorkspaceIdentityBinding.js";
import { resolveVerifiedCustomerJobProgress } from "../services/verifiedCustomerJobProgress.js";
import { listScopedCustomerJobs } from "../services/scopedCustomerJobs.js";

const router = Router();
const Payload = z.object({ message: z.string().trim().min(1).max(1000) }).strict();

/** Existing Customer Workspace dashboard token is verified server side.
 * Never accept customer_id/company_id/user_id in request JSON.
 */
router.post("/public/customer/workspace/:token/job-progress-query", async (req, res): Promise<void> => {
  const parsed = Payload.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid message payload" }); return; }
  try {
    const identity = await resolveVerifiedCustomerIdentityFromWorkspaceToken(String(req.params.token ?? ""));
    if (!identity) { res.status(403).json({ error: "Customer tenant membership not uniquely verified" }); return; }
    const result = await resolveVerifiedCustomerJobProgress({
      message: parsed.data.message,
      identity,
      listJobsForCustomer: listScopedCustomerJobs,
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  } catch {
    res.status(503).json({ error: "Customer job progress temporarily unavailable" });
  }
});
export default router;
