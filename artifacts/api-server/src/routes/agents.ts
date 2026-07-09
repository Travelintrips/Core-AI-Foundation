import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  aiAgentsTable,
  aiAgentCapabilitiesTable,
  insertAiAgentSchema,
  insertAiAgentCapabilitySchema,
} from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();

const UpdateAgentBody = insertAiAgentSchema.partial();

// GET /ai/agents
router.get("/ai/agents", async (_req, res): Promise<void> => {
  try {
    const agents = await db
      .select()
      .from(aiAgentsTable)
      .orderBy(aiAgentsTable.priority, aiAgentsTable.name);
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /ai/agents
router.post("/ai/agents", async (req, res): Promise<void> => {
  const parsed = insertAiAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [agent] = await db
      .insert(aiAgentsTable)
      .values(parsed.data)
      .returning();
    await logAudit("agents", "create_agent", String(agent.id), "ai_agent", "success", { name: agent.name });
    res.status(201).json(agent);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "Agent slug already exists" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// GET /ai/agents/:id
router.get("/ai/agents/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [agent] = await db
      .select()
      .from(aiAgentsTable)
      .where(eq(aiAgentsTable.id, id))
      .limit(1);
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PATCH /ai/agents/:id
router.patch("/ai/agents/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [updated] = await db
      .update(aiAgentsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(aiAgentsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Agent not found" }); return; }
    await logAudit("agents", "update_agent", String(id), "ai_agent", "success", parsed.data);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /ai/agents/:id
router.delete("/ai/agents/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(aiAgentsTable).where(eq(aiAgentsTable.id, id));
    await logAudit("agents", "delete_agent", String(id), "ai_agent", "success");
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /ai/agents/:id/capabilities
router.get("/ai/agents/:id/capabilities", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const caps = await db
      .select()
      .from(aiAgentCapabilitiesTable)
      .where(eq(aiAgentCapabilitiesTable.agentId, id))
      .orderBy(aiAgentCapabilitiesTable.sortOrder, aiAgentCapabilitiesTable.name);
    res.json(caps);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /ai/agents/:id/capabilities
router.post("/ai/agents/:id/capabilities", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = insertAiAgentCapabilitySchema.safeParse({ agentId: id, ...req.body });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [cap] = await db
      .insert(aiAgentCapabilitiesTable)
      .values(parsed.data)
      .returning();
    res.status(201).json(cap);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /ai/agents/:id/capabilities/:capId
router.delete("/ai/agents/:id/capabilities/:capId", async (req, res): Promise<void> => {
  const capId = parseInt(req.params.capId ?? "", 10);
  if (Number.isNaN(capId)) { res.status(400).json({ error: "Invalid capId" }); return; }
  try {
    await db.delete(aiAgentCapabilitiesTable).where(eq(aiAgentCapabilitiesTable.id, capId));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
