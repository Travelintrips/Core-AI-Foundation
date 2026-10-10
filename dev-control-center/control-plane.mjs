/**
 * DEV Control Center control-plane router, fail-closed by design.
 * Mount only behind an established authenticated session middleware.
 * Adapters must be wired to REAL verified backend systems before enabling.
 * No production deploy happens in this module.
 */
import { Router } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";

const STATES = new Set(["QUEUED", "RUNNING", "BLOCKED", "FAILED", "COMPLETED", "CANCELLED"]);
const ACTIONS = new Set(["stop", "restart", "retry"]);
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const SAFE_SHA = /^[0-9a-f]{40}$/;
const KEY = /^[a-zA-Z0-9_-]{16,128}$/;

export function validateSeparation(dev, prod) {
  const fields = ["databaseId", "credentialId", "namespace", "storageBucket"];
  const issues = [];
  for (const field of fields) {
    if (!dev?.[field] || !prod?.[field]) issues.push("missing_" + field);
    else if (dev[field] === prod[field]) issues.push("shared_" + field);
  }
  if (!dev?.environment || dev.environment !== "dev") issues.push("invalid_dev_environment");
  if (!prod?.environment || prod.environment !== "prod") issues.push("invalid_prod_environment");
  return { safe: issues.length === 0, issues };
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createDevCenterRouter({ getPrincipal, adapter, config, audit }) {
  if (typeof getPrincipal !== "function" || !adapter || typeof audit !== "function") {
    throw new Error("Authenticated principal, adapter and audit sink required");
  }
  const router = Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const principal = getPrincipal(req);
    if (!principal || !SAFE_ID.test(String(principal.id || ""))) return res.sendStatus(401);
    req.devPrincipal = principal;
    next();
  });
  router.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const expected = req.devPrincipal?.csrfToken;
      if (!safeEqual(req.get("x-csrf-token"), expected) || !expected) return res.sendStatus(403);
    }
    next();
  });
  const ensureRole = (role) => (req, res, next) => {
    if (!req.devPrincipal?.roles?.includes(role)) return res.sendStatus(403);
    next();
  };
  const fail = (res, e) => {
    // Never expose internal error details or secrets.
    res.status(503).json({ error: "CONTROL_PLANE_UNAVAILABLE" });
  };
  router.get("/separation", ensureRole("dev.read"), (req, res) => {
    // Provided from independently resolved infrastructure identities, not browser values.
    const status = validateSeparation(config?.dev, config?.prod);
    res.json({ ...status, verified: Boolean(config?.verifiedAt), verifiedAt: config?.verifiedAt || null });
  });
  router.get("/jobs", ensureRole("dev.read"), async (req, res) => {
    if (typeof adapter.listJobs !== "function") return res.sendStatus(503);
    try {
      const jobs = await adapter.listJobs({ principal: req.devPrincipal, limit: 50 });
      const safe = (Array.isArray(jobs) ? jobs : []).slice(0, 50).filter(j => SAFE_ID.test(String(j.id)) && STATES.has(j.status));
      res.json({ jobs: safe.map(j => ({ id:j.id, application:j.application, status:j.status, updatedAt:j.updatedAt, correlationId:j.correlationId })) });
    } catch (e) { fail(res,e); }
  });
  router.get("/jobs/:id/events", ensureRole("dev.read"), async (req, res) => {
    if (!SAFE_ID.test(req.params.id)) return res.sendStatus(400);
    if (typeof adapter.listEvents !== "function") return res.sendStatus(503);
    try {
      const events = await adapter.listEvents({ id:req.params.id, principal:req.devPrincipal, limit:100 });
      res.json({ events:(Array.isArray(events)?events:[]).slice(-100).map(e=>({ id:e.id, state:e.state, message:String(e.message||"").slice(0,500), at:e.at })) });
    } catch (e) { fail(res,e); }
  });
  router.post("/jobs/:id/actions", ensureRole("dev.control"), async (req, res) => {
    const { id } = req.params, { action } = req.body || {};
    const key = req.get("idempotency-key");
    if (!SAFE_ID.test(id) || !ACTIONS.has(action) || !KEY.test(key || "")) return res.sendStatus(400);
    if (typeof adapter.requestAction !== "function") return res.sendStatus(503);
    try {
      const result = await adapter.requestAction({ id, action, key, principal:req.devPrincipal });
      await audit({ kind:"job.action", principalId:req.devPrincipal.id, id, action, key, requestId:randomUUID() });
      res.status(202).json({ accepted:true, requestId:result?.requestId || null, status:"REQUESTED_NOT_COMPLETED" });
    } catch (e) { fail(res,e); }
  });
  router.post("/releases/:id/approve", ensureRole("prod.approve"), async (req, res) => {
    const { id } = req.params, { commitSha, environment, confirmation } = req.body || {};
    const key = req.get("idempotency-key");
    if (!SAFE_ID.test(id) || !SAFE_SHA.test(commitSha || "") || environment !== "production" ||
        confirmation !== "APPROVE_PRODUCTION" || !KEY.test(key || "")) return res.sendStatus(400);
    const isolation = validateSeparation(config?.dev, config?.prod);
    if (!config?.verifiedAt || !isolation.safe) return res.status(409).json({error:"ISOLATION_NOT_VERIFIED"});
    if (typeof adapter.checkReleaseGates !== "function" || typeof adapter.recordApproval !== "function") return res.sendStatus(503);
    try {
      const gates = await adapter.checkReleaseGates({ id, commitSha, principal:req.devPrincipal });
      if (!gates || !gates.allRequiredPassed || !gates.securityPassed || !gates.productionTargetVerified)
        return res.status(409).json({error:"RELEASE_GATES_NOT_PASSED"});
      // An approval record is NOT an instruction to deploy.
      const approved = await adapter.recordApproval({ id, commitSha, key, principal:req.devPrincipal });
      await audit({ kind:"release.approval", principalId:req.devPrincipal.id, id, commitSha, key });
      res.status(202).json({ approvalId:approved?.id || null, status:"APPROVED_NOT_DEPLOYED" });
    } catch (e) { fail(res,e); }
  });
  return router;
}
