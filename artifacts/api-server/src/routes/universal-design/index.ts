/**
 * Team 10 — Universal Design API: Route Handlers
 * Branch: feature/team-10-core-api-contracts
 *
 * Implements the 10-endpoint Universal Design API boundary.
 * Handlers are thin: validate → authorize → service → map → audit/error.
 *
 * Route prefix (mounted in routes/index.ts): /ai/design/v1
 *
 * Endpoints:
 *   GET  /ai/design/v1/plugins/:pluginId/manifest        — plugin manifest (public)
 *   GET  /ai/design/v1/projects/:id/config               — project config
 *   GET  /ai/design/v1/projects/:id                      — project overview
 *   PUT  /ai/design/v1/projects/:id/brief                — submit / update brief
 *   POST /ai/design/v1/projects/:id/initialize           — initialize workflow
 *   POST /ai/design/v1/projects/:id/commands             — execute command
 *   GET  /ai/design/v1/projects/:id/stages               — list stages
 *   GET  /ai/design/v1/projects/:id/artifacts            — list artifacts (paginated)
 *   GET  /ai/design/v1/projects/:id/events               — list events (paginated)
 *   POST /ai/design/v1/projects/:id/review               — request review
 *
 * Authorization model:
 *   - Admin routes: require ADMIN_API_KEY (enforced by global adminAuthWithExceptions)
 *   - Customer GET routes: require X-Design-Access-Token header
 *     (added to PUBLIC_ROUTE_RULES to bypass admin key check, validated in handler)
 *   - Plugin manifest: fully public (safe projection, no sensitive data)
 *
 * TEAM 10 OWNED — do not modify outside feature/team-10-core-api-contracts.
 */

import { Router } from "express";
import {
  PluginIdParams,
  DesignProjectIdParams,
  PaginationQuery,
  SubmitBriefBody,
  InitializeWorkflowBody,
  ProjectCommandBody,
  RequestReviewBody,
  PluginManifestResponse,
  DesignProjectConfigResponse,
  DesignProjectOverviewResponse,
  SubmitBriefResponse,
  InitializeWorkflowResponse,
  ProjectCommandResponse,
  ListStagesResponse,
  ListArtifactsResponse,
  ListEventsResponse,
  RequestReviewResponse,
  errorResponse,
} from "./schemas.js";
import {
  resolvePluginManifest,
  getProjectConfig,
  getProjectOverview,
  submitBrief,
  initializeWorkflow,
  executeCommand,
  listStages,
  listArtifacts,
  listProjectEvents,
  requestReview,
  checkProjectAccess,
} from "./universalDesignFacade.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract correlation ID from request headers, or generate one. */
function correlationId(req: import("express").Request): string {
  return (req.headers["x-correlation-id"] as string | undefined) ?? `ud-${Date.now()}`;
}

/** Returns true when the request carries valid admin credentials.
 *
 * Path 1 (preferred for browser admins): req.internalUser is populated by the
 * centralized adminAuth middleware after it verifies the session cookie against
 * the database. This is the ONLY trusted source of session identity — never
 * trust role data from req.body, req.query, or raw req.session.
 *
 * Path 2 (server-to-server compat only): ADMIN_API_KEY in Authorization or
 * x-admin-api-key header. Kept for internal service calls; browsers should use
 * the session cookie instead.
 */
function isAdmin(req: import("express").Request): boolean {
  // Path 1: validated internal user session (set by adminAuth middleware)
  if ((req as unknown as Record<string, unknown>).internalUser) return true;
  // Path 2: ADMIN_API_KEY header (server-to-server compat only)
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return false;
  const bearer = req.headers["authorization"];
  if (typeof bearer === "string" && bearer === `Bearer ${adminKey}`) return true;
  const header = req.headers["x-admin-api-key"];
  if (header === adminKey) return true;
  return false;
}

/** Returns the X-Design-Access-Token if present. */
function designAccessToken(req: import("express").Request): string | undefined {
  return req.headers["x-design-access-token"] as string | undefined;
}

// ── 1. Plugin manifest (public) ───────────────────────────────────────────────

router.get("/ai/design/v1/plugins/:pluginId/manifest", (req, res): void => {
  const cid = correlationId(req);
  const params = PluginIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", params.error.message));
    return;
  }

  const manifest = resolvePluginManifest(params.data.pluginId);
  if (!manifest) {
    res.status(404).json(errorResponse("PLUGIN_NOT_SUPPORTED", `Plugin '${params.data.pluginId}' is not registered`));
    return;
  }

  res.setHeader("X-Correlation-Id", cid);
  res.json(PluginManifestResponse.parse(manifest));
});

