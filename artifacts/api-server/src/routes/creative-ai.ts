import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { aiGenerationLimiter } from "../middleware/rateLimiter.js";
import { randomUUID } from "crypto";
import { db, creativeProjectsTable, creativeProjectStepsTable, creativeAiAssetsTable } from "@workspace/db";
import {
  CreateCreativeBriefBody,
  CreateCreativeBriefResponse,
  ListCreativeProjectsResponse,
  GetCreativeProjectParams,
  GetCreativeProjectResponse,
  RetryCreativeProjectParams,
  RetryCreativeProjectResponse,
  DeleteCreativeProjectStepParams,
  DeleteCreativeProjectStepResponse,
  UpdateCreativeProjectStatusParams,
  UpdateCreativeProjectStatusBody,
  UpdateCreativeProjectStatusResponse,
  GenerateImageConceptsParams,
  GenerateImageConceptsBody,
  GenerateImageConceptsResponse,
  ListProjectAssetsParams,
  ListProjectAssetsResponse,
  UpdateAssetStatusParams,
  UpdateAssetStatusBody,
  UpdateAssetStatusResponse,
  SubmitAssetFeedbackParams,
  SubmitAssetFeedbackBody,
  SubmitAssetFeedbackResponse,
  GetCreativeImageAnalyticsQueryParams,
  GetCreativeImageAnalyticsResponse,
} from "@workspace/api-zod";
import { logAudit } from "../services/aiAuditService.js";
import { publishSafe } from "../services/aiEventBusService.js";
import { runCreativeBriefWorkflow } from "../services/creativeWorkflowRunner.js";
import {
  runImageDesignerPipeline,
  regenerateSingleAsset,
  isInteriorDesignProject,
  getInteriorConceptVersion,
  recoverStaleImageGenerations,
} from "../services/imageDesignerService.js";
import { getConceptDraftForImagePipeline } from "../domains/interior-design/service.js";
import { runCreativeBriefWorkflow } from "../services/creativeWorkflowRunner.js";

const router = Router();
const activeImagePipelines = new Set<string>();
const activeCreativeRetries = new Set<number>();

/** POST /creative-ai/brief — create project.
 * P0-3 rate limited: 10 req / 10 min per IP.
 *
 * P0-1 PAYMENT GATE: The workflow is NOT auto-started here.
 * Projects are created in "waiting_payment" status.
 * AI production starts only after an admin verifies payment via
 * POST /ai/payments/:scheduleId/verify, which calls verifyPayment()
 * in paymentScheduleService — the single authoritative production gate.
 *
 * To run AI immediately (e.g. internal testing), use the admin seed/test-run
 * endpoints which are explicitly scoped to non-production data.
 */
router.post("/creative-ai/brief", aiGenerationLimiter, async (req, res): Promise<void> => {
  const parsed = CreateCreativeBriefBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    brandName, businessType, targetMarket, productOrService,
    stylePreference, goal, notes,
  } = parsed.data;

  // Create project record in waiting_payment — no workflow yet.
  const [project] = await db
    .insert(creativeProjectsTable)
    .values({
      projectId: randomUUID(),
      brandName,
      businessType,
      targetMarket,
      productOrService,
      stylePreference: stylePreference ?? null,
      goal,
      notes: notes ?? null,
      status: "waiting_payment",
    })
    .returning();

  await logAudit("creative-ai", "create_project", project.projectId, "creative_project", "success", { brandName, gated: true });
  publishSafe({ eventType: "creative.project.created", sourceModule: "creative-ai", sourceId: project.projectId,
    payload: { projectId: project.projectId, brandName, businessType, goal } });

  res.status(201).json(
    CreateCreativeBriefResponse.parse({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    }),
  );
});

/** GET /creative-ai/projects — list all projects, newest first */
router.get("/creative-ai/projects", async (_req, res): Promise<void> => {
  const projects = await db
    .select()
    .from(creativeProjectsTable)
    .orderBy(desc(creativeProjectsTable.createdAt));

  res.json(
    ListCreativeProjectsResponse.parse(
      projects.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    ),
  );
});

