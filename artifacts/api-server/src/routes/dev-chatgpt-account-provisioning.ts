import { Router, type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, aiSettingsTable } from "@workspace/db";
import {
  DEV_WAKE_DELL_WORKER,
  DEV_WAKE_DEFAULT_WORKER,
  DEV_WAKE_PC2_WORKER,
  DEV_WAKE_VMSC_WORKER,
  isDevWakeRuntime,
  loadDevWakeRuntimeConfig,
} from "../services/devChatGptWakeBindingService.js";
import { stageDevChatGptAccountBinding } from "../services/devChatGptAccountProvisioningService.js";
import {
  activateDevChatGptSessionBinding,
  issueDevChatGptSessionChallenge,
  sessionRegistrationReceiptFingerprint,
  verifyAndConsumeDevChatGptSessionChallenge,
} from "../services/devChatGptSessionActivationService.js";
import { requireAgentServiceScope } from "../middleware/agentServiceAuth.js";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();
const REGISTRY_KEY = "dev.chatgpt_wake.account_bindings";

function requireDevRuntime(req: Request, res: Response, next: NextFunction): void {
  if (!isDevWakeRuntime(req.hostname)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

router.post("/ai/core-chat/dev/accounts/stage", requireDevRuntime, requireAgentServiceScope("agent:work"), async (req, res): Promise<void> => {
  if (!isDevWakeRuntime(req.hostname)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== "object" ||
      typeof body["ownerChannel"] !== "string" ||
      typeof body["targetConversationId"] !== "string" ||
      (body["accountAlias"] !== undefined && typeof body["accountAlias"] !== "string") ||
      (body["browserProfile"] !== undefined && typeof body["browserProfile"] !== "string") ||
      (body["workerId"] !== undefined && typeof body["workerId"] !== "string")) {
    res.status(400).json({ error: "Invalid provisioning request" });
    return;
  }

  try {
    const workerId = body["workerId"];
    if (workerId !== undefined && workerId !== DEV_WAKE_DELL_WORKER && workerId !== DEV_WAKE_DEFAULT_WORKER && workerId !== DEV_WAKE_PC2_WORKER && workerId !== DEV_WAKE_VMSC_WORKER) {
      res.status(400).json({ error: "DEV_CHATGPT_PROVISIONING_WORKER_INVALID" });
      return;
    }
    const authenticatedWorker = (res.locals["aiAgentService"] as { name?: unknown } | undefined)?.name;
    if (typeof workerId !== "string" || authenticatedWorker !== workerId) {
      res.status(403).json({ error: "Worker credential does not match requested session worker" });
      return;
    }
    const runtime = await loadDevWakeRuntimeConfig(req.hostname);
    const [existing] = await db.select().from(aiSettingsTable)
      .where(eq(aiSettingsTable.key, REGISTRY_KEY))
      .limit(1);

    const staged = stageDevChatGptAccountBinding({
      ownerChannel: body["ownerChannel"],
      targetConversationId: body["targetConversationId"],
      ...(typeof body["accountAlias"] === "string" ? { accountAlias: body["accountAlias"] } : {}),
      ...(typeof body["browserProfile"] === "string" ? { browserProfile: body["browserProfile"] } : {}),
      ...(workerId === DEV_WAKE_DELL_WORKER || workerId === DEV_WAKE_DEFAULT_WORKER || workerId === DEV_WAKE_PC2_WORKER || workerId === DEV_WAKE_VMSC_WORKER ? { workerId } : {}),
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
        "Run the trusted worker session-registration helper.",
        "The helper verifies the exact ChatGPT conversation and signs a one-time DEV challenge.",
        "The session becomes eligible only after Ed25519 verification succeeds.",
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DEV_CHATGPT_PROVISIONING_FAILED";
    const conflict = /CONFLICT|LEGACY_CONFLICT|ALIAS|OWNER|CONVERSATION|PROFILE|REGISTRY/.test(message);
    res.status(conflict ? 409 : 500).json({ error: message });
  }
});

router.post("/ai/core-chat/dev/accounts/session/challenge", requireDevRuntime, requireAgentServiceScope("agent:work"), async (req, res): Promise<void> => {
  if (!isDevWakeRuntime(req.hostname)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body["bindingFingerprint"] !== "string") {
    res.status(400).json({ error: "Invalid session challenge request" });
    return;
  }
  try {
    const runtime = await loadDevWakeRuntimeConfig(req.hostname);
    const [existing] = await db.select().from(aiSettingsTable)
      .where(eq(aiSettingsTable.key, REGISTRY_KEY)).limit(1);
    const authenticatedWorker = (res.locals["aiAgentService"] as { name?: unknown } | undefined)?.name;
    if (typeof authenticatedWorker !== "string") {
      res.status(403).json({ error: "Authenticated worker identity is missing" });
      return;
    }
    const challenge = issueDevChatGptSessionChallenge({
      rawRegistry: existing?.value,
      bindingFingerprint: body["bindingFingerprint"],
      legacyTargets: runtime.legacyTargets,
      expectedWorkerId: authenticatedWorker,
    });
    res.status(201).json({
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      accountAlias: challenge.accountAlias,
      ownerChannel: challenge.ownerChannel,
      targetConversationId: challenge.targetConversationId,
      workerId: challenge.workerId,
      browserProfile: challenge.browserProfile,
      bindingFingerprint: challenge.bindingFingerprint,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DEV_CHATGPT_SESSION_CHALLENGE_FAILED";
    res.status(/NOT_FOUND/.test(message) ? 404 : 409).json({ error: message });
  }
});

router.post("/ai/core-chat/dev/accounts/session/activate", requireDevRuntime, requireAgentServiceScope("agent:work"), async (req, res): Promise<void> => {
  if (!isDevWakeRuntime(req.hostname)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body["challengeId"] !== "string" ||
      typeof body["nonce"] !== "string" ||
      typeof body["observedAt"] !== "string" ||
      typeof body["signature"] !== "string" ||
      typeof body["keyId"] !== "string") {
    res.status(400).json({ error: "Invalid session activation request" });
    return;
  }
  try {
    const authenticatedWorker = (res.locals["aiAgentService"] as { name?: unknown } | undefined)?.name;
    if (typeof authenticatedWorker !== "string") {
      res.status(403).json({ error: "Authenticated worker identity is missing" });
      return;
    }
    const verified = verifyAndConsumeDevChatGptSessionChallenge({
      challengeId: body["challengeId"],
      nonce: body["nonce"],
      observedAt: body["observedAt"],
      signature: body["signature"],
      keyId: body["keyId"],
      expectedWorkerId: authenticatedWorker,
    });
    const runtime = await loadDevWakeRuntimeConfig(req.hostname);
    const [existing] = await db.select().from(aiSettingsTable)
      .where(eq(aiSettingsTable.key, REGISTRY_KEY)).limit(1);
    if (!existing) throw new Error("DEV_CHATGPT_SESSION_REGISTRY_MISSING");
    const activated = activateDevChatGptSessionBinding({
      rawRegistry: existing.value,
      bindingFingerprint: verified.bindingFingerprint,
      legacyTargets: runtime.legacyTargets,
    });
    await db.update(aiSettingsTable).set({
      value: activated.registryJson,
      valueType: "json",
      category: "guardrail",
      isSecret: false,
      description: "DEV ChatGPT account bindings with Ed25519-verified active sessions.",
    }).where(eq(aiSettingsTable.key, REGISTRY_KEY));
    const receiptFingerprint = sessionRegistrationReceiptFingerprint({
      bindingFingerprint: verified.bindingFingerprint,
      signature: body["signature"],
    });
    await logAudit("ai_core", "activate_dev_chatgpt_session", verified.accountAlias, "chatgpt_account_session");
    res.status(200).json({
      status: "SESSION_ACTIVE",
      accountAlias: verified.accountAlias,
      workerId: verified.workerId,
      browserProfile: verified.browserProfile,
      bindingFingerprint: verified.bindingFingerprint,
      receiptFingerprint,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DEV_CHATGPT_SESSION_ACTIVATION_FAILED";
    res.status(/SIGNATURE|CRYPTO|CHALLENGE|KEY_ID|TIME|UNTRUSTED/.test(message) ? 403 : 409).json({ error: message });
  }
});

export default router;
