/**
 * Image Preview Pipeline routes — two-stage image generation.
 *
 * POST /creative-ai/projects/:id/sessions          — start preview session
 * GET  /creative-ai/projects/:id/sessions          — list sessions for project
 * GET  /creative-ai/sessions/:sessionId            — get session + previews + finals
 * POST /creative-ai/sessions/:sessionId/select-concept  — customer selects concept
 * POST /creative-ai/sessions/:sessionId/generate-final  — start final generation
 * POST /creative-ai/sessions/:sessionId/more-previews   — generate more preview concepts
 * GET  /creative-ai/analytics/preview-pipeline         — pipeline analytics
 */

import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, creativeAiAssetsTable, creativeRenderSessionsTable, creativeProjectsTable } from "@workspace/db";
import {
  StartPreviewSessionBody,
  StartPreviewSessionParams,
  StartPreviewSessionResponse,
  ListProjectSessionsParams,
  ListProjectSessionsResponse,
  GetRenderSessionParams,
  GetRenderSessionResponse,
  SelectConceptParams,
  SelectConceptBody,
  SelectConceptResponse,
  GenerateFinalParams,
  GenerateFinalBody,
  GenerateFinalResponse,
  MorePreviewsParams,
  MorePreviewsBody,
  MorePreviewsResponse,
  PreviewPipelineAnalyticsQuery,
  PreviewPipelineAnalyticsResponse,
} from "@workspace/api-zod";
import { logAudit } from "../services/aiAuditService.js";
import {
  startPreviewSession,
  selectConcept,
  runFinalGeneration,
  generateMorePreviews,
} from "../services/imagePreviewService.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSession(s: typeof creativeRenderSessionsTable.$inferSelect) {
  return {
    ...s,
    previewCostUsd: parseFloat(String(s.previewCostUsd ?? 0)),
    finalCostUsd: parseFloat(String(s.finalCostUsd ?? 0)),
    qcCostUsd: parseFloat(String(s.qcCostUsd ?? 0)),
    totalCostUsd: parseFloat(String(s.totalCostUsd ?? 0)),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function formatAsset(a: typeof creativeAiAssetsTable.$inferSelect) {
  return {
    ...a,
    cost: a.cost != null ? parseFloat(String(a.cost)) : null,
    estimatedFinalCostUsd: a.estimatedFinalCostUsd != null ? parseFloat(String(a.estimatedFinalCostUsd)) : null,
    createdAt: a.createdAt.toISOString(),
  };
}

// ── POST /creative-ai/projects/:id/sessions ───────────────────────────────────

router.post("/creative-ai/projects/:id/sessions", async (req, res): Promise<void> => {
  const params = StartPreviewSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = StartPreviewSessionBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
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

  const { sessionId, message } = await startPreviewSession(params.data.id, {
    packageTier: body.data.packageTier,
    previewCount: body.data.previewCount,
    requestedFinalCount: body.data.requestedFinalCount,
  });

  res.status(202).json(
    StartPreviewSessionResponse.parse({
      sessionId,
      projectId: params.data.id,
      sessionStatus: "planning",
      packageTier: body.data.packageTier,
      previewCount: body.data.previewCount,
      message,
    }),
  );
});

// ── GET /creative-ai/projects/:id/sessions ────────────────────────────────────

router.get("/creative-ai/projects/:id/sessions", async (req, res): Promise<void> => {
  const params = ListProjectSessionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const sessions = await db
    .select()
    .from(creativeRenderSessionsTable)
    .where(eq(creativeRenderSessionsTable.projectId, params.data.id))
    .orderBy(desc(creativeRenderSessionsTable.createdAt));

  res.json(
    ListProjectSessionsResponse.parse(
      sessions.map((s) => ({ ...formatSession(s), previewConcepts: undefined, finalAssets: undefined })),
    ),
  );
});

// ── GET /creative-ai/sessions/:sessionId ──────────────────────────────────────

router.get("/creative-ai/sessions/:sessionId", async (req, res): Promise<void> => {
  const params = GetRenderSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(creativeRenderSessionsTable)
    .where(eq(creativeRenderSessionsTable.id, params.data.sessionId));

  if (!session) {
    res.status(404).json({ error: "Render session not found" });
    return;
  }

  // Load preview concepts and final assets
  const allAssets = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.renderSessionId, params.data.sessionId))
    .orderBy(creativeAiAssetsTable.conceptIndex, creativeAiAssetsTable.createdAt);

  const previewConcepts = allAssets
    .filter((a) => a.renderStage === "preview")
    .map(formatAsset);

  const finalAssets = allAssets
    .filter((a) => a.renderStage === "final")
    .map((a) => ({
      id: a.id,
      imageUrl: a.imageUrl,
      thumbnailUrl: a.thumbnailUrl,
      status: a.status,
      qcScore: a.qcScore,
      qcNotes: a.qcNotes,
      cost: a.cost != null ? parseFloat(String(a.cost)) : null,
      createdAt: a.createdAt.toISOString(),
    }));

  res.json(
    GetRenderSessionResponse.parse({
      ...formatSession(session),
      previewConcepts,
      finalAssets,
    }),
  );
});

