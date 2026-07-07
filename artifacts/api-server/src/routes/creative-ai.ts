import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, creativeProjectsTable, creativeProjectStepsTable } from "@workspace/db";
import {
  CreateCreativeBriefBody,
  CreateCreativeBriefResponse,
  ListCreativeProjectsResponse,
  GetCreativeProjectParams,
  GetCreativeProjectResponse,
  UpdateCreativeProjectStatusParams,
  UpdateCreativeProjectStatusBody,
  UpdateCreativeProjectStatusResponse,
} from "@workspace/api-zod";
import { logAudit } from "../services/aiAuditService.js";
import { runCreativeBriefWorkflow } from "../services/creativeWorkflowRunner.js";

const router = Router();

/** POST /creative-ai/brief — create project and start 4-agent workflow in background */
router.post("/creative-ai/brief", async (req, res): Promise<void> => {
  const parsed = CreateCreativeBriefBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    brandName, businessType, targetMarket, productOrService,
    stylePreference, goal, notes,
  } = parsed.data;

  // Create project record
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
      status: "pending",
    })
    .returning();

  await logAudit("creative-ai", "create_project", project.projectId, "creative_project", "success", { brandName });

  // Start workflow in background — don't await
  runCreativeBriefWorkflow(project.id).catch(async (err) => {
    console.error(`[creative-ai] Workflow failed for project ${project.projectId}:`, err);
    await db
      .update(creativeProjectsTable)
      .set({ status: "failed" })
      .where(eq(creativeProjectsTable.id, project.id));
    await logAudit("creative-ai", "workflow_error", project.projectId, "creative_project", "failure", { error: String(err) });
  });

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

export default router;
