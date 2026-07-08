import { Router } from "express";
import { db, aiCapabilitiesTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

router.get("/ai/capabilities", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(aiCapabilitiesTable)
    .orderBy(desc(aiCapabilitiesTable.updatedAt));
  res.json(rows);
});

export default router;
