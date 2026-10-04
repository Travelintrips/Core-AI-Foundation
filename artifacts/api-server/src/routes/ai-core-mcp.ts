import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { resolveAiCoreInternalBaseUrl } from "../services/aiCoreWhatsappChatService.js";
import { isAllowedLocalMcpServiceToken } from "../services/mcpLocalServiceTokenService.js";
import { recordAiCoreMcpTerminalResult } from "../services/aiCoreMcpResultEventService.js";
import {
  AI_CORE_TERMINAL_EVENT_NAME,
  McpCallbackEndpointError,
  subscribeAiCoreMcpEvent,
  unsubscribeAiCoreMcpEvent,
} from "../services/aiCoreMcpEventWebhookService.js";
import {
  oauthIssuer,
  oauthResource,
  verifyMcpAccessToken,
} from "../services/aiCoreMcpOAuthService.js";
import {
  acknowledgeCodingBridgeResponse,
  listPendingCodingBridgeResponsesForConversation,
  subscribeCodingBridgeConversation,
  unsubscribeCodingBridgeConversation,
} from "../services/localCodingControlBridgeService.js";

const router = Router();
// MCP Events require protocol 2026-07-28. Keep older ChatGPT MCP versions
// available for non-event clients and always echo an explicitly supported request.
const MCP_PROTOCOL_VERSION = "2026-07-28";
const COMPAT_MCP_PROTOCOL_VERSION = "2025-06-18";
const LEGACY_MCP_PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "ai-core-direct-command", version: "1.4.0" };

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
  // Keep the prefix intact. /ai/core-chat/messages is the canonical universal
  // execution gate and strips @ exactly once before routing.
  return trimmed.length > 1 && trimmed.slice(1).trim().length > 0 ? trimmed : null;
}

const TaskProgressArgs = z.object({
  taskId: z.string().uuid(),
}).strict();

const EventTypes = z.enum(["COMPLETED", "FAILED", "MERGED", "DEPLOYED"]);
const SubscribeEventsArgs = z.object({
  conversationId: z.string().trim().min(1).max(200),
  eventTypes: z.array(EventTypes).min(1).max(4).default(["COMPLETED", "FAILED", "MERGED", "DEPLOYED"]),
  leaseSeconds: z.number().int().min(30).max(300).default(300),
}).strict();
const ReadEventsArgs = z.object({
  conversationId: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
const AckEventArgs = z.object({
  responseId: z.string().uuid(),
}).strict();
const UnsubscribeEventsArgs = z.object({
  conversationId: z.string().trim().min(1).max(200),
}).strict();

const NativeTerminalEventType = z.enum([
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "MERGED",
  "DEPLOYED",
]);
const NativeTerminalEventArguments = z.object({
  taskId: z.string().uuid().optional(),
  repository: z.string().trim().min(1).max(500).optional(),
  projectName: z.string().trim().min(1).max(200).optional(),
  eventTypes: z.array(NativeTerminalEventType).min(1).max(5).optional(),
}).strict();
const NativeEventSubscribeParams = z.object({
  name: z.literal(AI_CORE_TERMINAL_EVENT_NAME),
  arguments: NativeTerminalEventArguments.default({}),
  delivery: z.object({
    mode: z.literal("webhook"),
    url: z.string().url(),
    secret: z.string().min(1).max(512),
  }).strict(),
  cursor: z.null().optional().default(null),
  ttlMs: z.union([z.number().int().positive(), z.null()]).optional(),
}).strict();
const NativeEventUnsubscribeParams = z.object({
  name: z.literal(AI_CORE_TERMINAL_EVENT_NAME),
  arguments: NativeTerminalEventArguments.default({}),
  delivery: z.object({
    mode: z.literal("webhook"),
    url: z.string().url(),
  }).strict(),
}).strict();

const nativeEvents = [
  {
    name: AI_CORE_TERMINAL_EVENT_NAME,
    description:
      "Emitted when an AI Core coding task reaches a terminal or intervention-worthy lifecycle state so ChatGPT can report the result without polling.",
    delivery: ["webhook"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: {
          type: "string",
          format: "uuid",
          description: "Optional AI Core task UUID to monitor.",
        },
        repository: {
          type: "string",
          description: "Optional repository filter such as Travelintrips/Core-AI-Foundation.",
        },
        projectName: {
          type: "string",
          description: "Optional AI Core project-name filter.",
        },
        eventTypes: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "string",
            enum: ["COMPLETED", "FAILED", "BLOCKED", "MERGED", "DEPLOYED"],
          },
          description: "Optional lifecycle states to deliver.",
        },
      },
    },
    payloadSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "response_id",
        "task_id",
        "task_number",
        "project_name",
        "repository",
        "branch",
        "event_type",
        "status",
        "message",
        "result_summary",
        "workspace_url",
      ],
      properties: {
        response_id: { type: "string", format: "uuid" },
        task_id: { type: ["string", "null"], format: "uuid" },
        task_number: { type: ["string", "null"] },
        project_name: { type: ["string", "null"] },
        repository: { type: ["string", "null"] },
        branch: { type: ["string", "null"] },
        event_type: {
          type: "string",
          enum: ["COMPLETED", "FAILED", "BLOCKED", "MERGED", "DEPLOYED"],
        },
        status: { type: "string" },
        message: { type: "string" },
        result_summary: { type: ["string", "null"] },
        workspace_url: { type: ["string", "null"] },
      },
    },
  },
] as const;

