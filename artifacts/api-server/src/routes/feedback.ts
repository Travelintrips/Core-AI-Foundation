import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, aiFeedbackTable } from "@workspace/db";
import { SubmitProjectFeedbackBody } from "@workspace/api-zod";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();

function serializeFeedback(row: typeof aiFeedbackTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

/** POST /creative-ai/projects/:id/feedback — submit human feedback on a project step */
router.post("/creative-ai/projects/:id/feedback", async (req, res): Promise<void> => {
  const { id: projectId } = req.params;

  const parsed = SubmitProjectFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;
  const [row] = await db
    .insert(aiFeedbackTable)
    .values({
      projectId,
      stepId: d.stepId ?? null,
      stepName: d.stepName ?? null,
      action: d.action,
      rating: d.rating ?? null,
      feedbackText: d.feedbackText ?? null,
      originalOutput: (d.originalOutput ?? null) as Record<string, unknown> | null,
      editedOutput: (d.editedOutput ?? null) as Record<string, unknown> | null,
      diff: d.diff ?? null,
      reviewer: d.reviewer ?? "human",
    })
    .returning();

  await logAudit(
    "creative-ai",
    `feedback:${d.action}`,
    projectId,
    "creative_feedback",
    "success",
    { stepName: d.stepName, rating: d.rating },
  );

  res.status(201).json(serializeFeedback(row));
});

/** GET /creative-ai/projects/:id/feedback — list all feedback for a project */
router.get("/creative-ai/projects/:id/feedback", async (req, res): Promise<void> => {
  const { id: projectId } = req.params;
  const rows = await db
    .select()
    .from(aiFeedbackTable)
    .where(eq(aiFeedbackTable.projectId, projectId))
    .orderBy(desc(aiFeedbackTable.createdAt));

  res.json(rows.map(serializeFeedback));
});

export default router;
