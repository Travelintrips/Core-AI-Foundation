import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { assertDevelopmentDatabaseIsolation, pool } from "@workspace/db";
import { requireAuth, requireInternalRole, requirePasswordChanged } from "../middleware/internalAuth.js";
import { requireAgentServiceScope } from "../middleware/agentServiceAuth.js";
import { ReleaseError, releaseCredentialBinding, task189Target } from "../services/task189ReleaseMandate.js";
import { task189Release, type ReleaseAction } from "../services/task189ReleaseRegistry.js";

const router = Router();
const origin = "https://dev.cstlogistic.co.id";
const root = "/ai/agent-runtime/dev/task189-release";
const id = z.string().uuid();
const grantBody = z.object({ mandate: z.record(z.string(), z.unknown()), signature: z.string().length(86) }).strict();
const grantIdBody = z.object({ grantId: id }).strict();
const redeemBody = grantIdBody.extend({ permitId: id }).strict();
const admin = [requireAuth, requireInternalRole("owner", "admin"), requirePasswordChanged];
const mutation: RequestHandler = (req,res,next) => {
  if (req.headers.origin !== origin || !req.is("application/json")) {
    res.status(403).json({ error: "SAME_ORIGIN_JSON_REQUIRED" }); return;
  }
  next();
};
router.use(root, (req,res,next) => {
  res.setHeader("Cache-Control","no-store");
  if (process.env["APP_ENV"] !== "development" || req.hostname !== new URL(origin).hostname ||
      process.env["CST_DEV_TASK189_DELEGATION_ENABLED"] !== "true") {
    res.sendStatus(404); return;
  }
  try {
    // Verify the pool used by this process, independently of request headers and later env changes.
    assertDevelopmentDatabaseIsolation(pool.options.connectionString ?? "", {
      APP_ENV: "development", SUPABASE_URL_DEV: `https://${task189Target.project}.supabase.co`,
    });
  } catch { res.status(503).json({ error: "DEV_DATABASE_UNVERIFIED" }); return; }
  next();
});

function handle(action: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => ReleaseAction): RequestHandler {
  return async (req,res) => {
    try {
      const result = await task189Release(action(req,res), process.env["CST_DEV_TASK189_REGISTRAR_PUBLIC_DER_B64"]);
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) { res.status(400).json({ error: "INVALID_REQUEST" }); return; }
      if (err instanceof ReleaseError) { res.status(err.status).json({ error: err.message }); return; }
      res.status(503).json({ error: "RELEASE_REGISTRY_UNAVAILABLE" });
    }
  };
}
router.get(root, ...admin, handle(req => ({ kind: "inspect", admin: { userId: req.internalUser!.id } })));
router.post(root+"/register", ...admin, mutation, handle(req => ({
  kind: "register", admin: { userId: req.internalUser!.id }, ...grantBody.parse(req.body),
})));
router.post(root+"/revoke", ...admin, mutation, handle(req => ({
  kind: "revoke", admin: { userId: req.internalUser!.id }, ...grantIdBody.parse(req.body),
})));
router.post(root+"/redeem", ...admin, mutation, handle(req => ({
  kind: "redeem", admin: { userId: req.internalUser!.id }, ...redeemBody.parse(req.body),
})));
router.post(root+"/issue", requireAgentServiceScope("agent:work", releaseCredentialBinding), handle((req,res) => {
  const service = res.locals["aiAgentService"];
  if (!service || service.name !== task189Target.principal || !service.credentialBinding)
    throw new ReleaseError(403, "DELEGATE_IDENTITY_MISMATCH");
  return { kind: "issue", ...grantIdBody.parse(req.body),
    worker: { id: service.id, name: service.name, binding: service.credentialBinding } };
}));
export default router;