function classifyLifecycleEvent(input: {
  kind: string;
  message: string;
  checkpoint: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): "COMPLETED" | "FAILED" | "MERGED" | "DEPLOYED" | null {
  const explicit = [input.checkpoint["eventType"], input.metadata["eventType"]]
    .find((value) => typeof value === "string");
  if (typeof explicit === "string" && ["COMPLETED", "FAILED", "MERGED", "DEPLOYED"].includes(explicit)) {
    return explicit as "COMPLETED" | "FAILED" | "MERGED" | "DEPLOYED";
  }
  if (input.kind === "COMPLETED") return "COMPLETED";
  if (input.kind === "FAILED") return "FAILED";
  const haystack = `${input.message} ${JSON.stringify(input.checkpoint)} ${JSON.stringify(input.metadata)}`.toLowerCase();
  if (/\bmerge(?:d)?\b/.test(haystack)) return "MERGED";
  if (/\bdeploy(?:ed|ment)?\b/.test(haystack) && /(success|succeed|completed|selesai|deployed)/.test(haystack)) return "DEPLOYED";
  return null;
}

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
      scopes: new Set(["ai_core.command", "ai_core.progress", "ai_core.events", "profile"]),
      user: null,
    };
  }

  if (isAllowedLocalMcpServiceToken(supplied)) {
    return {
      kind: "legacy",
      connectorKey: supplied,
      scopes: new Set(["ai_core.command", "ai_core.progress", "ai_core.events", "profile"]),
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

function identityPrincipalId(identity: McpIdentity): string {
  if (identity.kind === "oauth" && identity.user) {
    return `oauth:${identity.user.id}`;
  }
  return `legacy:${createHash("sha256")
    .update(identity.connectorKey)
    .digest("hex")
    .slice(0, 40)}`;
}

function setDiscoveryHeaders(res: import("express").Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Vary", "Authorization");
  res.setHeader("X-MCP-Server-Version", SERVER_INFO.version);
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
      "Send a text instruction to AI Core with automatic routing to answers, read-only workers, or the coding control plane. Execution requires the message to begin with @. This can cause code, configuration, deployment, or other operational changes.",
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
    name: "subscribe_ai_core_events",
    description:
      "Create or renew a durable lifecycle-event subscription for this ChatGPT conversation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["conversationId"],
      properties: {
        conversationId: { type: "string", minLength: 1, maxLength: 200 },
        eventTypes: {
          type: "array",
          items: { type: "string", enum: ["COMPLETED", "FAILED", "MERGED", "DEPLOYED"] },
          minItems: 1,
          maxItems: 4,
          default: ["COMPLETED", "FAILED", "MERGED", "DEPLOYED"],
        },
        leaseSeconds: { type: "integer", minimum: 30, maximum: 300, default: 300 },
      },
    },
    securitySchemes: [{ type: "oauth2", scopes: ["ai_core.events"] }],
    annotations: {
      title: "Subscribe AI Core Events",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "read_ai_core_events",
    description:
      "Read pending durable AI Core lifecycle events for a ChatGPT conversation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["conversationId"],
      properties: {
        conversationId: { type: "string", minLength: 1, maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
    },
    securitySchemes: [{ type: "oauth2", scopes: ["ai_core.events"] }],
    annotations: {
      title: "Read AI Core Events",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "ack_ai_core_event",
    description:
      "Acknowledge one durable AI Core lifecycle event after it has been delivered.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["responseId"],
      properties: {
        responseId: { type: "string", format: "uuid" },
      },
    },
    securitySchemes: [{ type: "oauth2", scopes: ["ai_core.events"] }],
    annotations: {
      title: "Acknowledge AI Core Event",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "unsubscribe_ai_core_events",
    description:
      "Disable the lifecycle-event subscription for a ChatGPT conversation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["conversationId"],
      properties: {
        conversationId: { type: "string", minLength: 1, maxLength: 200 },
      },
    },
    securitySchemes: [{ type: "oauth2", scopes: ["ai_core.events"] }],
    annotations: {
      title: "Unsubscribe AI Core Events",
      readOnlyHint: false,
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

router.post(["/ai/core-chat/mcp", "/ai/core-chat/mcp-v2"], async (req, res): Promise<void> => {
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

  if (body.method === "server/discover") {
    setDiscoveryHeaders(res);
    res.status(200).json(
      rpcResult(body.id ?? null, {
        resultType: "complete",
        supportedVersions: [
          MCP_PROTOCOL_VERSION,
          COMPAT_MCP_PROTOCOL_VERSION,
          LEGACY_MCP_PROTOCOL_VERSION,
        ],
        capabilities: {
          tools: {},
          events: {},
        },
        serverInfo: SERVER_INFO,
      }),
    );
    return;
  }

  if (body.method === "initialize") {
    setDiscoveryHeaders(res);
    const requestedProtocolVersion =
      body.params &&
      typeof body.params === "object" &&
      "protocolVersion" in body.params &&
      typeof (body.params as { protocolVersion?: unknown }).protocolVersion === "string"
        ? (body.params as { protocolVersion: string }).protocolVersion
        : MCP_PROTOCOL_VERSION;
    const negotiatedProtocolVersion =
      requestedProtocolVersion === MCP_PROTOCOL_VERSION ||
      requestedProtocolVersion === COMPAT_MCP_PROTOCOL_VERSION ||
      requestedProtocolVersion === LEGACY_MCP_PROTOCOL_VERSION
        ? requestedProtocolVersion
        : MCP_PROTOCOL_VERSION;
    res.status(200).json(
      rpcResult(body.id ?? null, {
        protocolVersion: negotiatedProtocolVersion,
        capabilities: {
          tools: { listChanged: true },
          events: {},
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
    setDiscoveryHeaders(res);
    res.status(200).json(rpcResult(body.id ?? null, { tools }));
    return;
  }

  if (
    body.method === "events/list" ||
    body.method === "events/subscribe" ||
    body.method === "events/unsubscribe"
  ) {
    const identity = await authenticate(req);
    if (!identity || !identity.scopes.has("ai_core.events")) {
      res.setHeader("WWW-Authenticate", authChallenge("ai_core.events"));
      res.status(401).json(authRequiredResult(body.id ?? null, "ai_core.events"));
      return;
    }

    try {
      if (body.method === "events/list") {
        setDiscoveryHeaders(res);
        res.status(200).json(
          rpcResult(body.id ?? null, {
            events: nativeEvents,
            nextCursor: null,
          }),
        );
        return;
      }

      if (body.method === "events/subscribe") {
        const parsed = NativeEventSubscribeParams.parse(body.params ?? {});
        const subscription = await subscribeAiCoreMcpEvent({
          principalId: identityPrincipalId(identity),
          eventName: parsed.name,
          arguments: parsed.arguments,
          callbackUrl: parsed.delivery.url,
          secret: parsed.delivery.secret,
          ttlMs: parsed.ttlMs,
        });
        res.status(200).json(
          rpcResult(body.id ?? null, {
            id: subscription.id,
            refreshBefore: subscription.refreshBefore,
            cursor: null,
            truncated: false,
          }),
        );
        return;
      }

      const parsed = NativeEventUnsubscribeParams.parse(body.params ?? {});
      await unsubscribeAiCoreMcpEvent({
        principalId: identityPrincipalId(identity),
        eventName: parsed.name,
        arguments: parsed.arguments,
        callbackUrl: parsed.delivery.url,
      });
      res.status(200).json(rpcResult(body.id ?? null, {}));
      return;
    } catch (error) {
      if (error instanceof McpCallbackEndpointError) {
        res.status(200).json(
          rpcError(
            body.id ?? null,
            -32015,
            "CallbackEndpointError",
            { reason: error.reason },
          ),
        );
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(200).json(
          rpcError(body.id ?? null, -32602, "Invalid params", {
            issues: error.issues,
          }),
        );
        return;
      }
      const message =
        error instanceof Error ? error.message : "MCP event request failed";
      res.status(200).json(
        rpcError(body.id ?? null, -32603, "Internal error", {
          message: message.slice(0, 500),
        }),
      );
      return;
    }
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
        : ["subscribe_ai_core_events", "read_ai_core_events", "ack_ai_core_event", "unsubscribe_ai_core_events"].includes(params.name)
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
            mode: "auto",
            source: "text",
          }),
        },
        identity.connectorKey,
      );
      await recordAiCoreMcpTerminalResult({
        conversationId: parsed.conversationId,
        instruction: command,
        payload,
      }).catch(() => {
        // Preserve the completed command result so clients do not retry execution.
        payload = { ...(payload as Record<string, unknown>), eventDeliveryError: "The command returned, but its durable event could not be saved." };
      });
    } else if (params.name === "get_ai_core_task_progress") {
      const parsed = TaskProgressArgs.parse(params.arguments ?? {});
      payload = await callAiCore(
        `/ai/core-chat/tasks/${encodeURIComponent(parsed.taskId)}/progress`,
        { method: "GET" },
        identity.connectorKey,
      );
    } else if (params.name === "subscribe_ai_core_events") {
      const parsed = SubscribeEventsArgs.parse(params.arguments ?? {});
      const subscription = await subscribeCodingBridgeConversation(parsed);
      payload = {
        subscribed: true,
        conversationId: parsed.conversationId,
        eventTypes: parsed.eventTypes,
        leaseExpiresAt: subscription.leaseExpiresAt,
        clientId: subscription.clientId,
      };
    } else if (params.name === "read_ai_core_events") {
      const parsed = ReadEventsArgs.parse(params.arguments ?? {});
      const rows = await listPendingCodingBridgeResponsesForConversation(parsed);
      payload = {
        conversationId: parsed.conversationId,
        events: rows
          .map((row) => ({
            ...row,
            eventType: classifyLifecycleEvent({
              kind: row.kind,
              message: row.message,
              checkpoint: row.checkpoint,
              metadata: row.metadata,
            }),
          }))
          .filter((row) => row.eventType !== null),
      };
    } else if (params.name === "ack_ai_core_event") {
      const parsed = AckEventArgs.parse(params.arguments ?? {});
      const acknowledged = await acknowledgeCodingBridgeResponse(parsed.responseId);
      payload = { acknowledged: Boolean(acknowledged), responseId: parsed.responseId };
    } else if (params.name === "unsubscribe_ai_core_events") {
      const parsed = UnsubscribeEventsArgs.parse(params.arguments ?? {});
      const unsubscribed = await unsubscribeCodingBridgeConversation(parsed.conversationId);
      payload = { unsubscribed, conversationId: parsed.conversationId };
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

router.get(["/ai/core-chat/mcp", "/ai/core-chat/mcp-v2"], (_req, res): void => {
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${oauthIssuer()}/.well-known/oauth-protected-resource"`);
  res.status(405).json({
    error: "Use MCP Streamable HTTP POST requests.",
    resource: oauthResource(),
  });
});

export default router;
