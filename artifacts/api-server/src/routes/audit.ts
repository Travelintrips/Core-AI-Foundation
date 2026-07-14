import { Router } from "express";
import { desc } from "drizzle-orm";
import { db, aiAuditLogsTable } from "@workspace/db";
import {
  ListAuditLogsQueryParams,
  ListAuditLogsResponse,
} from "@workspace/api-zod";

const router = Router();

router.get("/ai/audit-logs", async (req, res): Promise<void> => {
  const query = ListAuditLogsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const limit = query.data.limit ?? 50;
  const offset = query.data.offset ?? 0;

  const allLogs = await db.select().from(aiAuditLogsTable).orderBy(desc(aiAuditLogsTable.createdAt));
  let filtered = allLogs;
  if (query.data.module != null) filtered = filtered.filter(l => l.module === query.data.module);
  if (query.data.action != null) filtered = filtered.filter(l => l.action === query.data.action);
  // WP-03 additions — additive-only filters, existing consumers (audit.tsx) are unaffected.
  if (query.data.tenantId != null) filtered = filtered.filter(l => l.tenantId === query.data.tenantId);
  if (query.data.actorType != null) filtered = filtered.filter(l => l.actorType === query.data.actorType);

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);

  res.json(ListAuditLogsResponse.parse({ items, total, limit, offset }));
});

export default router;
