import { timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { resolveAiCoreInternalBaseUrl } from "../services/aiCoreWhatsappChatService.js";
import { isAllowedLocalMcpServiceToken } from "../services/mcpLocalServiceTokenService.js";
import {
  oauthIssuer,
  oauthResource,
  verifyMcpAccessToken,
} from "../services/aiCoreMcpOAuthService.js";

const router = Router();
const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "ai-core-direct-command", version: "1.2.0" };

const SendCommandArgs = z.object({
  message: z.string().trim().min(1).max(50_000),
  modelPolicy: z.enum(["economy", "smart", "auto", "cloud"]).default("smart"),
  projectName: z.string().trim().min(1).max(200).default("Core AI Foundation"),
  repository: z.string().trim().min(1).max(500).default("Travelintrips/Core-AI-Foundation"),
  branch: z.string().trim().min(1).max(200).default("main"),
  priority: z.number().int().min(0).max(100).default(50),
  conversationId: z.string().trim().min(1).max(200).optional(),
}).strict();

function executionGatedMessage(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("@")) return null;
  const command = trimmed.slice(1).trim();
  return command.length > 0 ? command : null;
}

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

type McpIdentity =
  | { kind: "legacy"; connectorKey: string; scopes: Set<string>; user: null }
  | {
      kind: "oauth";
      connectorKey: string;
      scopes: Set<string>;
      user: Awaited<ReturnType<typeof verifyMcpAccessToken>>["user"];
    };

async function authenticate(req: Request): Promise<McpIdentity | null> {
  const supplied = bearerToken(req);
  if (!supplied) return null;

  const connectorKey = process.env["AI_CORE_CHAT_CONNECTOR_KEY"]?.trim() ?? "";
  if (connectorKey && safeEqualSecret(supplied, connectorKey)) {
    return {
      kind: "legacy",
      connectorKey,
      scopes: new Set(["ai_core.command", "ai_core.progress", "profile"]),
      user: null,
    };
  }

  if (isAllowedLocalMcpServiceToken(supplied)) {
    return {
      kind: "legacy",
      connectorKey: supplied,
      scopes: new Set(["ai_core.command", "ai_core.progress", "profile"]),
      user: null,
    };
  }

  try {
    const verified = await verifyMcpAccessToken(supplied);
    if (!connectorKey) return null;
    return {
      kind: "oauth",
      connectorKey,
      scopes: verified.scopes,
      user: verified.user,
    };
  } catch {
    return null;
  }
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

function authChallenge(scope: string) {
  const metadata = `${oauthIssuer()}/.well-known/oauth-protected-resource`;
  return `Bearer resource_metadata="${metadata}", scope="${scope}", error="insufficient_scope", error_description="Authenticate to AI Core to continue"`;
}

function authRequiredResult(id: unknown, scope: string) {
  return rpcResult(id, {
    content: [{ type: "text", text: "Authentication required to use this AI Core tool." }],
    _meta: { "mcp/www_authenticate": [authChallenge(scope)] },
    isError: true,
  });
}

const tools = [
  {
    name: "send_ai_core_command",
    description:
      "Send a text instruction directly to AI Core Agent Mode. Execution requires the message to begin with @. This can cause code, configuration, deployment, or other operational changes.",
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
    securitySchemes: [{ type: "oauth2", scopes: ["ai_core.command"] }],
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
    securitySchemes: [{ type: "oauth2", scopes: ["ai_core.progress"] }],
    annotations: {
      title: "Get AI Core Task Progress",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_profile",
    description:
      "Return the internal AI Core profile represented by the current OAuth connection.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        id: { type: "string", minLength: 1, pattern: "\\S" },
        name: { type: "string" },
        email: { type: "string" },
        nickname: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    securitySchemes: [{ type: "oauth2", scopes: ["profile"] }],
    annotations: {
      title: "Get AI Core Profile",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { "openai/profile": true },
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
    throw new Error(
      `AI Core upstream HTTP ${response.status}: ${typeof payload === "string" ? payload.slice(0, 500) : JSON.stringify(payload)}`,
    );
  }
  return payload;
}

router.post("/ai/core-chat/mcp", async (req, res): Promise<void> => {
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
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
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

  // ChatGPT/Codex currently probes the standard MCP discovery methods even
  // when this server only exposes tools. Return valid empty collections
  // instead of -32601 so the host keeps the MCP connection healthy and
  // continues through tool discovery.
  if (body.method === "resources/list") {
    res.status(200).json(rpcResult(body.id ?? null, { resources: [] }));
    return;
  }

  if (body.method === "resources/templates/list") {
    res.status(200).json(rpcResult(body.id ?? null, { resourceTemplates: [] }));
    return;
  }

  if (body.method === "prompts/list") {
    res.status(200).json(rpcResult(body.id ?? null, { prompts: [] }));
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

  const requiredScope =
    params.name === "send_ai_core_command"
      ? "ai_core.command"
      : params.name === "get_ai_core_task_progress"
        ? "ai_core.progress"
        : params.name === "get_profile"
          ? "profile"
          : "";

  if (!requiredScope) {
    res.status(200).json(rpcError(body.id ?? null, -32602, `Unknown tool: ${params.name}`));
    return;
  }

  const identity = await authenticate(req);
  if (!identity || !identity.scopes.has(requiredScope)) {
    res.setHeader("WWW-Authenticate", authChallenge(requiredScope));
    res.status(401).json(authRequiredResult(body.id ?? null, requiredScope));
    return;
  }

  try {
    let payload: unknown;
    if (params.name === "send_ai_core_command") {
      const parsed = SendCommandArgs.parse(params.arguments ?? {});
      const command = executionGatedMessage(parsed.message);
      if (!command) {
        res.status(200).json(
          rpcResult(body.id ?? null, {
            content: [{ type: "text", text: "Execution blocked: text commands must begin with @." }],
            structuredContent: { blocked: true, reason: "missing_execution_prefix", requiredPrefix: "@" },
            isError: true,
          }),
        );
        return;
      }
      payload = await callAiCore(
        "/ai/core-chat/messages",
        {
          method: "POST",
          body: JSON.stringify({
            ...parsed,
            message: command,
            mode: "agent",
            source: "text",
          }),
        },
        identity.connectorKey,
      );
    } else if (params.name === "get_ai_core_task_progress") {
      const parsed = TaskProgressArgs.parse(params.arguments ?? {});
      payload = await callAiCore(
        `/ai/core-chat/tasks/${encodeURIComponent(parsed.taskId)}/progress`,
        { method: "GET" },
        identity.connectorKey,
      );
    } else {
      if (!identity.user) {
        res.setHeader("WWW-Authenticate", authChallenge("profile"));
        res.status(401).json(authRequiredResult(body.id ?? null, "profile"));
        return;
      }
      payload = {
        id: `internal-${identity.user.id}`,
        email: identity.user.email,
        nickname: identity.user.email,
      };
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
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${oauthIssuer()}/.well-known/oauth-protected-resource"`);
  res.status(405).json({
    error: "Use MCP Streamable HTTP POST requests.",
    resource: oauthResource(),
  });
});

export default router;
