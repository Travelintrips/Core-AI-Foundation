import { createHash, randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { oauthIssuer, verifyMcpAccessToken } from "../services/aiCoreMcpOAuthService.js";
import { isDevChatGptContinuityMessage, parseDevChatGptContinuityCommand } from "../services/devChatGptContinuityProtocol.js";

const SCOPES: Readonly<Record<string, string>> = Object.freeze({
  handshake_ai_core: "ai_core.progress", query_ai_core: "ai_core.progress",
  send_ai_core_command: "ai_core.command", get_ai_core_task_progress: "ai_core.progress",
  get_external_agent_command_progress: "ai_core.progress", subscribe_ai_core_events: "ai_core.events",
  read_ai_core_events: "ai_core.events", ack_ai_core_event: "ai_core.events",
  unsubscribe_ai_core_events: "ai_core.events", get_profile: "profile",
});
const DISCOVERY = new Set(["initialize", "notifications/initialized", "ping", "tools/list",
  "resources/list", "resources/templates/list", "prompts/list"]);
const BOUND = new Set(["send_ai_core_command", "subscribe_ai_core_events",
  "read_ai_core_events", "ack_ai_core_event", "unsubscribe_ai_core_events"]);
// This is the existing DEV relay authorization boundary, not an extension of it.
const RELAY_TOOLS = new Set([...BOUND, "get_external_agent_command_progress", "query_ai_core"]);

type VerifiedIdentity = Awaited<ReturnType<typeof verifyMcpAccessToken>>;
type Dependencies = {
  verify?: (token: string) => Promise<VerifiedIdentity>;
  issuer?: () => string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
};
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** A dedicated DEV gateway may use the existing OAuth identity store, never its business DB. */
export function devOnlyRelayConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const url = env["AI_CORE_DEV_RELAY_URL"]?.trim() ?? "";
  const key = env["AI_CORE_DEV_RELAY_KEY"]?.trim() ?? "";
  if (env["AI_CORE_MCP_TARGET_ENV"] !== "DEV" || key.length < 32 ||
      !/^https:\/\/dev(?:-aicore)?\.cstlogistic\.co\.id\/api\/ai\/core-chat\/mcp$/.test(url)) {
    throw new Error("DEV_ONLY_RELAY_CONFIGURATION_INVALID");
  }
  return { url, key };
}

