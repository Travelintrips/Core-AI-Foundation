import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiSettingsTable, aiAuditLogsTable } from "@workspace/db";
import {
  UpsertSettingBody,
  GetSettingParams,
  UpsertSettingParams,
  DeleteSettingParams,
  ListSettingsResponse,
  GetSettingResponse,
  UpsertSettingResponse,
  DeleteSettingResponse,
} from "@workspace/api-zod";

const router = Router();

async function logAudit(module: string, action: string, resourceId: string, resourceType: string, status: "success" | "failure" = "success") {
  await db.insert(aiAuditLogsTable).values({ module, action, resourceId, resourceType, status, details: null });
}

router.get("/ai/settings", async (_req, res): Promise<void> => {
  const settings = await db.select().from(aiSettingsTable).orderBy(aiSettingsTable.category, aiSettingsTable.key);
  res.json(ListSettingsResponse.parse(settings));
});

router.get("/ai/settings/:key", async (req, res): Promise<void> => {
  const params = GetSettingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [setting] = await db.select().from(aiSettingsTable).where(eq(aiSettingsTable.key, params.data.key));
  if (!setting) { res.status(404).json({ error: "Setting not found" }); return; }
  res.json(GetSettingResponse.parse(setting));
});

router.put("/ai/settings/:key", async (req, res): Promise<void> => {
  const params = UpsertSettingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpsertSettingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = await db.select().from(aiSettingsTable).where(eq(aiSettingsTable.key, params.data.key));
  let setting;
  if (existing.length > 0) {
    const updateData: Record<string, unknown> = { value: parsed.data.value };
    if (parsed.data.valueType !== undefined) updateData.valueType = parsed.data.valueType;
    if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.isSecret !== undefined) updateData.isSecret = parsed.data.isSecret;
    [setting] = await db.update(aiSettingsTable).set(updateData).where(eq(aiSettingsTable.key, params.data.key)).returning();
  } else {
    [setting] = await db.insert(aiSettingsTable).values({
      key: params.data.key,
      value: parsed.data.value,
      valueType: parsed.data.valueType ?? "string",
      category: parsed.data.category ?? "general",
      description: parsed.data.description ?? null,
      isSecret: parsed.data.isSecret ?? false,
    }).returning();
  }
  await logAudit("settings", "upsert_setting", params.data.key, "setting");
  res.json(UpsertSettingResponse.parse(setting));
});

router.delete("/ai/settings/:key", async (req, res): Promise<void> => {
  const params = DeleteSettingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [setting] = await db.delete(aiSettingsTable).where(eq(aiSettingsTable.key, params.data.key)).returning();
  if (!setting) { res.status(404).json({ error: "Setting not found" }); return; }
  await logAudit("settings", "delete_setting", params.data.key, "setting");
  res.sendStatus(204);
  DeleteSettingResponse.parse(undefined);
});

export default router;