// ── 2. Project config ─────────────────────────────────────────────────────────

router.get("/ai/design/v1/projects/:id/config", async (req, res): Promise<void> => {
  const cid = correlationId(req);
  const params = DesignProjectIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", params.error.message));
    return;
  }

  const accessError = checkProjectAccess(params.data.id, isAdmin(req), designAccessToken(req));
  if (accessError) {
    res.status(403).json(errorResponse("FORBIDDEN", accessError));
    return;
  }

  const config = await getProjectConfig(params.data.id);
  if (!config) {
    res.status(404).json(errorResponse("NOT_FOUND", "Design project not found"));
    return;
  }

  res.setHeader("X-Correlation-Id", cid);
  res.json(DesignProjectConfigResponse.parse(config));
});

// ── 3. Project overview ───────────────────────────────────────────────────────

router.get("/ai/design/v1/projects/:id", async (req, res): Promise<void> => {
  const cid = correlationId(req);
  const params = DesignProjectIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", params.error.message));
    return;
  }

  const accessError = checkProjectAccess(params.data.id, isAdmin(req), designAccessToken(req));
  if (accessError) {
    res.status(403).json(errorResponse("FORBIDDEN", accessError));
    return;
  }

  const overview = await getProjectOverview(params.data.id);
  if (!overview) {
    res.status(404).json(errorResponse("NOT_FOUND", "Design project not found"));
    return;
  }

  res.setHeader("X-Correlation-Id", cid);
  res.json(DesignProjectOverviewResponse.parse(overview));
});

// ── 4. Submit / update brief ──────────────────────────────────────────────────

router.put("/ai/design/v1/projects/:id/brief", async (req, res): Promise<void> => {
  const cid = correlationId(req);
  const params = DesignProjectIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", params.error.message));
    return;
  }

  const body = SubmitBriefBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", body.error.message));
    return;
  }

  const accessError = checkProjectAccess(params.data.id, isAdmin(req), designAccessToken(req));
  if (accessError) {
    res.status(403).json(errorResponse("FORBIDDEN", accessError));
    return;
  }

  const result = await submitBrief(
    params.data.id,
    body.data.fields,
    body.data.idempotencyKey,
    cid,
  );

  if (!result) {
    res.status(404).json(errorResponse("NOT_FOUND", "Design project not found"));
    return;
  }

  res.setHeader("X-Correlation-Id", cid);
  res.status(body.data.idempotencyKey ? 200 : 200).json(SubmitBriefResponse.parse(result));
});

// ── 5. Initialize workflow ────────────────────────────────────────────────────

router.post("/ai/design/v1/projects/:id/initialize", async (req, res): Promise<void> => {
  const cid = correlationId(req);
  const params = DesignProjectIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", params.error.message));
    return;
  }

  const body = InitializeWorkflowBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", body.error.message));
    return;
  }

  // Workflow initialization is admin / platform-only
  if (!isAdmin(req)) {
    res.status(401).json(errorResponse("UNAUTHORIZED", "Admin credentials required"));
    return;
  }

  const result = await initializeWorkflow(
    params.data.id,
    body.data.workflowId,
    body.data.priority,
    body.data.idempotencyKey,
    cid,
  );

  if (!result) {
    res.status(404).json(errorResponse("NOT_FOUND", "Design project not found"));
    return;
  }

  res.setHeader("X-Correlation-Id", cid);
  const parsed = InitializeWorkflowResponse.parse(result);
  res.status(parsed.status === "initialized" ? 201 : 200).json(parsed);
});

// ── 6. Execute command ────────────────────────────────────────────────────────

