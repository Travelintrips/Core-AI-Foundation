import { createHash, randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { oauthIssuer, verifyMcpAccessToken } from "../services/aiCoreMcpOAuthService.js";

const SCOPES: Readonly<Record<string, string>> = Object.freeze({
  handshake_ai_core: "ai_core.progress", query_ai_core: "ai_core.progress",
  send_ai_core_command: "ai_core.command", get_ai_core_task_progress: "ai_core.progress",
  get_external_agent_command_progress: "ai_core.progress", subscribe_ai_core_events: "ai_core.events",
  read_ai_core_events: "ai_core.events", ack_ai_core_event: "ai_core.events",
  unsubscribe_ai_core_events: "ai_core.events", get_profile: "profile",
});
const DISCOVERY = new Set(["initialize", "notifications/initialized", "ping", "tools/list",
  "resources/list", "resources/templates/list", "prompts/list"]);
const BOUND = new Set(["query_ai_core", "send_ai_core_command", "subscribe_ai_core_events",
  "read_ai_core_events", "ack_ai_core_event", "unsubscribe_ai_core_events"]);

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
  // No arbitrary host, port, credentials, query, redirect, or PROD fallback.
  if (env["AI_CORE_MCP_TARGET_ENV"] !== "DEV" || key.length < 32 ||
      !/^https:\/\/dev(?:-aicore)?\.cstlogistic\.co\.id\/api\/ai\/core-chat\/mcp$/.test(url)) {
    throw new Error("DEV_ONLY_RELAY_CONFIGURATION_INVALID");
  }
  return { url, key };
}

/**
 * Owns all tools/call requests on the dedicated V2 server. Only inert protocol
 * discovery reaches the existing MCP router. No catch path invokes that router
 * or the production control plane. A relay timeout must not retry execution.
 */
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
    const error = (code: string, http = 200, dispatchState = "not_dispatched") => {
      res.status(http).json({ jsonrpc: "2.0", id, result: {
        content: [{ type: "text", text: code }], isError: true,
        structuredContent: { blocked: true, reason: code, executionEnvironment: "DEV",
          routePolicy: "DEV_ONLY_NO_PROD_FALLBACK", dispatchState },
      } });
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
      const profile = { id: `internal-${identity.user.id}`, email: identity.user.email, nickname: identity.user.email };
      res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(profile) }], structuredContent: profile, isError: false } });
      return;
    }
    let config: ReturnType<typeof devOnlyRelayConfiguration>;
    try { config = devOnlyRelayConfiguration(env); }
    catch { error("DEV_ONLY_RELAY_CONFIGURATION_INVALID", 503); return; }
    const args = { ...rawArgs };
    if (BOUND.has(name)) args.conversationId = channel;
    if ((name === "send_ai_core_command" || name === "query_ai_core") && args.branch === undefined) args.branch = "develop";
    try {
      const upstream = await request(config.url, {
        method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", Authorization: "Bearer " + config.key },
        body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }),
        redirect: "error", signal: AbortSignal.timeout(120_000),
      });
      if (!upstream.ok) { error("DEV_RELAY_HTTP_" + upstream.status, 502, "upstream_response_received"); return; }
      const text = await upstream.text();
      if (Buffer.byteLength(text) > 2_000_000) { error("DEV_RELAY_RESPONSE_TOO_LARGE", 502, "unknown"); return; }
      const envelope = object(JSON.parse(text));
      const result = object(envelope?.result);
      const payload = object(result?.structuredContent);
      if (envelope?.error || !result || !payload) { error("DEV_RELAY_INVALID_RESPONSE", 502, "unknown"); return; }
      const output: Record<string, unknown> = { ...payload, executionEnvironment: "DEV", routePolicy: "DEV_ONLY_NO_PROD_FALLBACK" };
      if (name === "handshake_ai_core") Object.assign(output, {
        authenticated: true, aiEngineSessionId: channel, aiEngineSessionVerified: true,
        eventChannelBinding: "OAUTH_PRINCIPAL_CLIENT_CHANNEL", chatSessionId: null,
        chatSessionIdVerified: false, conversationAckVerified: false, browserWakeVerified: false,
        conversationBindingStatus: "UNVERIFIED_NO_TRUSTED_CHATGPT_ATTESTATION",
      });
      res.status(200).json({ jsonrpc: "2.0", id, result: {
        content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output, isError: result.isError === true,
      } });
    } catch {
      // The request may already have committed upstream: never retry or create a
      // replacement command, and never fall back to production on failure.
      error("DEV_RELAY_UNAVAILABLE", 503, "unknown_reconcile_before_retry");
    }
  };
}