// ── POST /creative-ai/sessions/:sessionId/select-concept ─────────────────────

router.post("/creative-ai/sessions/:sessionId/select-concept", async (req, res): Promise<void> => {
  const params = SelectConceptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SelectConceptBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(creativeRenderSessionsTable)
    .where(eq(creativeRenderSessionsTable.id, params.data.sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Guard: only allow selection when preview is ready or more previews requested
  const allowedStatuses = ["preview_ready", "waiting_customer", "preview_generating"];
  if (!allowedStatuses.includes(session.sessionStatus)) {
    res.status(409).json({
      error: `Cannot select concept in status "${session.sessionStatus}". Previews must be ready first.`,
    });
    return;
  }

  await selectConcept(params.data.sessionId, body.data.conceptAssetId, body.data.feedback);

  res.json(
    SelectConceptResponse.parse({
      sessionId: params.data.sessionId,
      selectedConceptId: body.data.conceptAssetId,
      sessionStatus: "concept_selected",
      message: "Concept selected. Ready to generate final images when you are.",
    }),
  );
});

// ── POST /creative-ai/sessions/:sessionId/generate-final ─────────────────────

router.post("/creative-ai/sessions/:sessionId/generate-final", async (req, res): Promise<void> => {
  const params = GenerateFinalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = GenerateFinalBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(creativeRenderSessionsTable)
    .where(eq(creativeRenderSessionsTable.id, params.data.sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.sessionStatus !== "concept_selected") {
    res.status(409).json({
      error: `Cannot start final generation in status "${session.sessionStatus}". Select a concept first.`,
    });
    return;
  }

  if (!session.selectedConceptId) {
    res.status(409).json({ error: "No concept selected for this session" });
    return;
  }

  const requestedCount = body.data.requestedCount ?? session.requestedFinalCount ?? 1;

  // Fire in background
  runFinalGeneration(params.data.sessionId, requestedCount).catch(async (err) => {
    console.error(`[preview-pipeline] Final generation failed for session ${params.data.sessionId}:`, err);
    await db
      .update(creativeRenderSessionsTable)
      .set({ sessionStatus: "failed", updatedAt: new Date() })
      .where(eq(creativeRenderSessionsTable.id, params.data.sessionId));
    await logAudit(
      "preview-pipeline", "final_generation_error", session.projectId, "creative_render_session", "failure",
      { sessionId: params.data.sessionId, error: String(err) },
    );
  });

  res.status(202).json(
    GenerateFinalResponse.parse({
      sessionId: params.data.sessionId,
      sessionStatus: "final_generating",
      requestedCount,
      message: `Final generation started for ${requestedCount} image${requestedCount > 1 ? "s" : ""}`,
    }),
  );
});

// ── POST /creative-ai/sessions/:sessionId/more-previews ──────────────────────

router.post("/creative-ai/sessions/:sessionId/more-previews", async (req, res): Promise<void> => {
  const params = MorePreviewsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = MorePreviewsBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(creativeRenderSessionsTable)
    .where(eq(creativeRenderSessionsTable.id, params.data.sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Guard: can only request more previews before concept selection or from preview_ready state
  if (!["preview_ready", "waiting_customer"].includes(session.sessionStatus)) {
    res.status(409).json({
      error: `Cannot generate more previews in status "${session.sessionStatus}"`,
    });
    return;
  }

  const count = body.data.count ?? 4;

  // Fire in background
  generateMorePreviews(params.data.sessionId, count).catch(async (err) => {
    console.error(`[preview-pipeline] More previews failed for session ${params.data.sessionId}:`, err);
    await logAudit(
      "preview-pipeline", "more_previews_failed", session.projectId, "creative_render_session", "failure",
      { sessionId: params.data.sessionId, error: String(err) },
    );
  });

  res.status(202).json(
    MorePreviewsResponse.parse({
      sessionId: params.data.sessionId,
      sessionStatus: "preview_generating",
      count,
      message: `Generating ${count} additional preview concepts`,
    }),
  );
});

// ── GET /creative-ai/analytics/preview-pipeline ───────────────────────────────

router.get("/creative-ai/analytics/preview-pipeline", async (req, res): Promise<void> => {
  const query = PreviewPipelineAnalyticsQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const days = Math.min(Math.max(query.data.days ?? 30, 1), 365);

  const [row] = await db
    .select({
      totalSessions: sql<number>`count(*)::int`,
      completedSessions: sql<number>`count(*) filter (where session_status = 'completed')::int`,
      avgPreviewCostUsd: sql<number | null>`avg(preview_cost_usd::numeric)`,
      avgFinalCostUsd: sql<number | null>`avg(final_cost_usd::numeric)`,
      avgPreviewCount: sql<number | null>`avg(preview_count)`,
      sessionsWithSelection: sql<number>`count(*) filter (where selected_concept_id is not null)::int`,
    })
    .from(creativeRenderSessionsTable)
    .where(sql`created_at >= now() - (${days} * interval '1 day')`);

  const totalSessions = row?.totalSessions ?? 0;
  const sessionsWithSelection = row?.sessionsWithSelection ?? 0;

  // Preview-image acceptance rate
  const [assetRow] = await db
    .select({
      previewTotal: sql<number>`count(*) filter (where render_stage = 'preview')::int`,
      previewApproved: sql<number>`count(*) filter (where render_stage = 'preview' and status = 'approved')::int`,
      previewCompleted: sql<number>`count(*) filter (where render_stage = 'preview' and status = 'completed')::int`,
      finalTotal: sql<number>`count(*) filter (where render_stage = 'final')::int`,
      finalSuccess: sql<number>`count(*) filter (where render_stage = 'final' and status in ('completed', 'approved'))::int`,
    })
    .from(creativeAiAssetsTable)
    .where(sql`created_at >= now() - (${days} * interval '1 day')`);

  const previewTotal = assetRow?.previewTotal ?? 0;
  const finalTotal = assetRow?.finalTotal ?? 0;

  // Cost saving vs legacy direct-render (estimate: final cost = what would have been spent without preview gate)
  const avgFinalCostRaw = row?.avgFinalCostUsd != null ? Number(row.avgFinalCostUsd) : null;
  const avgPreviewCostRaw = row?.avgPreviewCostUsd != null ? Number(row.avgPreviewCostUsd) : null;
  // Savings = cost avoided because customer selected concept before full final batch
  const totalCostSavedUsd = avgFinalCostRaw && totalSessions > 0
    ? parseFloat(((avgFinalCostRaw * 0.7) * totalSessions).toFixed(4))
    : null;

  res.json(
    PreviewPipelineAnalyticsResponse.parse({
      totalSessions,
      completedSessions: row?.completedSessions ?? 0,
      avgPreviewsPerSession: row?.avgPreviewCount != null ? Number(row.avgPreviewCount) : null,
      previewAcceptedRate: previewTotal > 0 ? sessionsWithSelection / totalSessions : null,
      previewRejectedRate: previewTotal > 0 ? 1 - (sessionsWithSelection / totalSessions) : null,
      avgPreviewCostUsd: avgPreviewCostRaw,
      avgFinalCostUsd: avgFinalCostRaw,
      totalCostSavedUsd,
      revisionRate: totalSessions > 0 ? (totalSessions - sessionsWithSelection) / totalSessions : null,
      renderSuccessRate: finalTotal > 0 ? (assetRow?.finalSuccess ?? 0) / finalTotal : null,
    }),
  );
});

export default router;
