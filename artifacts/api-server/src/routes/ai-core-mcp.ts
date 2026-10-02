import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { resolveAiCoreInternalBaseUrl } from "../services/aiCoreWhatsappChatService.js";

const router = Router();
const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "ai-core-direct-command", version: "1.0.0" };

const SendCommandArgs = z.object({
  message: z.string().trim().min(1).max(50_000),
  modelPolicy: z.enum(["economy", "smart", "auto", "cloud"]).default("smart"),
  projectName: z.string().trim().min(1).max(200).default("Core AI Foundation"),
  repository: z.string().trim().min(1).max(500).default("Travelintrips/Core-AI-Foundation"),
  branch: z.string().trim().min(1).max(200).default("main"),
  priority: z.number().int().min(0).max(100).default(50),
  conversationId: z.string().trim().min(1).max(200).optional(),
}).strict();

const TaskProgressArgs = z.object({
  taskId: z.string().uuid(),
}).strict();

function safeEqualSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearerToken(req: Request): string {
  const header = String(req.headers.authorization ?? "").trim();
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function authenticate(req: Request, res: Response): string | null {
  const configured = process.env["AI_CORE_CHAT_CONNECTOR_KEY"]?.trim() ?? "";
  const supplied = bearerToken(req);
  if (!configured || !supplied || !safeEqualSecret(supplied, configured)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="ai-core-mcp"');
    res.status(401).json({ error: "Unauthorized MCP request" });
    return null;
  }
  return configured;
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

const tools = [
  {
    name: "send_ai_core_command",
    description:
      "Send a text instruction directly to AI Core Agent Mode. Use for coding, fixes, deployment work, audits, and other executable AI Core tasks.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["message"],
      properties: {
        message: { type: "string", minLength: 1, maxLength: 50000 },
        modelPolicy: { type: "string", enum: ["economy", "smart", "auto", "cloud"], default: "smart" },
        projectName: { type: "string", default: "Core AI Foundation" },
        repository: { type: "string", default: "Travelintrips/Core-AI-Foundation" },
        branch: { type: "string", default: "main" },
        priority: { type: "integer", minimum: 0, maximum: 100, default: 50 },
        conversationId: { type: "string" },
      },
    },
    annotations: {
      title: "Send AI Core Command",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "get_ai_core_task_progress",
    description:
      "Read the current status, latest run, result summary, and workspace URL for an AI Core coding task.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId"],
      properties: {
        taskId: { type: "string", format: "uuid" },
      },
    },
    annotations: {
      title: "Get AI Core Task Progress",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

async function callAiCore(path: string, init: RequestInit, key: string) {
  const baseUrl = resolveAiCoreInternalBaseUrl().replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-ai-core-connector-key": key,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep text payload when upstream is not JSON.
  }
  if (!response.ok) {
    throw new Error(`AI Core upstream HTTP ${response.status}: ${typeof payload === "string" ? payload.slice(0, 500) : JSON.stringify(payload)}`);
  }
  return payload;
}

router.post("/ai/core-chat/mcp", async (req, res): Promise<void> => {
  const key = authenticate(req, res);
  if (!key) return;

  const body = req.body as {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    params?: unknown;
  };

  if (body?.jsonrpc !== "2.0" || typeof body?.method !== "string") {
    res.status(400).json(rpcError(body?.id ?? null, -32600, "Invalid Request"));
    return;
  }

  if (body.method === "notifications/initialized") {
    res.status(202).end();
    return;
  }

  if (body.method === "initialize") {
    res.status(200).json(
      rpcResult(body.id ?? null, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      }),
    );
    return;
  }

  if (body.method === "ping") {
    res.status(200).json(rpcResult(body.id ?? null, {}));
    return;
  }

  if (body.method === "tools/list") {
    res.status(200).json(rpcResult(body.id ?? null, { tools }));
    return;
  }

  if (body.method !== "tools/call") {
    res.status(200).json(rpcError(body.id ?? null, -32601, "Method not found"));
    return;
  }

  const params = (body.params ?? {}) as { name?: unknown; arguments?: unknown };
  if (typeof params.name !== "string") {
    res.status(200).json(rpcError(body.id ?? null, -32602, "Invalid params"));
    return;
  }

  try {
    let payload: unknown;
    if (params.name === "send_ai_core_command") {
      const parsed = SendCommandArgs.parse(params.arguments ?? {});
      payload = await callAiCore(
        "/ai/core-chat/messages",
        {
          method: "POST",
          body: JSON.stringify({
            ...parsed,
            mode: "agent",
            source: "text",
          }),
        },
        key,
      );
    } else if (params.name === "get_ai_core_task_progress") {
      const parsed = TaskProgressArgs.parse(params.arguments ?? {});
      payload = await callAiCore(
        `/ai/core-chat/tasks/${encodeURIComponent(parsed.taskId)}/progress`,
        { method: "GET" },
        key,
      );
    } else {
      res.status(200).json(rpcError(body.id ?? null, -32602, `Unknown tool: ${params.name}`));
      return;
    }

    res.status(200).json(
      rpcResult(body.id ?? null, {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
        isError: false,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP tool call failed";
    res.status(200).json(
      rpcResult(body.id ?? null, {
        content: [{ type: "text", text: message }],
        isError: true,
      }),
    );
  }
});

router.get("/ai/core-chat/mcp", (_req, res): void => {
  res.setHeader("Allow", "POST");
  res.status(405).json({ error: "Use MCP Streamable HTTP POST requests." });
});

export default router;
