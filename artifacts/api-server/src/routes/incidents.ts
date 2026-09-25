import { Router } from "express";
import { eq } from "drizzle-orm";
import { aiIncidentsTable, db } from "@workspace/db";
import { listIncidents, processOpenIncidents, upsertIncident } from "../services/incidentAutoRepairService.js";

const router = Router();

router.get("/ai/incidents", async (req, res): Promise<void> => {
  const limit = typeof req.query["limit"] === "string" ? Number(req.query["limit"]) : 100;
  res.json({ incidents: await listIncidents(Number.isFinite(limit) ? limit : 100) });
});

router.post("/ai/incidents", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  if (!["github","supabase","hostinger","system"].includes(body.source) || typeof body.kind !== "string" || typeof body.title !== "string" || typeof body.summary !== "string") {
    res.status(400).json({ error: "source, kind, title and summary are required" });
    return;
  }
  const incident = await upsertIncident({
    source: body.source,
    kind: body.kind,
    title: body.title,
    summary: body.summary,
    severity: body.severity,
    riskClass: body.riskClass,
    repository: body.repository,
    branch: body.branch,
    headSha: body.headSha,
    environment: body.environment,
    fingerprint: body.fingerprint,
    metadata: body.metadata,
  });
  res.status(202).json({ incident });
});

router.post("/ai/incidents/process", async (_req, res): Promise<void> => {
  res.json(await processOpenIncidents(10));
});

router.post("/ai/incidents/:id/resolve", async (req, res): Promise<void> => {
  const [row] = await db.update(aiIncidentsTable).set({ status: "RESOLVED", resolvedAt: new Date(), lastError: null })
    .where(eq(aiIncidentsTable.id, req.params.id!)).returning();
  if (!row) { res.status(404).json({ error: "Incident not found" }); return; }
  res.json({ incident: row });
});

export default router;