/** Only inert discovery reaches the existing router. There is no PROD fallback. */
export function createDevOnlyMcpGateway(deps: Dependencies = {}) {
  const verify = deps.verify ?? verifyMcpAccessToken;
  const issuer = deps.issuer ?? oauthIssuer;
  const env = deps.env ?? process.env;
  const request = deps.fetch ?? fetch;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!/^\/ai\/core-chat\/mcp(?:-v2)?$/.test(req.path)) { next(); return; }
    res.setHeader("X-AI-Core-Execution-Environment", "DEV");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") { res.status(405).setHeader("Allow", "POST"); res.end(); return; }
    const body = object(req.body);
    const id = typeof body?.id === "string" || typeof body?.id === "number" ? body.id : null;
    const respond = (payload: Record<string, unknown>, isError = false, http = 200) => {
      res.status(http).json({ jsonrpc: "2.0", id, result: {
        content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, isError,
      } });
    };
    const error = (code: string, http = 200, dispatchState = "not_dispatched") => {
      respond({ blocked: true, reason: code, executionEnvironment: "DEV",
        routePolicy: "DEV_ONLY_NO_PROD_FALLBACK", dispatchState }, true, http);
    };
    if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") { error("INVALID_JSON_RPC", 400); return; }
    if (DISCOVERY.has(body.method)) { next(); return; }
    if (body.method !== "tools/call") { error("DEV_ONLY_METHOD_UNSUPPORTED"); return; }
    const params = object(body.params);
    const name = typeof params?.name === "string" ? params.name : "";
    const scope = SCOPES[name];
    if (!scope) { error("DEV_ONLY_TOOL_UNSUPPORTED"); return; }
    const rawArgs = params?.arguments === undefined ? {} : object(params.arguments);
    if (!rawArgs) { error("INVALID_TOOL_ARGUMENTS", 400); return; }
    const header = req.headers.authorization;
    const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    let identity: VerifiedIdentity;
    try {
      if (!token) throw new Error("missing_token");
      identity = await verify(token);
      if (!identity.user || !identity.clientId || !identity.scopes.has(scope)) throw new Error("missing_scope");
    } catch {
      res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${issuer()}/.well-known/oauth-protected-resource/api/ai/core-chat/mcp", scope="${scope}"`);
      error("OAUTH_AUTHORIZATION_REQUIRED", 401); return;
    }
    const channel = "ai-engine-oauth:" + createHash("sha256")
      .update(JSON.stringify([issuer(), identity.user.id, identity.clientId])).digest("hex");
    if (name === "get_profile") {
      respond({ id: `internal-${identity.user.id}`, email: identity.user.email, nickname: identity.user.email }); return;
    }
    if (name !== "handshake_ai_core" && !RELAY_TOOLS.has(name)) {
      error("DEV_RELAY_SCOPE_UNSUPPORTED"); return;
    }
    let config: ReturnType<typeof devOnlyRelayConfiguration>;
    try { config = devOnlyRelayConfiguration(env); }
    catch { error("DEV_ONLY_RELAY_CONFIGURATION_INVALID", 503); return; }
    const handshake = (backendProbeVerified: boolean) => {
      const handshakeId = randomUUID();
      return {
        protocol: "ai-core-communication/v1", authenticated: true, handshakeId,
        handshakeAck: { received: true, handshakeId, source: "dev_only_mcp_gateway" },
        aiEngineSessionId: channel, aiEngineSessionVerified: true,
        eventChannelBinding: "OAUTH_PRINCIPAL_CLIENT_CHANNEL", executionEnvironment: "DEV",
        routePolicy: "DEV_ONLY_NO_PROD_FALLBACK", backendProbeVerified,
        backendProbe: backendProbeVerified ? "authorized_private_inbox_read" : null,
        relayTools: [...RELAY_TOOLS], relayScope: "bounded_dev_workers_and_owner_authorized_chatgpt_continuity",
        unavailableTools: ["get_ai_core_task_progress"],
        chatSessionId: null, chatSessionIdVerified: false, conversationAckVerified: false,
        browserWakeVerified: false, conversationBindingStatus: "UNVERIFIED_NO_TRUSTED_CHATGPT_ATTESTATION",
        notes: "Gateway ACK is not ChatGPT browser/SOP delivery. Restricted DEV relay permissions are unchanged.",
      };
    };
    // A caller with only progress permission gets gateway authentication evidence,
    // not an implicit grant to read events. Never bypass the relay's handshake denial.
    if (name === "handshake_ai_core" && !identity.scopes.has("ai_core.events")) { respond(handshake(false)); return; }
    const args: Record<string, unknown> = name === "handshake_ai_core"
      ? { conversationId: channel, limit: 1 } : { ...rawArgs };
    const relayName = name === "handshake_ai_core" ? "read_ai_core_events" : name;
    if (BOUND.has(name)) args.conversationId = channel;
    if (name === "query_ai_core") {
      // A read-only DEV query must not select another branch, repository, or execution policy.
      if (typeof args.message !== "string" || !args.message.trim() || args.message.length > 5000) {
        error("DEV_READ_QUERY_INVALID"); return;
      }
      args.branch = "develop";
      args.repository = "Travelintrips/Core-AI-Foundation";
      args.projectName = "Core AI Foundation";
      args.modelPolicy = "economy";
      args.conversationId = channel;
    }
    if (name === "get_external_agent_command_progress") args.ownerConversationId = channel;
    if (name === "send_ai_core_command" && args.branch === undefined) args.branch = "develop";
    if (name === "send_ai_core_command" && typeof args.message === "string") {
      // Parse without importing any business service into this isolated gateway.
      // The backend separately enforces its current DEV flags and paired destination allowlists.
      const inlineConfirmation = /^@?\s*confirmed=true\b[\s:,-]*/i.test(args.message.trim());
      const cleaned = args.message.trim().replace(/^(@?\s*)confirmed=true\b[\s:,-]*/i, "$1");
      const instruction = cleaned.startsWith("@") ? cleaned.slice(1).trim() : cleaned.trim();
      if (isDevChatGptContinuityMessage(instruction)) {
        const continuity = parseDevChatGptContinuityCommand(instruction);
        if (!continuity) { error("DEV_CHATGPT_CONTINUITY_INVALID"); return; }
        if (continuity.kind !== "status" && args.confirmed !== true && !inlineConfirmation) {
          error("DEV_CHATGPT_CONTINUITY_DENIED"); return;
        }
      }
    }
    try {
      const upstream = await request(config.url, {
        method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", Authorization: "Bearer " + config.key },
        body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name: relayName, arguments: args } }),
        redirect: "error", signal: AbortSignal.timeout(120_000),
      });
      if (!upstream.ok) { error("DEV_RELAY_HTTP_" + upstream.status, 502, "upstream_response_received"); return; }
      const text = await upstream.text();
      if (Buffer.byteLength(text) > 2_000_000) { error("DEV_RELAY_RESPONSE_TOO_LARGE", 502, "unknown"); return; }
      const envelope = object(JSON.parse(text));
      const result = object(envelope?.result);
      const payload = object(result?.structuredContent);
      if (envelope?.error || !result || !payload) { error("DEV_RELAY_INVALID_RESPONSE", 502, "unknown"); return; }
      if (name === "handshake_ai_core" && result.isError !== true) { respond(handshake(true)); return; }
      respond({ ...payload, executionEnvironment: "DEV", routePolicy: "DEV_ONLY_NO_PROD_FALLBACK" }, result.isError === true);
    } catch {
      // May already have committed upstream. Reconcile; do not retry or reroute.
      error("DEV_RELAY_UNAVAILABLE", 503, "unknown_reconcile_before_retry");
    }
  };
}