/** GET /creative-ai/projects/:id — get project detail with all steps */
router.get("/creative-ai/projects/:id", async (req, res): Promise<void> => {
  const params = GetCreativeProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, params.data.id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const steps = await db
    .select()
    .from(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.projectId, project.id))
    .orderBy(creativeProjectStepsTable.createdAt);

  res.json(
    GetCreativeProjectResponse.parse({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      steps: steps.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt?.toISOString(),
      })),
    }),
  );
});

/** POST /creative-ai/projects/:id/retry — clear the old step snapshot and rerun */
router.post("/creative-ai/projects/:id/retry", async (req, res): Promise<void> => {
  const params = RetryCreativeProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, params.data.id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (activeCreativeRetries.has(project.id) || project.status === "pending" || project.status === "running") {
    res.status(409).json({ error: "Creative workflow is already running" });
    return;
  }

  // A retry is a fresh workflow execution. Removing the old step snapshot
  // prevents failed rows from being rendered alongside the new attempt.
  await db
    .delete(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.projectId, project.id));
  await db
    .update(creativeProjectsTable)
    .set({ status: "pending", result: null })
    .where(eq(creativeProjectsTable.id, project.id));

  activeCreativeRetries.add(project.id);
  void runCreativeBriefWorkflow(project.id)
    .catch(async (err) => {
      await logAudit(
        "creative-ai",
        "workflow_retry_error",
        project.projectId,
        "creative_project",
        "failure",
        { error: String(err) },
      ).catch(() => {});
    })
    .finally(() => {
      activeCreativeRetries.delete(project.id);
    });

  await logAudit(
    "creative-ai",
    "workflow_retry_started",
    project.projectId,
    "creative_project",
    "success",
  );

  res.status(202).json(
    RetryCreativeProjectResponse.parse({
      projectId: project.projectId,
      retried: true,
      message: "Creative workflow retry started",
    }),
  );
});

/** DELETE /creative-ai/projects/:id/steps/:stepId — remove a failed step row */
router.delete("/creative-ai/projects/:id/steps/:stepId", async (req, res): Promise<void> => {
  const params = DeleteCreativeProjectStepParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select({ id: creativeProjectsTable.id, projectId: creativeProjectsTable.projectId })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, params.data.id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [step] = await db
    .select()
    .from(creativeProjectStepsTable)
    .where(
      and(
        eq(creativeProjectStepsTable.id, params.data.stepId),
        eq(creativeProjectStepsTable.projectId, project.id),
      ),
    );

  if (!step) {
    res.status(404).json({ error: "Step not found" });
    return;
  }

  if (!["failed", "blocked_by_budget"].includes(step.status)) {
    res.status(409).json({ error: "Only failed or budget-blocked steps can be deleted" });
    return;
  }

  await db
    .delete(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.id, step.id));

  await logAudit(
    "creative-ai",
    "step_deleted",
    project.projectId,
    "creative_project",
    "success",
    { stepId: step.id, stepName: step.stepName, previousStatus: step.status },
  );

  res.json(
    DeleteCreativeProjectStepResponse.parse({
      projectId: project.projectId,
      stepId: step.id,
      deleted: true,
    }),
  );
});

