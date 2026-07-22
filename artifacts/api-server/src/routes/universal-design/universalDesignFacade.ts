/**
 * Team 10 — Universal Design API: Application Facade
 *
 * Thin service layer between route handlers and underlying engines.
 * Route handlers call this facade; the facade calls existing services
 * (designStudioService, client-review DB, event bus, audit).
 *
 * DEPENDENCY NOTES (Teams 01–09 working in parallel):
 *   - Workflow initialization delegates to existing AI job engine.
 *     If a deeper workflow engine contract becomes available from Team 01,
 *     wire it via setWorkflowInitializer() below.
 *   - Stage tracking is derived from aiDesignVersions + canvasState for now.
 *     TODO: wire to Team 01 ExecutionPlan when merged.
 *   - Event/activity feed is derived from ai_audit_logs.
 *     TODO: wire to canonical event adapter (phase-v41) when available.
 *   - Design access token resolution is currently stub-only.
 *     TODO: wire to customer token service when Team 02 portal token work merges.
 */

import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { db, aiDesignProjects, aiDesignVersions, creativeAiClientReviewsTable } from "@workspace/db";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { logAudit } from "../../services/aiAuditService.js";
import { publishSafe } from "../../services/aiEventBusService.js";
import { getPluginManifest, inferPluginId, type PluginManifest } from "./pluginRegistry.js";

// ── Idempotency store (in-process, TTL = 10 min) ─────────────────────────────
// TODO: replace with a DB-backed store (ai_idempotency_keys table) for
//       multi-process / restartable durability.

interface IdempotencyRecord {
  result: unknown;
  expiresAt: number;
}
const idempotencyStore = new Map<string, IdempotencyRecord>();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function checkIdempotency(key: string): unknown | undefined {
  const record = idempotencyStore.get(key);
  if (!record) return undefined;
  if (Date.now() > record.expiresAt) {
    idempotencyStore.delete(key);
    return undefined;
  }
  return record.result;
}

