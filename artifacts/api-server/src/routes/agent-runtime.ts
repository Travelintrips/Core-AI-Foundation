import { Router } from "express";
import { z } from "zod";
import { getProviderApiKey } from "../services/aiSecretService.js";
import { requireAgentServiceScope } from "../middleware/agentServiceAuth.js";
import { logger } from "../lib/logger.js";
import { ExternalAgentRegistryError, getExternalAgentRegistrySnapshot, heartbeatExternalAgent } from "../services/externalAgentRegistryService.js";

const router = Router();
const AGENT_MODEL_ID = "ai-core-agent";
const ExternalAgentHeartbeatRequest = z.object({
  health: z.enum(["healthy", "degraded"]),
  version: z.string().trim().min(1).max(100).nullable().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
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
      data: [{
        id: AGENT_MODEL_ID,
        object: "model",
        created: 0,
        owned_by: "ai-core",
      }],
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
      "openai/" + AGENT_MODEL_ID,
      "ai-core/" + AGENT_MODEL_ID,
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

    try {
      for (let index = 0; index < upstreams.length; index += 1) {
        const upstreamConfig = upstreams[index]!;
        const upstream = await proxyUpstream(
          upstreamConfig,
          req.body as Record<string, unknown>,
        );

        lastStatus = upstream.status;

        if (!upstream.ok) {
          logger.warn(
            {
              status: upstream.status,
              provider: upstreamConfig.provider,
              model: upstreamConfig.model,
              service: res.locals["aiAgentService"]?.name,
            },
            "[agent-runtime] upstream provider request failed",
          );

          const hasFallback = index < upstreams.length - 1;
          if (hasFallback && shouldFallback(upstream.status)) {
            await upstream.body?.cancel().catch(() => undefined);
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