router.post("/ai/design/v1/projects/:id/commands", async (req, res): Promise<void> => {
  const cid = correlationId(req);
  const params = DesignProjectIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", params.error.message));
    return;
  }

  const body = ProjectCommandBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", body.error.message));
    return;
  }

  const accessError = checkProjectAccess(params.data.id, isAdmin(req), designAccessToken(req));
  if (accessError) {
    res.status(403).json(errorResponse("FORBIDDEN", accessError));
    return;
  }

  const result = await executeCommand(
    params.data.id,
    body.data.command,
    body.data.payload,
    body.data.idempotencyKey,
    cid,
  );

  if (!result) {
    res.status(404).json(errorResponse("NOT_FOUND", "Design project not found"));
    return;
  }

  const parsed = ProjectCommandResponse.parse(result);
  if (parsed.status === "conflict") {
    res.status(409).json(errorResponse("IDEMPOTENCY_CONFLICT", parsed.conflictReason ?? "Duplicate idempotency key"));
    return;
  }
  if (parsed.status === "rejected") {
    res.status(422).json(errorResponse("PLUGIN_NOT_SUPPORTED", parsed.conflictReason ?? "Command not supported"));
    return;
  }

  res.setHeader("X-Correlation-Id", cid);
  res.status(202).json(parsed);
});

// ── 7. List stages ────────────────────────────────────────────────────────────

router.get("/ai/design/v1/projects/:id/stages", async (req, res): Promise<void> => {
  const cid = correlationId(req);
  const params = DesignProjectIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", params.error.message));
    return;
  }

  const query = PaginationQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", query.error.message));
    return;
  }

  const accessError = checkProjectAccess(params.data.id, isAdmin(req), designAccessToken(req));
  if (accessError) {
    res.status(403).json(errorResponse("FORBIDDEN", accessError));
    return;
  }

  const result = await listStages(params.data.id, query.data.page, query.data.pageSize);
  if (!result) {
    res.status(404).json(errorResponse("NOT_FOUND", "Design project not found"));
    return;
  }

  res.setHeader("X-Correlation-Id", cid);
  res.json(ListStagesResponse.parse(result));
});

// ── 8. List artifacts ─────────────────────────────────────────────────────────

router.get("/ai/design/v1/projects/:id/artifacts", async (req, res): Promise<void> => {
  const cid = correlationId(req);
  const params = DesignProjectIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", params.error.message));
    return;
  }

  const query = PaginationQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", query.error.message));
    return;
  }

  const accessError = checkProjectAccess(params.data.id, isAdmin(req), designAccessToken(req));
  if (accessError) {
    res.status(403).json(errorResponse("FORBIDDEN", accessError));
    return;
  }

  const result = await listArtifacts(params.data.id, query.data.page, query.data.pageSize);
  if (!result) {
    res.status(404).json(errorResponse("NOT_FOUND", "Design project not found"));
    return;
  }

  res.setHeader("X-Correlation-Id", cid);
  res.json(ListArtifactsResponse.parse(result));
});

// ── 9. List events ────────────────────────────────────────────────────────────

router.get("/ai/design/v1/projects/:id/events", async (req, res): Promise<void> => {
  const cid = correlationId(req);
  const params = DesignProjectIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", params.error.message));
    return;
  }

  const query = PaginationQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", query.error.message));
    return;
  }

  const accessError = checkProjectAccess(params.data.id, isAdmin(req), designAccessToken(req));
  if (accessError) {
    res.status(403).json(errorResponse("FORBIDDEN", accessError));
    return;
  }

  const result = await listProjectEvents(params.data.id, query.data.page, query.data.pageSize);
  if (!result) {
    res.status(404).json(errorResponse("NOT_FOUND", "Design project not found"));
    return;
  }

  res.setHeader("X-Correlation-Id", cid);
  res.json(ListEventsResponse.parse(result));
});

// ── 10. Request review ────────────────────────────────────────────────────────

router.post("/ai/design/v1/projects/:id/review", async (req, res): Promise<void> => {
  const cid = correlationId(req);
  const params = DesignProjectIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", params.error.message));
    return;
  }

  const body = RequestReviewBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json(errorResponse("VALIDATION_ERROR", body.error.message));
    return;
  }

  // Review creation is admin-only (token is sensitive — issued once and not persisted plaintext)
  if (!isAdmin(req)) {
    res.status(401).json(errorResponse("UNAUTHORIZED", "Admin credentials required to create review links"));
    return;
  }

  const result = await requestReview(
    params.data.id,
    body.data.type,
    body.data.notes,
    body.data.clientName,
    body.data.clientEmail,
    body.data.idempotencyKey,
    cid,
  );

  if (!result) {
    res.status(404).json(errorResponse("NOT_FOUND", "Design project not found"));
    return;
  }

  res.setHeader("X-Correlation-Id", cid);
  res.status(201).json(RequestReviewResponse.parse(result));
});

export default router;
