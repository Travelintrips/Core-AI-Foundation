/**
 * DEV-only, read-only OpenClaw Gateway terminal result observer.
 * This reads the Gateway's own run receipt, not ChatGPT web UI content.
 * A Gateway run receipt is NOT by itself GPT02 account identity or AI Core ACK.
 */
import { spawn } from "node:child_process";

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const READ_METHODS = new Set(["agent.wait", "chat.history", "health", "models.list", "sessions.list"]);
export class GatewayReadError extends Error {
  constructor(code) { super(code); this.name = "GatewayReadError"; this.code = code; }
}
function assert(value, code) { if (!value) throw new GatewayReadError(code); }

/**
 * Use only the official authenticated Gateway CLI (no shell/no CDP).
 * Both the timeout of this process and agent.wait are strictly bounded.
 * Callers must never treat an agent.wait timeout as a failed/retryable send.
 */
export function makeOfficialReadRpc({
  executable, entrypoint, spawnProcess = spawn,
  clientTimeoutMs = 30_000,
}) {
  assert(typeof executable === "string" && executable.length > 0 &&
    typeof entrypoint === "string" && entrypoint.length > 0 &&
    Number.isSafeInteger(clientTimeoutMs) && clientTimeoutMs >= 1000,
  "INVALID_GATEWAY_CLIENT");
  return async (method, params = {}) => {
    assert(READ_METHODS.has(method), "GATEWAY_METHOD_NOT_READ_ONLY");
    assert(params && typeof params === "object" && !Array.isArray(params),
    "INVALID_GATEWAY_PARAMS");
    const args = [
      entrypoint, "gateway", "call", method,
      "--json", "--timeout", String(clientTimeoutMs - 250),
      "--params", JSON.stringify(params),
    ];
    return await new Promise((resolve, reject) => {
      const child = spawnProcess(executable, args, {
        windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      let out = "", errSize = 0, settled = false;
      const finish = (problem, data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (problem) reject(problem);
        else resolve(data);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new GatewayReadError("GATEWAY_READ_TIMEOUT"));
      }, clientTimeoutMs);
      child.on("error", () => finish(new GatewayReadError("GATEWAY_CLI_UNAVAILABLE")));
      child.stdout.on("data", chunk => {
        out += chunk.toString("utf8");
        if (Buffer.byteLength(out, "utf8") > 1024 * 1024) {
          child.kill();
          finish(new GatewayReadError("GATEWAY_RESPONSE_OVERSIZE"));
        }
      });
      child.stderr.on("data", chunk => { errSize += chunk.length; });
      child.on("close", (code, signal) => {
        if (code !== 0 || signal || errSize > 512 * 1024) {
          finish(new GatewayReadError("GATEWAY_RPC_NOT_AVAILABLE"));
          return;
        }
        let parsed;
        try { parsed = JSON.parse(out); }
        catch { finish(new GatewayReadError("GATEWAY_RPC_INVALID_JSON")); return; }
        if (!parsed || typeof parsed !== "object" || parsed.ok === false) {
          finish(new GatewayReadError("GATEWAY_RPC_ERROR"));
          return;
        }
        finish(null, parsed);
      });
    });
  };
}
function terminalText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    if (content.length === 0 || content.some(x =>
      !x || typeof x !== "object" || x.type !== "text" ||
      typeof x.text !== "string")) return null;
    return content.map(x => x.text).join("\n");
  }
  if (content && typeof content === "object" && !Array.isArray(content) &&
      typeof content.text === "string") return content.text;
  return null;
}
const KEY = /^(?:[a-f0-9]{64}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i;
/**
 * agent.wait returns the completion status, not assistant text.
 * Read chat.history in the SAME isolated session, and require one assistant
 * message associated with the original idempotency key. Never mistake a
 * user message, earlier turn or a different session for the reply.
 */
export async function observeOfficialRun({
  rpc, runId, sessionKey, idempotencyKey, timeoutMs = 5000,
}) {
  assert(typeof rpc === "function" && typeof runId === "string" &&
    UUID.test(runId) && typeof sessionKey === "string" &&
    /^agent:[a-z0-9-]+:ai-task-dev-[a-f0-9]{40}$|^agent:[a-z0-9-]+:dev-oauth-[a-z0-9-]{20,120}$/.test(sessionKey) &&
    typeof idempotencyKey === "string" && KEY.test(idempotencyKey) &&
    Number.isSafeInteger(timeoutMs) &&
    timeoutMs >= 1000 && timeoutMs <= 30_000, "INVALID_GATEWAY_OBSERVATION");
  const result = await rpc("agent.wait", { runId, timeoutMs });
  assert(result && result.runId === runId, "GATEWAY_RUN_MISMATCH");
  if (result.status === "timeout" || result.status === "pending") {
    return { status: "running", runId, terminalVerified: false };
  }
  if (result.status === "error") {
    return { status: "failed", runId, terminalVerified: false };
  }
  assert(result.status === "ok", "GATEWAY_TERMINAL_STATUS_INVALID");
  const history = await rpc("chat.history", { sessionKey, limit: 30 });
  assert(history && history.sessionKey === sessionKey &&
    Array.isArray(history.messages) &&
    history.hasMore !== true, "GATEWAY_HISTORY_CONTEXT_INVALID");
  const candidates = history.messages.filter(x =>
    x && x.role === "assistant" && x.idempotencyKey === idempotencyKey);
  assert(candidates.length === 1, "GATEWAY_REPLY_NOT_UNIQUELY_BOUND");
  const msg = candidates[0];
  assert(typeof msg.provider === "string" &&
    typeof msg.model === "string" && msg.stopReason !== "error" &&
    msg.stopReason !== "aborted", "GATEWAY_MESSAGE_PROVENANCE_INVALID");
  const text = terminalText(msg.content);
  assert(text !== null && text.length > 0 && text.length <= 4000,
    "GATEWAY_TERMINAL_REPLY_UNAVAILABLE");
  // Gateway history is not ChatGPT browser identity. It provides no
  // independently signed principal fingerprint or message UUID.
  return {
    status: "terminal_observed", runId, sessionKey, idempotencyKey,
    terminalReply: text, provider: msg.provider, model: msg.model,
    terminalVerified: true, principalVerified: false,
    messageIdVerified: false,
    sourceReplyDelivered: false,
  };
}