function saveIdempotency(key: string, result: unknown): void {
  idempotencyStore.set(key, { result, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

// ── Ports / interfaces for downstream wiring ──────────────────────────────────

/**
 * Port for workflow initialization.
 * TODO: implement and inject from Team 01 creative-workflow-v2 engine.
 */
export interface WorkflowInitializer {
  initialize(params: {
    projectId: number;
    workflowId: string;
    priority: "low" | "normal" | "high";
    correlationId: string;
  }): Promise<{ jobId: string | null; alreadyRunning: boolean }>;
}

let _workflowInitializer: WorkflowInitializer | null = null;

export function setWorkflowInitializer(impl: WorkflowInitializer): void {
  _workflowInitializer = impl;
}

// ── Authorization helpers ─────────────────────────────────────────────────────

/**
 * Verify caller has access to the given project.
 *
 * Access is granted when:
 *   1. Caller is an authenticated admin (isAdmin = true), OR
 *   2. A valid X-Design-Access-Token header matches the project's access token
 *      (TODO: resolve via customer token service — currently not implemented,
 *       so non-admin callers are always rejected with FORBIDDEN).
 *
 * Returns null on success, or an error message string.
 */
export function checkProjectAccess(
  projectId: number,
  isAdmin: boolean,
  _accessToken?: string,
): string | null {
  if (isAdmin) return null;
  // TODO: resolve _accessToken via customer token service (Team 02 port)
  void projectId;
  return "Access denied: provide a valid X-Design-Access-Token or admin credentials";
}

// ── 1. Plugin manifest ────────────────────────────────────────────────────────

export function resolvePluginManifest(pluginId: string): PluginManifest | null {
  return getPluginManifest(pluginId);
}

// ── 2. Project config ─────────────────────────────────────────────────────────

export async function getProjectConfig(projectId: number) {
  const [project] = await db
    .select()
    .from(aiDesignProjects)
    .where(eq(aiDesignProjects.id, projectId))
    .limit(1);

  if (!project) return null;

  const pluginId = inferPluginId(project.tags, project.name) ?? "graphic";
  const manifest = getPluginManifest(pluginId);
  if (!manifest) return null;

  // Derive current stage from the latest version label (stub; wire to workflow engine)
  const [latestVersion] = await db
    .select({ label: aiDesignVersions.label, versionNumber: aiDesignVersions.versionNumber })
    .from(aiDesignVersions)
    .where(eq(aiDesignVersions.projectId, projectId))
    .orderBy(desc(aiDesignVersions.versionNumber))
    .limit(1);

  return {
    projectId,
    pluginId,
    manifest,
    briefSchemaVersion: "v1",
    workflowStatus: project.status ?? null,
    currentStage: latestVersion?.label ?? null,
  };
}

// ── 3. Project overview ───────────────────────────────────────────────────────

export async function getProjectOverview(projectId: number) {
  const [project] = await db
    .select()
    .from(aiDesignProjects)
    .where(eq(aiDesignProjects.id, projectId))
    .limit(1);

  if (!project) return null;

  const pluginId = inferPluginId(project.tags, project.name);
  const [latestVersion] = await db
    .select({ label: aiDesignVersions.label })
    .from(aiDesignVersions)
    .where(eq(aiDesignVersions.projectId, projectId))
    .orderBy(desc(aiDesignVersions.versionNumber))
    .limit(1);

  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    pluginId,
    status: project.status,
    currentStage: latestVersion?.label ?? null,
    canvasWidth: project.canvasWidth,
    canvasHeight: project.canvasHeight,
    thumbnailUrl: project.thumbnailUrl ?? null,
    tags: project.tags ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

// ── 4. Submit / update brief ──────────────────────────────────────────────────

export async function submitBrief(
  projectId: number,
  fields: Record<string, unknown>,
  idempotencyKey: string | undefined,
  correlationId: string,
) {
  if (idempotencyKey) {
    const cached = checkIdempotency(`brief:${idempotencyKey}`);
    if (cached !== undefined) return cached;
  }

  const [project] = await db
    .select({ id: aiDesignProjects.id, status: aiDesignProjects.status, tags: aiDesignProjects.tags, name: aiDesignProjects.name, currentVersionId: aiDesignProjects.currentVersionId })
    .from(aiDesignProjects)
    .where(eq(aiDesignProjects.id, projectId))
    .limit(1);

  if (!project) return null;

  // Determine next version number
  const [versionCountRow] = await db
    .select({ cnt: count() })
    .from(aiDesignVersions)
    .where(eq(aiDesignVersions.projectId, projectId));

  const nextVersion = Number(versionCountRow?.cnt ?? 0) + 1;
  const briefId = randomUUID();

  // Save brief as a canvas version (label encodes brief snapshot ref)
  const [newVersion] = await db
    .insert(aiDesignVersions)
    .values({
      projectId,
      versionNumber: nextVersion,
      label: `brief:${briefId}`,
      canvasState: { briefId, fields, savedAt: new Date().toISOString() },
      elementCount: 0,
    })
    .returning({ id: aiDesignVersions.id, versionNumber: aiDesignVersions.versionNumber });

  await db
    .update(aiDesignProjects)
    .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
    .where(eq(aiDesignProjects.id, projectId));

  const result = {
    briefId,
    projectId,
    pluginId: inferPluginId(project.tags, project.name),
    status: (nextVersion === 1 ? "saved" : "updated") as "saved" | "updated",
    version: newVersion.versionNumber,
    savedAt: new Date().toISOString(),
  };

  await logAudit("universal-design", "submit_brief", String(projectId), "design_project", "success", {
    briefId,
    version: nextVersion,
    correlationId,
    fieldCount: Object.keys(fields).length,
  });

  publishSafe({
    eventType: "design.brief.submitted",
    sourceModule: "universal-design",
    sourceId: String(projectId),
    payload: { projectId, briefId, version: nextVersion, correlationId },
  });

  if (idempotencyKey) saveIdempotency(`brief:${idempotencyKey}`, result);
  return result;
}

// ── 5. Initialize workflow ────────────────────────────────────────────────────

export async function initializeWorkflow(
  projectId: number,
  workflowId: string,
  priority: "low" | "normal" | "high",
  idempotencyKey: string | undefined,
  correlationId: string,
) {
  if (idempotencyKey) {
    const cached = checkIdempotency(`init-workflow:${idempotencyKey}`);
    if (cached !== undefined) return cached;
  }

  const [project] = await db
    .select({ id: aiDesignProjects.id, status: aiDesignProjects.status })
    .from(aiDesignProjects)
    .where(eq(aiDesignProjects.id, projectId))
    .limit(1);

  if (!project) return null;

  // Guard: do not re-initialize an active project
  if (project.status === "active") {
    const result = {
      projectId,
      workflowId,
      status: "already_running" as const,
      jobId: null,
      message: "Workflow is already running for this project",
    };
    if (idempotencyKey) saveIdempotency(`init-workflow:${idempotencyKey}`, result);
    return result;
  }

  let jobId: string | null = null;

  if (_workflowInitializer) {
    // Wire to Team 01 workflow engine when available
    const outcome = await _workflowInitializer.initialize({ projectId, workflowId, priority, correlationId });
    jobId = outcome.jobId;
    if (outcome.alreadyRunning) {
      const result = { projectId, workflowId, status: "already_running" as const, jobId, message: "Workflow already running" };
      if (idempotencyKey) saveIdempotency(`init-workflow:${idempotencyKey}`, result);
      return result;
    }
  }
  // TODO: else fall back to AI job engine dispatch

  await db
    .update(aiDesignProjects)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(aiDesignProjects.id, projectId));

  await logAudit("universal-design", "initialize_workflow", String(projectId), "design_project", "success", {
    workflowId, priority, jobId, correlationId,
  });

  publishSafe({
    eventType: "design.workflow.initialized",
    sourceModule: "universal-design",
    sourceId: String(projectId),
    payload: { projectId, workflowId, priority, jobId, correlationId },
  });

  const result = {
    projectId,
    workflowId,
    status: "initialized" as const,
    jobId,
    message: "Workflow initialized successfully",
  };

  if (idempotencyKey) saveIdempotency(`init-workflow:${idempotencyKey}`, result);
  return result;
}

// ── 6. Execute command ────────────────────────────────────────────────────────

export async function executeCommand(
  projectId: number,
  command: string,
  payload: Record<string, unknown> | undefined,
  idempotencyKey: string,
  correlationId: string,
) {
  const cached = checkIdempotency(`cmd:${idempotencyKey}`);
  if (cached !== undefined) {
    return { ...cached as object, status: "conflict" as const, conflictReason: "Duplicate idempotency key" };
  }

  const [project] = await db
    .select({ id: aiDesignProjects.id, status: aiDesignProjects.status, tags: aiDesignProjects.tags, name: aiDesignProjects.name })
    .from(aiDesignProjects)
    .where(eq(aiDesignProjects.id, projectId))
    .limit(1);

  if (!project) return null;

  // Validate command is in the plugin's capability set
  const pluginId = inferPluginId(project.tags, project.name);
  const manifest = pluginId ? getPluginManifest(pluginId) : null;
  const VALID_COMMANDS = [
    "regenerate_element", "apply_style", "export_pdf", "export_zip",
    "apply_brand_dna", "lock_element", "unlock_element",
    "advance_stage", "revert_stage", "request_revision",
  ];

  if (!VALID_COMMANDS.includes(command) && !(manifest && command in manifest.capabilities)) {
    return {
      accepted: false,
      commandId: randomUUID(),
      idempotencyKey,
      status: "rejected" as const,
      conflictReason: `Command '${command}' is not supported by this project`,
    };
  }

  const commandId = randomUUID();

  await logAudit("universal-design", `command:${command}`, String(projectId), "design_project", "success", {
    commandId, command, idempotencyKey, correlationId, payloadKeys: Object.keys(payload ?? {}),
  });

  publishSafe({
    eventType: "design.command.executed",
    sourceModule: "universal-design",
    sourceId: String(projectId),
    payload: { projectId, commandId, command, correlationId },
  });

  const result = {
    accepted: true,
    commandId,
    idempotencyKey,
    status: "accepted" as const,
    resultSummary: { command, projectId, enqueuedAt: new Date().toISOString() },
  };

  saveIdempotency(`cmd:${idempotencyKey}`, result);
  return result;
}

// ── 7. List stages ────────────────────────────────────────────────────────────

export async function listStages(projectId: number, page: number, pageSize: number) {
  const [project] = await db
    .select({ id: aiDesignProjects.id, status: aiDesignProjects.status, tags: aiDesignProjects.tags, name: aiDesignProjects.name })
    .from(aiDesignProjects)
    .where(eq(aiDesignProjects.id, projectId))
    .limit(1);

  if (!project) return null;

  const pluginId = inferPluginId(project.tags, project.name) ?? "graphic";
  const manifest = getPluginManifest(pluginId);
  const stages = manifest?.stages ?? [];

  // Determine active stage from current project status
  // TODO: wire to Team 01 ExecutionPlan for per-stage status tracking
  const statusMap: Record<string, "pending" | "active" | "completed"> = {};
  const activeStageIdx = project.status === "active" ? 1 : project.status === "archived" ? stages.length : 0;
  stages.forEach((s, idx) => {
    statusMap[s.stageId] = idx < activeStageIdx ? "completed" : idx === activeStageIdx ? "active" : "pending";
  });

  const total = stages.length;
  const offset = (page - 1) * pageSize;
  const pageStages = stages.slice(offset, offset + pageSize);

  return {
    items: pageStages.map((s) => ({
      stageId: s.stageId,
      label: s.label,
      order: s.order,
      status: statusMap[s.stageId] ?? "pending",
      startedAt: null,
      completedAt: null,
    })),
    total,
    page,
    pageSize,
    hasMore: offset + pageSize < total,
  };
}

// ── 8. List artifacts ─────────────────────────────────────────────────────────

export async function listArtifacts(projectId: number, page: number, pageSize: number) {
  const [project] = await db
    .select({ id: aiDesignProjects.id })
    .from(aiDesignProjects)
    .where(eq(aiDesignProjects.id, projectId))
    .limit(1);

  if (!project) return null;

  // Artifacts are sourced from design versions — each version is a snapshot artifact.
  // TODO: when creative_ai_assets with design_project_id FK is available, merge both sources.
  const [totalRow] = await db
    .select({ cnt: count() })
    .from(aiDesignVersions)
    .where(eq(aiDesignVersions.projectId, projectId));

  const total = Number(totalRow?.cnt ?? 0);
  const offset = (page - 1) * pageSize;

  const rows = await db
    .select()
    .from(aiDesignVersions)
    .where(eq(aiDesignVersions.projectId, projectId))
    .orderBy(desc(aiDesignVersions.versionNumber))
    .limit(pageSize)
    .offset(offset);

  return {
    items: rows.map((v) => ({
      id: v.id,
      type: "canvas_version",
      label: v.label ?? null,
      version: v.versionNumber,
      url: null,           // TODO: generate signed URL when storage integration available
      thumbnailUrl: null,
      status: "available",
      mimeType: null,
      createdAt: v.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    hasMore: offset + pageSize < total,
  };
}

// ── 9. List events / activity ─────────────────────────────────────────────────

export async function listProjectEvents(projectId: number, page: number, pageSize: number) {
  const [project] = await db
    .select({ id: aiDesignProjects.id })
    .from(aiDesignProjects)
    .where(eq(aiDesignProjects.id, projectId))
    .limit(1);

  if (!project) return null;

  // Derive events from ai_audit_logs for this project entity.
  // TODO: wire to canonical event adapter (phase-v41) when merged.
  const auditResult = await db.execute(
    sql`SELECT id, action, status, metadata, created_at
        FROM ai_platform.ai_audit_logs
        WHERE entity_id = ${String(projectId)} AND entity_type = 'design_project'
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
  );

  const countResult = await db.execute(
    sql`SELECT COUNT(*)::int AS cnt FROM ai_platform.ai_audit_logs
        WHERE entity_id = ${String(projectId)} AND entity_type = 'design_project'`,
  );

  // db.execute returns a QueryResult — cast to array via unknown for portability
  const rows = (auditResult as unknown as Array<Record<string, unknown>>);
  const countRows = (countResult as unknown as Array<Record<string, unknown>>);
  const total = Number(countRows[0]?.cnt ?? 0);

  return {
    items: rows.map((r) => ({
      eventId: String(r.id),
      eventType: String(r.action ?? ""),
      actorRole: "admin",   // Redacted: never expose raw email / internal user ID
      summary: String(r.action ?? ""),
      metadata: null,       // Safe projection: strip internal metadata
      occurredAt: r.created_at instanceof Date
        ? (r.created_at as Date).toISOString()
        : String(r.created_at ?? ""),
    })),
    total,
    page,
    pageSize,
    hasMore: (page - 1) * pageSize + rows.length < total,
  };
}

// ── 10. Request review ────────────────────────────────────────────────────────

export async function requestReview(
  projectId: number,
  type: "approval" | "revision",
  notes: string | undefined,
  clientName: string | undefined,
  clientEmail: string | undefined,
  idempotencyKey: string | undefined,
  correlationId: string,
) {
  if (idempotencyKey) {
    const cached = checkIdempotency(`review:${idempotencyKey}`);
    if (cached !== undefined) return cached;
  }

  const [project] = await db
    .select({ id: aiDesignProjects.id, status: aiDesignProjects.status })
    .from(aiDesignProjects)
    .where(eq(aiDesignProjects.id, projectId))
    .limit(1);

  if (!project) return null;

  // Delegate to existing review service table — preserves token security model.
  // The plain token is returned once to the caller; only the hash is stored.
  const plainToken = randomUUID();
  const reviewTokenHash = createHash("sha256").update(plainToken).digest("hex");
  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [review] = await db
    .insert(creativeAiClientReviewsTable)
    .values({
      projectId: String(projectId),
      reviewTokenHash,
      tokenExpiresAt,
      clientName: clientName ?? "",   // schema requires notNull; empty string for anonymous requests
      clientEmail: clientEmail ?? null,
      status: "shared",
      sharedAt: new Date(),
    })
    .returning({ id: creativeAiClientReviewsTable.id });

  await logAudit("universal-design", `request_review:${type}`, String(projectId), "design_project", "success", {
    reviewId: review.id, type, correlationId,
  });

  publishSafe({
    eventType: "design.review.requested",
    sourceModule: "universal-design",
    sourceId: String(projectId),
    payload: { projectId, reviewId: review.id, type, correlationId },
  });

  const result = {
    reviewId: review.id,
    reviewToken: plainToken,
    reviewUrl: null as string | null, // TODO: derive from REPLIT_DEV_DOMAIN or PUBLIC_APP_URL env
    status: "created" as const,
    message: type === "approval"
      ? "Review link created. Share the reviewToken with the client."
      : "Revision review link created.",
  };

  if (idempotencyKey) saveIdempotency(`review:${idempotencyKey}`, result);
  return result;
}
