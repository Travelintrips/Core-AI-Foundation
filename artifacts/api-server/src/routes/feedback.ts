import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { aiFeedbackTable, db } from "@workspace/db";

const router = Router();

const FeedbackInput = z.object({
  projectId: z.string().trim().min(1).max(200),
  stepId: z.number().int().positive().optional(),
  stepName: z.string().trim().max(200).optional(),
  action: z.enum(["approve", "reject", "needs_revision", "human_edit"]),
  rating: z.number().int().min(1).max(5).optional(),
  feedbackText: z.string().max(20_000).optional(),
  originalOutput: z.unknown().optional(),
  editedOutput: z.unknown().optional(),
  diff: z.string().max(50_000).optional(),
  reviewer: z.string().trim().min(1).max(200).default("human"),
});

router.get("/ai/feedback", async (req, res): Promise<void> => {
  const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"].trim() : "";
  const query = db.select().from(aiFeedbackTable);
  const rows = projectId
    ? await query.where(eq(aiFeedbackTable.projectId, projectId)).orderBy(desc(aiFeedbackTable.createdAt)).limit(200)
    : await query.orderBy(desc(aiFeedbackTable.createdAt)).limit(200);
  res.json(rows);
});

router.post("/ai/feedback", async (req, res): Promise<void> => {
  const parsed = FeedbackInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [row] = await db.insert(aiFeedbackTable).values(parsed.data).returning();
  res.status(201).json(row);
});

export default router;
