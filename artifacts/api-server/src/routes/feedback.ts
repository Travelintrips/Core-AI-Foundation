import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { aiFeedbackTable, aiMemoryTable, db } from "@workspace/db";
import { redactLearningText } from "../services/aiCoreChatLearningService.js";

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

  const sanitized = {
    ...parsed.data,
    feedbackText: parsed.data.feedbackText ? redactLearningText(parsed.data.feedbackText) : undefined,
    diff: parsed.data.diff ? redactLearningText(parsed.data.diff) : undefined,
  };
  const [row] = await db.insert(aiFeedbackTable).values(sanitized).returning();

  if (
    sanitized.feedbackText &&
    (sanitized.action === "human_edit" || sanitized.action === "needs_revision")
  ) {
    await db.insert(aiMemoryTable).values({
      agentId: "ai-core-chat",
      sessionId: null,
      memoryType: "validated_rule",
      content: sanitized.feedbackText,
      key: `human_feedback:${sanitized.projectId}:${row.id}`,
      importance: "0.950",
      expiresAt: null,
      metadata: {
        status: "validated",
        source: "human_feedback",
        projectName: sanitized.projectId,
        feedbackId: row.id,
        action: sanitized.action,
      },
    });
  }

  res.status(201).json(row);
});

export default router;
