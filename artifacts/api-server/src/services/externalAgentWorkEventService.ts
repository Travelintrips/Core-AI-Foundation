import { PostgresPool, pool, resolveDatabaseUrl } from "@workspace/db";
import { logger } from "../lib/logger.js";

const CHANNEL = "ai_external_work_available_v1";
type Subscriber = { wake: (commandId: string) => void; lost: () => void };
const subscribers = new Map<string, Set<Subscriber>>();
let listenerPool: InstanceType<typeof PostgresPool> | null = null;
let ready: Promise<void> | null = null;
let releaseListener: (() => void) | null = null;

/** LISTEN needs a session connection; never use the transaction pooler for it. */
export function workEventSessionUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543") {
    url.port = "5432";
  }
  return url.toString();
}

function disconnected(activePool: InstanceType<typeof PostgresPool>): void {
  if (listenerPool !== activePool) return;
  listenerPool = null;
  ready = null;
  try { releaseListener?.(); } catch { /* Already disconnected. */ }
  releaseListener = null;
  const active = [...subscribers.values()].flatMap((items) => [...items]);
  subscribers.clear();
  for (const subscriber of active) subscriber.lost();
  void activePool.end().catch(() => undefined);
}

async function ensureListener(): Promise<void> {
  if (ready) return ready;
  const activePool = new PostgresPool({
    connectionString: workEventSessionUrl(resolveDatabaseUrl()),
    max: 1,
    connectionTimeoutMillis: 8_000,
    application_name: "ai-core-work-event-listener",
    keepAlive: true,
  });
  listenerPool = activePool;
  activePool.on("error", () => disconnected(activePool));
  ready = (async () => {
    const client = await activePool.connect();
    releaseListener = () => client.release(true);
    client.on("error", () => disconnected(activePool));
    client.on("end", () => disconnected(activePool));
    client.on("notification", (notification) => {
      if (notification.channel !== CHANNEL || !notification.payload) return;
      try {
        const event: unknown = JSON.parse(notification.payload);
        if (!event || typeof event !== "object") return;
        const { clientId, commandId } = event as Record<string, unknown>;
        if (typeof clientId !== "string" || typeof commandId !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(commandId)) return;
        for (const subscriber of subscribers.get(clientId) ?? []) subscriber.wake(commandId);
      } catch { /* A wake-up is data, never an instruction. */ }
    });
    await client.query("LISTEN " + CHANNEL);
  })().catch((error: unknown) => {
    disconnected(activePool);
    throw error;
  });
  return ready;
}

export async function subscribeExternalAgentWork(
  clientId: string, wake: Subscriber["wake"], lost: Subscriber["lost"],
): Promise<() => void> {
  await ensureListener();
  if (!listenerPool) throw new Error("Work listener disconnected during subscription");
  const subscriber = { wake, lost };
  const group = subscribers.get(clientId) ?? new Set<Subscriber>();
  group.add(subscriber);
  subscribers.set(clientId, group);
  return () => {
    group.delete(subscriber);
    if (group.size === 0) subscribers.delete(clientId);
  };
}

/** Called only after durable insertion. Failure cannot erase the queued work. */
export async function notifyExternalAgentWork(clientId: string, commandId: string): Promise<void> {
  try {
    await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify({ clientId, commandId })]);
  } catch {
    logger.warn({ commandId }, "Work wake-up unavailable; durable queue will replay on reconnect");
  }
}
