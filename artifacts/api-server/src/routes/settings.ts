import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiSettingsTable } from "@workspace/db";
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
import { logAudit } from "../services/aiAuditService.js";
import { maskSecretValue, isSecretKey } from "../services/aiSecretService.js";

const router = Router();

/** Mask value if the setting is marked as a secret or the key looks like a secret. */
function sanitize(setting: { key: string; value: string; isSecret: boolean }) {
  if (setting.isSecret || isSecretKey(setting.key)) {
    return { ...setting, value: maskSecretValue(setting.value) };
  }
  return setting;
}

router.get("/ai/settings", async (_req, res): Promise<void> => {
  const settings = await db
    .select()
    .from(aiSettingsTable)
    .orderBy(aiSettingsTable.category, aiSettingsTable.key);
  // Mask any secret values before returning
  const safe = settings.map(sanitize);
  res.json(ListSettingsResponse.parse(safe));
});

router.get("/ai/settings/:key", async (req, res): Promise<void> => {
  const params = GetSettingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [setting] = await db
    .select()
    .from(aiSettingsTable)
    .where(eq(aiSettingsTable.key, params.data.key));
  if (!setting) {
    res.status(404).json({ error: "Setting not found" });
    return;
  }
  res.json(GetSettingResponse.parse(sanitize(setting)));
});

router.put("/ai/settings/:key", async (req, res): Promise<void> => {
  const params = UpsertSettingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpsertSettingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // If the value looks like an actual secret (long, contains special chars), reject storage.
  // Settings should only store env-var references like "OPENAI_API_KEY", not the raw key.
  const { key } = params.data;
  const { value, isSecret } = parsed.data;
  if ((isSecret || isSecretKey(key)) && value && value.length > 80) {
    res.status(400).json({
      error:
        "Secret values must not be stored in Settings. Store the environment variable name instead (e.g., \"OPENAI_API_KEY\"), then set the actual value as a Replit Secret.",
    });
    return;
  }

  const existing = await db
    .select()
    .from(aiSettingsTable)
    .where(eq(aiSettingsTable.key, key));

  let setting;
  if (existing.length > 0) {
    const updateData: Record<string, unknown> = { value: parsed.data.value };
    if (parsed.data.valueType !== undefined) updateData.valueType = parsed.data.valueType;
    if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.isSecret !== undefined) updateData.isSecret = parsed.data.isSecret;
    [setting] = await db
      .update(aiSettingsTable)
      .set(updateData)
      .where(eq(aiSettingsTable.key, key))
      .returning();
  } else {
    [setting] = await db
      .insert(aiSettingsTable)
      .values({
        key,
        value: parsed.data.value,
        valueType: parsed.data.valueType ?? "string",
        category: parsed.data.category ?? "general",
        description: parsed.data.description ?? null,
        isSecret: parsed.data.isSecret ?? false,
      })
      .returning();
  }

  await logAudit("settings", "upsert_setting", key, "setting");
  res.json(UpsertSettingResponse.parse(sanitize(setting)));
});

router.delete("/ai/settings/:key", async (req, res): Promise<void> => {
  const params = DeleteSettingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [setting] = await db
    .delete(aiSettingsTable)
    .where(eq(aiSettingsTable.key, params.data.key))
    .returning();
  if (!setting) {
    res.status(404).json({ error: "Setting not found" });
    return;
  }
  await logAudit("settings", "delete_setting", params.data.key, "setting");
  res.sendStatus(204);
  DeleteSettingResponse.parse(undefined);
});

export default router;
