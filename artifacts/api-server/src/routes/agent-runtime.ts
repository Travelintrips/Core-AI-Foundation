import { Router } from "express";
import { z } from "zod";
import { getProviderApiKey } from "../services/aiSecretService.js";
import { requireAgentServiceScope } from "../middleware/agentServiceAuth.js";
import { logger } from "../lib/logger.js";

const router = Router();
const AGENT_MODEL_ID = "ai-core-agent";

const ChatCompletionRequest = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(z.object({
    role: z.string().min(1).max(40),
    content: z.unknown(),
  }).passthrough()).min(1).max(500),
  stream: z.boolean().optional(),
}).passthrough();

function upstreamModel(): string {
  return (process.env["AI_AGENT_RUNTIME_OPENAI_MODEL"] ?? "gpt-4o").trim() || "gpt-4o";
}

function safeUpstreamFailure(status: number): Record<string, unknown> {
  return {
    error: {
      message: status === 429
        ? "AI Core agent runtime provider is rate limited."
        : "AI Core agent runtime provider request failed.",
      type: "ai_core_agent_runtime_error",
      status,
    },
  };
}

router.get(
  "/ai/agent-runtime/health",
  requireAgentServiceScope("model:chat"),
  (_req, res) => {
    res.json({
      status: "ok",
      service: "ai-core-agent-runtime",
      provider: "openai",
      model: AGENT_MODEL_ID,
      upstreamConfigured: Boolean(getProviderApiKey("openai")),
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

    const providerKey = getProviderApiKey("openai");
    if (!providerKey) {
      res.status(503).json({
        error: {
          message: "AI Core OpenAI provider is not configured.",
          type: "provider_unavailable",
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

    const body = {
      ...(req.body as Record<string, unknown>),
      model: upstreamModel(),
    };

    try {
      const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer " + providerKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });

      res.setHeader("x-ai-core-agent-runtime", "1");
      res.setHeader("x-ai-core-provider", "openai");

      if (!upstream.ok) {
        logger.warn(
          { status: upstream.status, service: res.locals["aiAgentService"]?.name },
          "[agent-runtime] upstream provider request failed",
        );
        res.status(upstream.status).json(safeUpstreamFailure(upstream.status));
        return;
      }

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
