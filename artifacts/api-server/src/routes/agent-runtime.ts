import { Router } from "express";
import { z } from "zod";
import { getProviderApiKey } from "../services/aiSecretService.js";
import { requireAgentServiceScope } from "../middleware/agentServiceAuth.js";
import { logger } from "../lib/logger.js";
import { ExternalAgentRegistryError, getExternalAgentRegistrySnapshot, heartbeatExternalAgent } from "../services/externalAgentRegistryService.js";
import { claimCodingBridgeCommand, completeCodingBridgeCommand, renewCodingBridgeCommandClaim } from "../services/localCodingControlBridgeService.js";

const router = Router();
const AGENT_MODEL_ID = "ai-core-agent";
const AGENT_CHAT_MODEL_ID = "ai-core-agent-chat";
const CHAT_NO_TOOLS_MARKER = "[AI_CORE_CHAT_NO_TOOLS]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripChatNoToolsMarkerFromContent(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(CHAT_NO_TOOLS_MARKER, "").replace(/^\s+/, "");
  }
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isRecord(item) || typeof item["text"] !== "string") return item;
    return {
      ...item,
      text: item["text"]
        .replace(CHAT_NO_TOOLS_MARKER, "")
        .replace(/^\s+/, ""),
    };
  });
}

function normalizeToolFreeMessages(messages: unknown[]): Array<Record<string, unknown>> {
  const normalized: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (!isRecord(message)) continue;
    const role = String(message["role"] ?? "").trim();
    if (!["system", "developer", "user", "assistant"].includes(role)) continue;

    const rawContent = stripChatNoToolsMarkerFromContent(message["content"]);
    let content: unknown = rawContent;

    if (Array.isArray(rawContent)) {
      const parts: Array<Record<string, unknown>> = [];
      for (const part of rawContent) {
        if (!isRecord(part)) continue;
        const text = typeof part["text"] === "string" ? part["text"] : null;
        if (text !== null) {
          parts.push({ type: "text", text });
          continue;
        }
        const imageUrl = isRecord(part["image_url"]) ? part["image_url"] : null;
        if (
          part["type"] === "image_url" &&
          imageUrl &&
          typeof imageUrl["url"] === "string"
        ) {
          parts.push({
            type: "image_url",
            image_url: { url: imageUrl["url"] },
          });
        }
      }
      content = parts.length > 0 ? parts : "";
    }

    normalized.push({ role, content: content ?? "" });
  }

  return normalized;
}

