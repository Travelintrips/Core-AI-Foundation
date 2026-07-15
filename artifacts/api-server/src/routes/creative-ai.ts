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
import { runImageDesignerPipeline } from "../services/imageDesignerService.js";

const router = Router();

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

  // Fire off in background — never await
  runImageDesignerPipeline(project.id, project.projectId, variations).catch(async (err) => {
    console.error(`[image-designer] Pipeline failed for project ${project.projectId}:`, err);
    await logAudit(
      "creative-ai",
      "image_pipeline_error",
      project.projectId,
      "creative_project",
      "failure",
      { error: String(err) },
    ).catch(() => {});
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