/** PATCH /creative-ai/projects/:id/status — manually update project status */
router.patch("/creative-ai/projects/:id/status", async (req, res): Promise<void> => {
  const params = UpdateCreativeProjectStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateCreativeProjectStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [project] = await db
    .update(creativeProjectsTable)
    .set({ status: body.data.status })
    .where(eq(creativeProjectsTable.projectId, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await logAudit("creative-ai", "update_status", project.projectId, "creative_project", "success", { status: body.data.status });

  res.json(
    UpdateCreativeProjectStatusResponse.parse({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    }),
  );
});

// ─── Phase 5: Image Designer Routes ──────────────────────────────────────────

/** POST /creative-ai/projects/:id/generate-image — start image pipeline in background */
router.post("/creative-ai/projects/:id/generate-image", async (req, res): Promise<void> => {
  const params = GenerateImageConceptsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Only parse body if one was sent; undefined body is valid (use defaults)
  const rawBody = req.body && Object.keys(req.body).length > 0 ? req.body : undefined;
  const body = rawBody !== undefined ? GenerateImageConceptsBody.safeParse(rawBody) : null;
  if (body !== null && !body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const variations = body?.data?.variations ?? 2;

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, params.data.id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await recoverStaleImageGenerations(project.projectId);

  // Check if there's already a generation in progress
  const { count: pendingCount } = (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(creativeAiAssetsTable)
      .where(
        and(
          eq(creativeAiAssetsTable.projectId, project.projectId),
          eq(creativeAiAssetsTable.status, "generating"),
        ),
      )
  )[0];

  if (pendingCount > 0) {
    res.status(409).json({ error: "Image generation already in progress for this project" });
    return;
  }

  if (activeImagePipelines.has(project.projectId)) {
    res.status(409).json({ error: "Image generation already in progress for this project" });
    return;
  }

  // ── Interior Design approval guard ────────────────────────────────────────
  // Interior Design projects MUST have an approved concept snapshot before
  // image generation begins. Generating from an unapproved (mutable) draft is
  // blocked to prevent prompt drift between approval and rendering.
  const projectSteps = await db
    .select({ stepName: creativeProjectStepsTable.stepName })
    .from(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.projectId, project.id));

  if (isInteriorDesignProject(projectSteps)) {
    const conceptDraft = await getConceptDraftForImagePipeline(project.projectId);
    if (!conceptDraft || conceptDraft.reviewState !== "approved_for_rendering") {
      res.status(409).json({
        error: "Interior Design concept must be approved for rendering before image generation.",
      });
      return;
    }

    // Idempotency boundary: an approved concept version can only have one
    // initial visual generation. Refreshes/retries must not create another
    // batch; the explicit asset regeneration action is the supported retry.
    const conceptVersion = getInteriorConceptVersion(project, conceptDraft);
    const existingVersionAssets = await db
      .select({ id: creativeAiAssetsTable.id, status: creativeAiAssetsTable.status, metadata: creativeAiAssetsTable.metadata })
      .from(creativeAiAssetsTable)
      .where(eq(creativeAiAssetsTable.projectId, project.projectId));
    const sameVersionAssets = existingVersionAssets.filter((asset) =>
      (asset.metadata as Record<string, unknown> | null)?.conceptVersion === conceptVersion
      && !["failed", "needs_revision", "rejected"].includes(asset.status),
    );
    if (sameVersionAssets.length > 0) {
      const isStillRunning = sameVersionAssets.some((asset) =>
        asset.status === "generating" || (asset.metadata as Record<string, unknown> | null)?.generationStatus === "generating_visual",
      );
      res.status(409).json({
        error: isStillRunning
          ? "Interior visual generation is already in progress for this approved concept."
          : "Interior visuals already exist for this approved concept. Use an asset's regenerate action to create a new version.",
      });
      return;
    }
  }

  // Fire off in background — never await
  activeImagePipelines.add(project.projectId);
  runImageDesignerPipeline(project.id, project.projectId, variations)
    .catch(async (err) => {
      console.error(`[image-designer] Pipeline failed for project ${project.projectId}:`, err);
      await logAudit(
        "creative-ai",
        "image_pipeline_error",
        project.projectId,
        "creative_project",
        "failure",
        { error: String(err) },
      ).catch(() => {});
    })
    .finally(() => {
      activeImagePipelines.delete(project.projectId);
    });

  res.status(202).json(
    GenerateImageConceptsResponse.parse({
      message: `Image generation started for ${variations} variation${variations > 1 ? "s" : ""}`,
      variations,
    }),
  );
});

/** GET /creative-ai/projects/:id/assets — list image assets for a project */
router.get("/creative-ai/projects/:id/assets", async (req, res): Promise<void> => {
  const params = ListProjectAssetsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await recoverStaleImageGenerations(params.data.id);

  const assets = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.projectId, params.data.id))
    .orderBy(creativeAiAssetsTable.createdAt);

  res.json(
    ListProjectAssetsResponse.parse(
      assets.map((a) => ({
        ...a,
        cost: a.cost != null ? parseFloat(String(a.cost)) : null,
        createdAt: a.createdAt.toISOString(),
      })),
    ),
  );
});