function normalizeAgentRuntimeRequest(
  body: Record<string, unknown>,
): { body: Record<string, unknown>; toolFree: boolean } {
  const messages = Array.isArray(body["messages"])
    ? body["messages"]
    : [];
  const markerPresent = messages.some((message) => {
    if (!isRecord(message)) return false;
    const content = message["content"];
    if (typeof content === "string") return content.includes(CHAT_NO_TOOLS_MARKER);
    if (!Array.isArray(content)) return false;
    return content.some(
      (part) =>
        isRecord(part) &&
        typeof part["text"] === "string" &&
        part["text"].includes(CHAT_NO_TOOLS_MARKER),
    );
  });
  const requestedModel = String(body["model"] ?? "").trim().toLowerCase();
  const toolFree =
    markerPresent ||
    requestedModel === AGENT_CHAT_MODEL_ID ||
    requestedModel.endsWith("/" + AGENT_CHAT_MODEL_ID);

  const normalized: Record<string, unknown> = {
    ...body,
    messages: messages.map((message) => {
      if (!isRecord(message)) return message;
      return {
        ...message,
        content: stripChatNoToolsMarkerFromContent(message["content"]),
      };
    }),
  };

  if (toolFree) {
    const minimal: Record<string, unknown> = {
      model: body["model"],
      messages: normalizeToolFreeMessages(messages),
      stream: false,
    };
    return { body: minimal, toolFree };
  }

  return { body: normalized, toolFree };
}
const ExternalAgentHeartbeatRequest = z.object({
  health: z.enum(["healthy", "degraded"]),
  version: z.string().trim().min(1).max(100).nullable().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

const ExternalAgentWorkClaimRequest = z.object({
  clientId: z.string().trim().min(1).max(200),
  leaseSeconds: z.number().int().min(30).max(300).optional(),
}).strict();

const ExternalAgentWorkResultRequest = z.object({
  clientId: z.string().trim().min(1).max(200),
  claimToken: z.string().uuid(),
  status: z.enum(["COMPLETED", "FAILED"]),
  message: z.string().trim().min(1).max(50_000),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

const ExternalAgentWorkRenewRequest = z.object({
  clientId: z.string().trim().min(1).max(200),
  claimToken: z.string().uuid(),
  leaseSeconds: z.number().int().min(30).max(300).optional(),
}).strict();

const ChatCompletionRequest = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(z.object({
    role: z.string().min(1).max(40),
    content: z.unknown(),
  }).passthrough()).min(1).max(500),
  stream: z.boolean().optional(),
}).passthrough();

interface AgentUpstream {
  provider: "openai" | "gemini" | "mistral" | "anthropic";
  model: string;
  url: string;
  apiKey: string;
}

function configuredUpstreams(): AgentUpstream[] {
  const result: AgentUpstream[] = [];

  const openaiKey = getProviderApiKey("openai");
  if (openaiKey) {
    result.push({
      provider: "openai",
      model: (process.env["AI_AGENT_RUNTIME_OPENAI_MODEL"] ?? "gpt-4o").trim() || "gpt-4o",
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: openaiKey,
    });
  }

  const geminiKey = getProviderApiKey("gemini");
  if (geminiKey) {
    result.push({
      provider: "gemini",
      model: (process.env["AI_AGENT_RUNTIME_GEMINI_MODEL"] ?? "gemini-3.8-flash").trim() || "gemini-3.8-flash",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: geminiKey,
    });
  }

  const mistralKey = getProviderApiKey("mistral");
  if (mistralKey) {
    result.push({
      provider: "mistral",
      model: (process.env["AI_AGENT_RUNTIME_MISTRAL_MODEL"] ?? "mistral-small-latest").trim() || "mistral-small-latest",
      url: "https://api.mistral.ai/v1/chat/completions",
      apiKey: mistralKey,
    });
  }

  const anthropicKey = getProviderApiKey("anthropic");
  if (anthropicKey) {
    result.push({
      provider: "anthropic",
      model: (process.env["AI_AGENT_RUNTIME_ANTHROPIC_MODEL"] ?? "claude-opus-4-8").trim() || "claude-opus-4-8",
      // Anthropic exposes an OpenAI-compatible chat/completions surface.
      // Keeping the same wire format preserves streaming and tool-calling
      // semantics expected by OpenClaw while giving the runtime another
      // independent cloud fallback when OpenAI/Gemini/Mistral are limited.
      url: "https://api.anthropic.com/v1/chat/completions",
      apiKey: anthropicKey,
    });
  }

  return result;
}

function safeUpstreamFailure(status: number): Record<string, unknown> {
  return {
    error: {
      message: status === 429
        ? "AI Core agent runtime providers are rate limited."
        : "AI Core agent runtime provider request failed.",
      type: "ai_core_agent_runtime_error",
      status,
    },
  };
}

function shouldFallback(status: number): boolean {
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function proxyUpstream(
  upstream: AgentUpstream,
  requestBody: Record<string, unknown>,
): Promise<Response> {
  return fetch(upstream.url, {
    method: "POST",
    headers: {
      authorization: "Bearer " + upstream.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...requestBody,
      model: upstream.model,
    }),
    signal: AbortSignal.timeout(180_000),
  });
}

router.post(
  "/ai/agent-runtime/presence/:clientId/heartbeat",
  requireAgentServiceScope("agent:presence"),
  async (req, res): Promise<void> => {
    const body = ExternalAgentHeartbeatRequest.safeParse(req.body ?? {});
    const clientId = String(req.params["clientId"] ?? "").trim();
    if (!body.success || !clientId) {
      res.status(400).json({ error: body.success ? "Invalid clientId" : body.error.message });
      return;
    }
    try {
      res.json(await heartbeatExternalAgent({ clientId, ...body.data }));
    } catch (error) {
      if (error instanceof ExternalAgentRegistryError) {
        res.status(error.code === "UNKNOWN_AGENT" ? 404 : 400).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/ai/agent-runtime/registry",
  requireAgentServiceScope("agent:presence"),
  async (_req, res): Promise<void> => {
    const agents = await getExternalAgentRegistrySnapshot();
    res.json({ authority: "ai-core", policyVersion: 1, agents });
  },
);

router.get(
  "/ai/agent-runtime/registry/health",
  requireAgentServiceScope("agent:presence"),
  async (_req, res): Promise<void> => {
    const agents = await getExternalAgentRegistrySnapshot();
    const ready = agents.every((agent) => agent.eligible);
    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "degraded",
      authority: "ai-core",
      agents,
    });
  },
);

router.post(
  "/ai/agent-runtime/work/claim",
  requireAgentServiceScope("agent:work"),
  async (req, res): Promise<void> => {
    const parsed = ExternalAgentWorkClaimRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const rule = (await import("../services/externalAgentRegistryService.js")).getExternalAgentRule(parsed.data.clientId);
    if (!rule) {
      res.status(404).json({ error: "Unknown external agent client ID" });
      return;
    }
    const work = await claimCodingBridgeCommand(parsed.data);
    if (!work) {
      res.status(204).end();
      return;
    }
    res.json(work);
  },
);

router.post(
  "/ai/agent-runtime/work/:commandId/renew",
  requireAgentServiceScope("agent:work"),
  async (req, res): Promise<void> => {
    const commandId = z.string().uuid().safeParse(req.params["commandId"]);
    const parsed = ExternalAgentWorkRenewRequest.safeParse(req.body ?? {});
    if (!commandId.success) {
      res.status(400).json({ error: "Invalid command id" });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const renewed = await renewCodingBridgeCommandClaim({
      commandId: commandId.data,
      ...parsed.data,
    });
    res.status(renewed ? 200 : 409).json({ renewed });
  },
);

router.post(
  "/ai/agent-runtime/work/:commandId/result",
  requireAgentServiceScope("agent:work"),
  async (req, res): Promise<void> => {
    const commandId = z.string().uuid().safeParse(req.params["commandId"]);
    const parsed = ExternalAgentWorkResultRequest.safeParse(req.body ?? {});
    if (!commandId.success) {
      res.status(400).json({ error: "Invalid command id" });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const result = await completeCodingBridgeCommand({
      commandId: commandId.data,
      ...parsed.data,
    });
    if (!result) {
      res.status(409).json({ error: "Work claim is missing, expired, or owned by another agent" });
      return;
    }
    res.json(result);
  },
);

router.get(
  "/ai/agent-runtime/health",
  requireAgentServiceScope("model:chat"),
  (_req, res) => {
    const upstreams = configuredUpstreams();
    res.json({
      status: upstreams.length > 0 ? "ok" : "degraded",
      service: "ai-core-agent-runtime",
      model: AGENT_MODEL_ID,
      providers: upstreams.map((item) => ({
        provider: item.provider,
        model: item.model,
      })),
      upstreamConfigured: upstreams.length > 0,
    });
  },
);

router.get(
  "/ai/agent-runtime/v1/models",
  requireAgentServiceScope("model:chat"),
  (_req, res) => {
    res.json({
      object: "list",
      data: [AGENT_MODEL_ID, AGENT_CHAT_MODEL_ID].map((id) => ({
        id,
        object: "model",
        created: 0,
        owned_by: "ai-core",
      })),
    });
  },
);

router.post(
  "/ai/agent-runtime/v1/chat/completions",
  requireAgentServiceScope("model:chat"),
  async (req, res): Promise<void> => {
    const parsed = ChatCompletionRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          message: parsed.error.message,
          type: "invalid_request_error",
        },
      });
      return;
    }

    const requestedModel = parsed.data.model.trim().toLowerCase();
    const allowedModelRefs = new Set([
      AGENT_MODEL_ID,
      AGENT_CHAT_MODEL_ID,
      "openai/" + AGENT_MODEL_ID,
      "openai/" + AGENT_CHAT_MODEL_ID,
      "ai-core/" + AGENT_MODEL_ID,
      "ai-core/" + AGENT_CHAT_MODEL_ID,
    ]);
    if (!allowedModelRefs.has(requestedModel)) {
      res.status(400).json({
        error: {
          message: "Unknown AI Core agent runtime model.",
          type: "invalid_request_error",
        },
      });
      return;
    }

    const upstreams = configuredUpstreams();
    if (upstreams.length === 0) {
      res.status(503).json({
        error: {
          message: "AI Core agent runtime has no configured provider.",
          type: "provider_unavailable",
        },
      });
      return;
    }

    let lastStatus = 503;
    const normalizedRequest = normalizeAgentRuntimeRequest(
      req.body as Record<string, unknown>,
    );

    try {
      for (let index = 0; index < upstreams.length; index += 1) {
        const upstreamConfig = upstreams[index]!;
        const upstream = await proxyUpstream(
          upstreamConfig,
          normalizedRequest.body,
        );

        lastStatus = upstream.status;

        if (!upstream.ok) {
          const errorText = await upstream.text().catch(() => "");
          let upstreamError: Record<string, unknown> = {};
          try {
            const parsedError = errorText ? JSON.parse(errorText) : {};
            const candidate =
              isRecord(parsedError) && isRecord(parsedError["error"])
                ? parsedError["error"]
                : parsedError;
            upstreamError = isRecord(candidate) ? candidate : {};
          } catch {
            upstreamError = {};
          }
          logger.warn(
            {
              status: upstream.status,
              provider: upstreamConfig.provider,
              model: upstreamConfig.model,
              service: res.locals["aiAgentService"]?.name,
              toolFree: normalizedRequest.toolFree,
              upstreamError: {
                type: upstreamError["type"] ?? null,
                code: upstreamError["code"] ?? null,
                param: upstreamError["param"] ?? null,
                message:
                  typeof upstreamError["message"] === "string"
                    ? upstreamError["message"].slice(0, 500)
                    : null,
              },
            },
            "[agent-runtime] upstream provider request failed",
          );

          const hasFallback = index < upstreams.length - 1;
          if (hasFallback && shouldFallback(upstream.status)) {
            continue;
          }

          res.status(upstream.status).json(safeUpstreamFailure(upstream.status));
          return;
        }

        res.setHeader("x-ai-core-agent-runtime", "1");
        res.setHeader("x-ai-core-provider", upstreamConfig.provider);
        res.setHeader("x-ai-core-model", upstreamConfig.model);

        if (parsed.data.stream === true) {
          res.status(200);
          res.setHeader("content-type", upstream.headers.get("content-type") ?? "text/event-stream");
          res.setHeader("cache-control", "no-cache");
          if (!upstream.body) {
            res.end();
            return;
          }

          const reader = upstream.body.getReader();
          try {
            while (!res.writableEnded) {
              const chunk = await reader.read();
              if (chunk.done) break;
              res.write(Buffer.from(chunk.value));
            }
          } finally {
            reader.releaseLock();
          }
          res.end();
          return;
        }

        const payload = await upstream.json();
        res.status(200).json(payload);
        return;
      }

      res.status(lastStatus).json(safeUpstreamFailure(lastStatus));
    } catch (error) {
      logger.error(
        { err: error, service: res.locals["aiAgentService"]?.name },
        "[agent-runtime] provider proxy failed",
      );
      res.status(503).json({
        error: {
          message: "AI Core agent runtime is temporarily unavailable.",
          type: "provider_unavailable",
        },
      });
    }
  },
);

export default router;
