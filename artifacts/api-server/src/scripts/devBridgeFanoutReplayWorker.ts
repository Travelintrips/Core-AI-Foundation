import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { pool, PostgresPool, resolveDatabaseUrl } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { enqueueAiCoreChatInboxMessage } from "../services/aiCoreChatInboxService.js";
import { enqueueAiCoreMcpBridgeLifecycleEvent } from "../services/aiCoreMcpEventWebhookService.js";
import {
  DEV_FANOUT_CHANNEL, DevBridgeFanoutReplayStore, replayErrorCode, replayOne,
  type ReplayClaim,
} from "../services/devBridgeFanoutReplayStore.js";

const DEV_PROJECT = "xssrfshdrtdfupgqwfdw";
export function assertDevReplayTarget(env: NodeJS.ProcessEnv, databaseUrl: string): void {
  if (env["AI_DEV_BRIDGE_FANOUT_REPLAY_ENABLED"] !== "true" ||
      env["APP_ENV"] !== "development" || env["NODE_ENV"] === "production") {
    throw new Error("DEV_REPLAY_NOT_EXPLICITLY_ENABLED");
  }
  if (env["SUPABASE_URL_DEV"]?.replace(/\/$/, "") !== `https://${DEV_PROJECT}.supabase.co`) {
    throw new Error("DEV_PROJECT_MISMATCH");
  }
  const url = new URL(databaseUrl);
  const user = decodeURIComponent(url.username);
  const isDev = url.hostname === `db.${DEV_PROJECT}.supabase.co` ||
    (url.hostname.endsWith(".pooler.supabase.com") && user.endsWith(`.${DEV_PROJECT}`));
  if (!isDev || !["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DEV_DATABASE_MISMATCH");
  }
}

export async function projectDevBridgeResponse(claim: ReplayClaim): Promise<void> {
  // Both destinations already enforce stable uniqueness keys. A crash after the
  // insert but before PROJECTED can therefore safely repeat the enqueue.
  if (claim.sink === "CHAT_INBOX") {
    await enqueueAiCoreChatInboxMessage(claim);
  } else if (claim.sink === "MCP_EVENT_QUEUE") {
    await enqueueAiCoreMcpBridgeLifecycleEvent(claim);
  } else {
    throw new Error("UNSUPPORTED_REPLAY_SINK");
  }
  // PROJECTED is NOT a receiver ACK and is NOT a ChatGPT conversation binding.
}

export async function runDevBridgeFanoutReplayWorker(): Promise<void> {
  const databaseUrl = resolveDatabaseUrl();
  assertDevReplayTarget(process.env, databaseUrl);
  const installer = await pool.connect();
  try {
    await new DevBridgeFanoutReplayStore({ query: (text, values) => installer.query(text, values) }).install();
  } finally {
    installer.release();
  }
  if (process.argv.includes("--install-only")) {
    await pool.end();
    return;
  }
  const store = new DevBridgeFanoutReplayStore({ query: (text, values) => pool.query(text, values) });
  const sessionUrl = new URL(databaseUrl);
  if (sessionUrl.hostname.endsWith(".pooler.supabase.com") && sessionUrl.port === "6543") {
    sessionUrl.port = "5432";
  }
  const listenerPool = new PostgresPool({ connectionString: sessionUrl.toString(), max: 1,
    connectionTimeoutMillis: 8_000, keepAlive: true, application_name: "dev-bridge-fanout-replay" });
  let stopping = false;
  let listening = false;
  let databaseHealthy = true;
  let draining = false;
  let wakeRequested = false;
  let drainTimer: NodeJS.Timeout | null = null;
  let timerDue = Infinity;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let activeListenerId: string | null = null;
  let releaseListener: (() => void) | null = null;

  const scheduleDrain = (delay = 0): void => {
    if (stopping) return;
    if (draining) { wakeRequested = true; return; }
    const bounded = Math.min(300_000, Math.max(0, delay));
    const due = Date.now() + bounded;
    if (drainTimer && due >= timerDue) return;
    if (drainTimer) clearTimeout(drainTimer);
    timerDue = due;
    drainTimer = setTimeout(() => { drainTimer = null; timerDue = Infinity; void drain(); }, bounded);
  };

  const drain = async (): Promise<void> => {
    if (stopping || draining) return;
    draining = true;
    wakeRequested = false;
    let next: number | null = null;
    try {
      for (let count = 0; count < 20 && !stopping; count += 1) {
        if (await replayOne(store, projectDevBridgeResponse) === "IDLE") break;
      }
      next = await store.nextDelay();
      databaseHealthy = true;
    } catch (error) {
      databaseHealthy = false;
      next = 5_000;
      logger.warn({ code: replayErrorCode(error) }, "[dev-bridge-replay] database unavailable; durable rows retained");
    } finally {
      draining = false;
    }
    if (wakeRequested) scheduleDrain(0);
    else if (next !== null) scheduleDrain(next);
    // An empty queue installs no timer. Wake-ups come from transactional NOTIFY,
    // listener recovery, startup, or the next persisted retry/lease deadline.
  };

  const connectListener = async (): Promise<void> => {
    if (stopping) return;
    const id = randomUUID();
    activeListenerId = id;
    try {
      const client = await listenerPool.connect();
      let released = false;
      const release = (): void => { if (!released) { released = true; client.release(true); } };
      const lost = (): void => {
        if (activeListenerId !== id || stopping) return;
        activeListenerId = null; listening = false; releaseListener = null; release();
        if (!reconnectTimer) reconnectTimer = setTimeout(() => {
          reconnectTimer = null; void connectListener();
        }, 5_000);
      };
      releaseListener = release;
      client.on("error", lost);
      client.on("end", lost);
      client.on("notification", (event) => {
        if (event.channel === DEV_FANOUT_CHANNEL && /^[0-9a-f-]{36}$/i.test(event.payload ?? "")) scheduleDrain();
      });
      await client.query("LISTEN " + DEV_FANOUT_CHANNEL);
      if (stopping || activeListenerId !== id) { release(); return; }
      listening = true;
      scheduleDrain();
    } catch (error) {
      listening = false;
      releaseListener?.(); releaseListener = null;
      logger.warn({ code: replayErrorCode(error) }, "[dev-bridge-replay] listener reconnect scheduled");
      if (!stopping && !reconnectTimer) reconnectTimer = setTimeout(() => {
        reconnectTimer = null; void connectListener();
      }, 5_000);
    }
  };
  listenerPool.on("error", () => { listening = false; });
  const server = createServer((_req, res) => {
    const healthy = listening && databaseHealthy && !stopping;
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: healthy ? "ok" : "degraded", scope: "DEV_INTERNAL_PROJECTION" }));
  });
  server.listen(18096, "127.0.0.1");
  const stop = (): void => {
    stopping = true;
    if (drainTimer) clearTimeout(drainTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    releaseListener?.(); releaseListener = null;
    server.close();
    void Promise.allSettled([listenerPool.end(), pool.end()]);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await connectListener();
  logger.info("[dev-bridge-replay] event-driven worker started; no WA/GitHub resend or browser impersonation");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDevBridgeFanoutReplayWorker().catch((error: unknown) => {
    logger.error({ code: replayErrorCode(error) }, "[dev-bridge-replay] startup failed closed");
    process.exitCode = 1;
    void pool.end();
  });
}