/** POST /creative-ai/assets/:assetId/regenerate — mark original needs_revision + fire a new generation */
router.post("/creative-ai/assets/:assetId/regenerate", async (req, res): Promise<void> => {
  const assetId = parseInt(req.params.assetId, 10);
  if (isNaN(assetId)) {
    res.status(400).json({ error: "Invalid assetId" });
    return;
  }

  const [asset] = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.id, assetId));

  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  await recoverStaleImageGenerations(asset.projectId);

  // Block if another generation is already in progress for this project
  const [{ pendingCount }] = await db
    .select({ pendingCount: sql<number>`count(*)::int` })
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, asset.projectId),
        eq(creativeAiAssetsTable.status, "generating"),
      ),
    );

  if (pendingCount > 0) {
    res.status(409).json({ error: "Image generation already in progress for this project" });
    return;
  }

  // Mark original as needs_revision immediately
  await db
    .update(creativeAiAssetsTable)
    .set({ status: "needs_revision" })
    .where(eq(creativeAiAssetsTable.id, assetId));

  // Fire regeneration in background — never await
  const { revisionNote } = req.body as { revisionNote?: string };
  regenerateSingleAsset(assetId, asset.projectId, revisionNote?.trim() || undefined).catch(async (err) => {
    console.error(`[image-designer] Revision failed for asset ${assetId}:`, err);
    await logAudit(
      "creative-ai", "image_revision_error", asset.projectId, "creative_ai_asset", "failure",
      { assetId, error: String(err) },
    ).catch(() => {});
  });

  res.status(202).json({ message: "Revision started — new image is generating" });
});

/** PATCH /creative-ai/assets/:assetId/status — approve / needs_revision / reject */
router.patch("/creative-ai/assets/:assetId/status", async (req, res): Promise<void> => {
  const params = UpdateAssetStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateAssetStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [asset] = await db
    .update(creativeAiAssetsTable)
    .set({
      status: body.data.status,
      ...(body.data.notes ? { qcNotes: body.data.notes } : {}),
    })
    .where(eq(creativeAiAssetsTable.id, params.data.assetId))
    .returning();

  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  await logAudit(
    "creative-ai",
    `asset_${body.data.status}`,
    String(asset.id),
    "creative_ai_asset",
    "success",
    { projectId: asset.projectId, status: body.data.status },
  ).catch(() => {});

  if (body.data.status === "approved") {
    publishSafe({ eventType: "creative.image.approved", sourceModule: "creative-ai", sourceId: String(asset.id),
      payload: { assetId: asset.id, projectId: asset.projectId } });
  } else {
    publishSafe({ eventType: "creative.image.generated", sourceModule: "creative-ai", sourceId: String(asset.id),
      payload: { assetId: asset.id, projectId: asset.projectId, status: body.data.status } });
  }

  res.json(
    UpdateAssetStatusResponse.parse({
      ...asset,
      cost: asset.cost != null ? parseFloat(String(asset.cost)) : null,
      createdAt: asset.createdAt.toISOString(),
    }),
  );
});

