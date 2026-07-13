/**
 * internal-catalog.ts — GET /internal/ai/catalog
 *
 * Returns every category+service regardless of visibility, but only to an
 * authenticated, active internal-role session. Every access is audit-logged
 * by requireInternalRole.
 */
import { Router } from "express";
import { db, aiServiceCategoriesTable, aiServicesTable } from "@workspace/db";
import { requireAuth, requirePasswordChanged, requireInternalRole } from "../middleware/internalAuth.js";

const router = Router();

router.get(
  "/internal/ai/catalog",
  requireAuth,
  requirePasswordChanged,
  requireInternalRole(),
  async (_req, res): Promise<void> => {
    const categories = await db
      .select()
      .from(aiServiceCategoriesTable)
      .orderBy(aiServiceCategoriesTable.displayOrder, aiServiceCategoriesTable.name);
    const services = await db.select().from(aiServicesTable).orderBy(aiServicesTable.serviceName);
    res.json({ categories, services });
  },
);

export default router;
