import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiSettingsTable } from "@workspace/db";
import { isDevWakeRuntime, loadDevWakeRuntimeConfig } from "../services/devChatGptWakeBindingService.js";
import { stageDevChatGptAccountBinding } from "../services/devChatGptAccountProvisioningService.js";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();
const REGISTRY_KEY = "dev.chatgpt_wake.account_bindings";

router.post("/ai/core-chat/dev/accounts/stage", async (req, res): Promise<void> => {
  if (!isDevWakeRuntime(req.hostname)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== "object" ||
      typeof body["ownerChannel"] !== "string" ||
      typeof body["targetConversationId"] !== "string" ||
      (body["accountAlias"] !== undefined && typeof body["accountAlias"] !== "string") ||
      (body["browserProfile"] !== undefined && typeof body["browserProfile"] !== "string")) {
    res.status(400).json({ error: "Invalid provisioning request" });
    return;
  }

  try {
    const runtime = await loadDevWakeRuntimeConfig(req.hostname);
    const [existing] = await db.select().from(aiSettingsTable)
      .where(eq(aiSettingsTable.key, REGISTRY_KEY))
      .limit(1);

    const staged = stageDevChatGptAccountBinding({
      ownerChannel: body["ownerChannel"],
      targetConversationId: body["targetConversationId"],
      ...(typeof body["accountAlias"] === "string" ? { accountAlias: body["accountAlias"] } : {}),
      ...(typeof body["browserProfile"] === "string" ? { browserProfile: body["browserProfile"] } : {}),
    }, existing?.value, runtime.legacyTargets);

    if (!staged.alreadyStaged) {
      if (existing) {
        await db.update(aiSettingsTable).set({
          value: staged.registryJson,
          valueType: "json",
          category: "guardrail",
          isSecret: false,
          description: "DEV ChatGPT account bindings. New accounts are staged disabled until live E2E verification.",
        }).where(eq(aiSettingsTable.key, REGISTRY_KEY));
      } else {
        await db.insert(aiSettingsTable).values({
          key: REGISTRY_KEY,
          value: staged.registryJson,
          valueType: "json",
          category: "guardrail",
          isSecret: false,
          description: "DEV ChatGPT account bindings. New accounts are staged disabled until live E2E verification.",
        });
      }
      await logAudit("ai_core", "stage_dev_chatgpt_account", staged.accountAlias, "chatgpt_account_binding");
    }

    res.status(staged.alreadyStaged ? 200 : 201).json({
      status: staged.alreadyStaged ? "ALREADY_STAGED" : "STAGED",
      accountAlias: staged.accountAlias,
      browserProfile: staged.browserProfile,
      workerId: staged.workerId,
      bindingFingerprint: staged.bindingFingerprint,
      enabled: false,
      next: [
        "Login the target ChatGPT account in the dedicated browser profile.",
        "Complete its own OAuth/MCP pairing.",
        "Run one correlated DEV E2E verification.",
        "Enable only after assistant attestation, callback, and final ACK are verified.",
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DEV_CHATGPT_PROVISIONING_FAILED";
    const conflict = /CONFLICT|LEGACY_CONFLICT|ALIAS|OWNER|CONVERSATION|PROFILE|REGISTRY/.test(message);
    res.status(conflict ? 409 : 500).json({ error: message });
  }
});

export default router;