/** POST /creative-ai/assets/:assetId/feedback — human feedback updates asset status */
router.post("/creative-ai/assets/:assetId/feedback", async (req, res): Promise<void> => {
  const params = SubmitAssetFeedbackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SubmitAssetFeedbackBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const statusMap: Record<string, string> = {
    approve: "approved",
    reject: "rejected",
    needs_revision: "needs_revision",
  };

  const newStatus = statusMap[body.data.action] ?? body.data.action;

  const [asset] = await db
    .update(creativeAiAssetsTable)
    .set({
      status: newStatus,
      ...(body.data.notes ? { qcNotes: body.data.notes } : {}),
    })
    .where(eq(creativeAiAssetsTable.id, params.data.assetId))
    .returning();

  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  await logAudit(
    "creative-ai",
    `asset_feedback:${body.data.action}`,
    String(asset.id),
    "creative_ai_asset",
    "success",
    { projectId: asset.projectId, action: body.data.action, notes: body.data.notes },
  ).catch(() => {});

  res.json(
    SubmitAssetFeedbackResponse.parse({
      ...asset,
      cost: asset.cost != null ? parseFloat(String(asset.cost)) : null,
      createdAt: asset.createdAt.toISOString(),
    }),
  );
});

// ── Retry Failed Project ──────────────────────────────────────────────────────

/** POST /creative-ai/projects/:id/retry
 * Admin-only. Re-runs the AI workflow for a project that is in "failed" status.
 * Appends new step rows (runtimeRosterService de-duplicates by latest row per role)
 * and resets the project status to "running" before firing the workflow.
 */
router.post("/creative-ai/projects/:id/retry", async (req, res): Promise<void> => {
  const params = GetCreativeProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, params.data.id))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (project.status !== "failed") {
    res.status(409).json({ error: `Cannot retry project with status "${project.status}". Only failed projects can be retried.` });
    return;
  }

  // Reset to pending so the workflow runner transitions it to running
  await db
    .update(creativeProjectsTable)
    .set({ status: "pending", updatedAt: new Date() })
    .where(eq(creativeProjectsTable.id, project.id));

  // Fire-and-forget — same pattern as paymentScheduleService
  runCreativeBriefWorkflow(project.id).catch(async (err: unknown) => {
    console.error(`[creative-ai] Retry workflow failed for project ${project.projectId}:`, err);
    await db
      .update(creativeProjectsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(creativeProjectsTable.id, project.id))
      .catch(() => undefined);
  });

  await logAudit("creative-ai", "retry_workflow", project.projectId, "creative_project", "success", { previousStatus: "failed" });

  res.status(202).json({ message: "Workflow restarted", projectId: project.projectId });
});

// ── Image Analytics ───────────────────────────────────────────────────────────

router.get("/creative-ai/analytics/images", async (req, res): Promise<void> => {
  const queryParse = GetCreativeImageAnalyticsQueryParams.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: queryParse.error.message });
    return;
  }
  const days = Math.min(Math.max(queryParse.data.days ?? 30, 1), 365);

  const [row] = await db
    .select({
      totalImages: sql<number>`count(*)::int`,
      totalCostUsd: sql<number>`coalesce(sum(cost::numeric), 0)::float`,
      avgQcScore: sql<number | null>`avg(qc_score)`,
      approvedCount: sql<number>`count(*) filter (where status = 'approved')::int`,
      rejectedCount: sql<number>`count(*) filter (where status = 'rejected')::int`,
      pendingCount: sql<number>`count(*) filter (where status in ('pending', 'generating'))::int`,
      reviewedCount: sql<number>`count(*) filter (where status in ('approved', 'rejected', 'needs_revision'))::int`,
    })
    .from(creativeAiAssetsTable)
    .where(sql`created_at >= now() - (${days} * interval '1 day')`);

  const reviewedTotal = row?.reviewedCount ?? 0;

  res.json(
    GetCreativeImageAnalyticsResponse.parse({
      totalImages: row?.totalImages ?? 0,
      totalCostUsd: row?.totalCostUsd ?? 0,
      avgQcScore: row?.avgQcScore != null ? Number(row.avgQcScore) : null,
      approvedRate: reviewedTotal > 0 ? (row?.approvedCount ?? 0) / reviewedTotal : null,
      rejectedRate: reviewedTotal > 0 ? (row?.rejectedCount ?? 0) / reviewedTotal : null,
      pendingCount: row?.pendingCount ?? 0,
    }),
  );
});

export default router;
