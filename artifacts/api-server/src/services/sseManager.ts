/**
 * sseManager.ts — Shared SSE project poller and subscriber registry.
 *
 * Architecture:
 *   - One ProjectChannel per projectId (UUID string)
 *   - Each channel polls DB every SSE_POLL_INTERVAL_MS (default 3s)
 *   - Fan-out to all subscribers of the same project (no N×4 DB queries)
 *   - Channel stops when last subscriber disconnects
 *   - Event deduplication by canonical eventId
 *   - Cursor: base64url-encoded JSON { createdAt: string, eventId: string }
 *
 * Connection limits (all configurable via env):
 *   SSE_MAX_CONNS_PER_IP         — default 10
 *   SSE_MAX_CONNS_PER_TOKEN      — default 5
 *   SSE_MAX_SUBS_PER_PROJECT     — default 20
 *   SSE_IDLE_TIMEOUT_MS          — default 300000 (5 min)
 *   SSE_MAX_INITIAL_EVENTS       — default 50 (bounded snapshot)
 *   SSE_POLL_INTERVAL_MS         — default 3000 (min 2000)
 */

import { logger } from "../lib/logger.js";
import { getEventsWithSummariesForProject } from "./canonicalEventService.js";
import type { CanonicalEvent } from "./canonicalEventService.js";
import type { EventWithSummary, ExecutionSummary } from "./executionSummaryService.js";
import type { Response } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export const SSE_POLL_INTERVAL_MS = Math.max(
  2000,
  Number(process.env["SSE_POLL_INTERVAL_MS"] ?? 3000),
);

export const MAX_INITIAL_EVENTS = Math.min(
  200,
  Math.max(1, Number(process.env["SSE_MAX_INITIAL_EVENTS"] ?? 50)),
);

export const MAX_CONNECTIONS_PER_IP = Number(process.env["SSE_MAX_CONNS_PER_IP"] ?? 10);
export const MAX_CONNECTIONS_PER_TOKEN = Number(process.env["SSE_MAX_CONNS_PER_TOKEN"] ?? 5);
export const MAX_SUBSCRIBERS_PER_PROJECT = Number(process.env["SSE_MAX_SUBS_PER_PROJECT"] ?? 20);
const IDLE_TIMEOUT_MS = Number(process.env["SSE_IDLE_TIMEOUT_MS"] ?? 5 * 60 * 1000);
const HEARTBEAT_INTERVAL_MS = 20_000;
const DEDUP_SET_MAX = 2000;
const DEDUP_SET_TRIM_TARGET = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Cursor helpers (exported for tests and SSE route)
// ─────────────────────────────────────────────────────────────────────────────

export interface EventCursor {
  createdAt: string;
  eventId: string;
}

export function encodeCursor(cursor: EventCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(encoded: string): EventCursor | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)["createdAt"] === "string" &&
      typeof (parsed as Record<string, unknown>)["eventId"] === "string"
    ) {
      return parsed as EventCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Compare two canonical events by cursor order.
 * Primary: createdAt ASC (ISO-8601 lexicographic comparison is valid).
 * Secondary: eventId ASC (lexicographic — deterministic tiebreaker).
 */
export function compareByCursor(a: CanonicalEvent, b: CanonicalEvent): number {
  const tDiff = a.createdAt.localeCompare(b.createdAt);
  if (tDiff !== 0) return tDiff;
  return a.eventId.localeCompare(b.eventId);
}

/**
 * Returns true if `event` is strictly after `cursor`:
 *   createdAt > cursor.createdAt  OR
 *   (createdAt === cursor.createdAt AND eventId > cursor.eventId)
 */
export function isAfterCursor(event: CanonicalEvent, cursor: EventCursor): boolean {
  const tDiff = event.createdAt.localeCompare(cursor.createdAt);
  if (tDiff > 0) return true;
  if (tDiff < 0) return false;
  return event.eventId.localeCompare(cursor.eventId) > 0;
}

export function sortEvents(events: CanonicalEvent[]): CanonicalEvent[] {
  return [...events].sort(compareByCursor);
}

export function filterAfterCursor(
  events: CanonicalEvent[],
  cursor: EventCursor | null,
): CanonicalEvent[] {
  if (!cursor) return events;
  return events.filter((e) => isAfterCursor(e, cursor));
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE write helpers
// ─────────────────────────────────────────────────────────────────────────────

function writeSSE(
  res: Response,
  opts: { id?: string; event: string; data: unknown },
): void {
  if (res.writableEnded) return;
  try {
    if (opts.id !== undefined) res.write(`id: ${opts.id}\n`);
    res.write(`event: ${opts.event}\n`);
    res.write(`data: ${JSON.stringify(opts.data)}\n\n`);
  } catch {
    // Socket closed — will be cleaned up on 'close' event
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscriber
// ─────────────────────────────────────────────────────────────────────────────

export interface Subscriber {
  readonly id: string;
  readonly res: Response;
  readonly ip: string;
  readonly token: string;
  readonly projectId: string;
  readonly internalProjectId: number;
  lastActivityAt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ProjectChannel — one per projectId UUID string
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectChannel {
  readonly projectId: string;
  readonly internalProjectId: number;
  /** V4.1 — passed through to the summary layer's next-step/customerAction derivation. Never guessed here. */
  filesUnlocked: boolean;
  subscribers: Set<Subscriber>;
  pollTimer: ReturnType<typeof setInterval> | null;
  knownEventIds: Set<string>;
  queryFailCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global registry (module-level singletons)
// ─────────────────────────────────────────────────────────────────────────────

const channels = new Map<string, ProjectChannel>();
const connectionsByIp = new Map<string, Set<string>>();    // ip → Set<subscriberId>
const connectionsByToken = new Map<string, Set<string>>(); // token → Set<subscriberId>
let isShuttingDown = false;

// ─── Observability counters ───────────────────────────────────────────────────
let totalDelivered = 0;
let totalQueryFailures = 0;

export function getObservability(): {
  activeConnections: number;
  activeProjectPollers: number;
  eventsDelivered: number;
  queryFailures: number;
} {
  return {
    activeConnections: Array.from(channels.values()).reduce(
      (sum, ch) => sum + ch.subscribers.size,
      0,
    ),
    activeProjectPollers: channels.size,
    eventsDelivered: totalDelivered,
    queryFailures: totalQueryFailures,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscriber lifecycle
// ─────────────────────────────────────────────────────────────────────────────

function startHeartbeat(sub: Subscriber): void {
  sub.heartbeatTimer = setInterval(() => {
    if (sub.res.writableEnded) {
      removeSubscriber(sub);
      return;
    }
    writeSSE(sub.res, {
      event: "heartbeat",
      data: { timestamp: new Date().toISOString() },
    });
  }, HEARTBEAT_INTERVAL_MS);
}

function resetIdleTimer(sub: Subscriber): void {
  if (sub.idleTimer) clearTimeout(sub.idleTimer);
  sub.lastActivityAt = Date.now();
  sub.idleTimer = setTimeout(() => {
    if (!sub.res.writableEnded) {
      writeSSE(sub.res, {
        event: "stream.warning",
        data: { message: "Idle timeout — connection will close." },
      });
      sub.res.end();
    }
    removeSubscriber(sub);
  }, IDLE_TIMEOUT_MS);
}

export function removeSubscriber(sub: Subscriber): void {
  if (sub.heartbeatTimer) { clearInterval(sub.heartbeatTimer); sub.heartbeatTimer = null; }
  if (sub.idleTimer) { clearTimeout(sub.idleTimer); sub.idleTimer = null; }

  connectionsByIp.get(sub.ip)?.delete(sub.id);
  connectionsByToken.get(sub.token)?.delete(sub.id);

  const channel = channels.get(sub.projectId);
  if (!channel) return;
  channel.subscribers.delete(sub);

  if (channel.subscribers.size === 0) {
    if (channel.pollTimer) { clearInterval(channel.pollTimer); }
    channels.delete(sub.projectId);
    logger.debug({ projectId: sub.projectId }, "[sse] Project channel stopped — no subscribers");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deliver event to subscriber
// ─────────────────────────────────────────────────────────────────────────────

function deliverEvent(sub: Subscriber, pair: EventWithSummary): void {
  if (sub.res.writableEnded) return;
  const cursorStr = encodeCursor({ createdAt: pair.event.createdAt, eventId: pair.event.eventId });
  writeSSE(sub.res, {
    id: cursorStr,
    event: "runtime.event",
    // V4.1 — additive `summary` field. Old clients that only read `data.event`
    // are unaffected; nothing about `event` itself changed.
    data: { event: pair.event, summary: pair.summary },
  });
  totalDelivered++;
}

function sortPairs(pairs: EventWithSummary[]): EventWithSummary[] {
  return [...pairs].sort((a, b) => compareByCursor(a.event, b.event));
}

// ─────────────────────────────────────────────────────────────────────────────
// Poll and fan-out
// ─────────────────────────────────────────────────────────────────────────────

async function pollAndFanOut(channel: ProjectChannel): Promise<void> {
  if (channel.subscribers.size === 0) return;

  let allPairs: EventWithSummary[];
  try {
    allPairs = await getEventsWithSummariesForProject(channel.projectId, channel.internalProjectId, {
      filesUnlocked: channel.filesUnlocked,
    });
    channel.queryFailCount = 0;
  } catch (err) {
    channel.queryFailCount++;
    totalQueryFailures++;
    logger.warn(
      { err, projectId: channel.projectId, failCount: channel.queryFailCount },
      "[sse] Poll query failed",
    );

    // Warn subscribers (max once every 3 failures to avoid spam)
    if (channel.queryFailCount <= 3) {
      for (const sub of channel.subscribers) {
        if (!sub.res.writableEnded) {
          writeSSE(sub.res, {
            event: "stream.warning",
            data: { message: "Live updates are temporarily unavailable. Reconnecting…" },
          });
        }
      }
    }
    return;
  }

  const sorted = sortPairs(allPairs);

  // Find genuinely new events (not yet seen by this channel) — dedup is still
  // keyed on the canonical eventId, unchanged from the pre-V4.1 behavior.
  const newPairs = sorted.filter((p) => !channel.knownEventIds.has(p.event.eventId));
  if (newPairs.length === 0) return;

  // Update known-event set (bounded dedup)
  for (const p of newPairs) channel.knownEventIds.add(p.event.eventId);
  if (channel.knownEventIds.size > DEDUP_SET_MAX) {
    const arr = Array.from(channel.knownEventIds);
    channel.knownEventIds = new Set(arr.slice(arr.length - DEDUP_SET_TRIM_TARGET));
  }

  // Fan-out to subscribers
  const deadSubs: Subscriber[] = [];
  for (const sub of channel.subscribers) {
    if (sub.res.writableEnded) {
      deadSubs.push(sub);
      continue;
    }
    for (const pair of newPairs) {
      deliverEvent(sub, pair);
    }
    resetIdleTimer(sub);
  }
  for (const sub of deadSubs) removeSubscriber(sub);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: register new subscriber
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisterOptions {
  res: Response;
  ip: string;
  token: string;
  projectId: string;
  internalProjectId: number;
  afterCursor: EventCursor | null;
  isProjectTerminal: boolean;
  /** V4.1 — real flag from the caller; used only for ExecutionSummary derivation. */
  filesUnlocked?: boolean;
}

export type RegisterResult =
  | { ok: true; sub: Subscriber }
  | { ok: false; status: number; error: string };

export async function registerSubscriber(opts: RegisterOptions): Promise<RegisterResult> {
  if (isShuttingDown) {
    return { ok: false, status: 503, error: "Service shutting down" };
  }

  // ── Connection limit guards ───────────────────────────────────────────────
  const byIp = connectionsByIp.get(opts.ip) ?? new Set<string>();
  if (byIp.size >= MAX_CONNECTIONS_PER_IP) {
    return { ok: false, status: 429, error: "Too many SSE connections from this IP" };
  }

  const byToken = connectionsByToken.get(opts.token) ?? new Set<string>();
  if (byToken.size >= MAX_CONNECTIONS_PER_TOKEN) {
    return { ok: false, status: 429, error: "Too many SSE connections for this workspace" };
  }

  // ── Get or create channel ─────────────────────────────────────────────────
  let channel = channels.get(opts.projectId);
  if (!channel) {
    channel = {
      projectId: opts.projectId,
      internalProjectId: opts.internalProjectId,
      filesUnlocked: opts.filesUnlocked ?? false,
      subscribers: new Set(),
      pollTimer: null,
      knownEventIds: new Set(),
      queryFailCount: 0,
    };
    channels.set(opts.projectId, channel);
  } else {
    // Keep the flag fresh — a later subscriber may know a more current value.
    channel.filesUnlocked = opts.filesUnlocked ?? channel.filesUnlocked;
  }

  if (channel.subscribers.size >= MAX_SUBSCRIBERS_PER_PROJECT) {
    // Clean up empty channel if we just created it
    if (channel.subscribers.size === 0) channels.delete(opts.projectId);
    return { ok: false, status: 429, error: "Too many connections for this project" };
  }

  // ── Create subscriber ─────────────────────────────────────────────────────
  const subId = `${opts.projectId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const sub: Subscriber = {
    id: subId,
    res: opts.res,
    ip: opts.ip,
    token: opts.token,
    projectId: opts.projectId,
    internalProjectId: opts.internalProjectId,
    lastActivityAt: Date.now(),
    heartbeatTimer: null,
    idleTimer: null,
  };

  channel.subscribers.add(sub);
  byIp.add(subId);
  connectionsByIp.set(opts.ip, byIp);
  byToken.add(subId);
  connectionsByToken.set(opts.token, byToken);

  // ── Fetch snapshot ────────────────────────────────────────────────────────
  let allPairs: EventWithSummary[] = [];
  try {
    allPairs = await getEventsWithSummariesForProject(opts.projectId, opts.internalProjectId, {
      filesUnlocked: channel.filesUnlocked,
    });
  } catch (err) {
    logger.warn({ err, projectId: opts.projectId }, "[sse] Snapshot query failed — sending empty snapshot");
  }

  const sorted = sortPairs(allPairs);

  // Seed channel's known-event set from snapshot
  for (const p of sorted) channel.knownEventIds.add(p.event.eventId);

  // Determine events to send:
  //   reconnect (cursor present) → events after cursor only
  //   initial connect            → latest MAX_INITIAL_EVENTS
  let snapshotPairs: EventWithSummary[];
  if (opts.afterCursor) {
    const cursor = opts.afterCursor;
    snapshotPairs = sorted.filter((p) => isAfterCursor(p.event, cursor));
  } else {
    snapshotPairs = sorted.slice(-MAX_INITIAL_EVENTS);
  }

  const lastEventId =
    sorted.length > 0
      ? encodeCursor({
          createdAt: sorted[sorted.length - 1]!.event.createdAt,
          eventId: sorted[sorted.length - 1]!.event.eventId,
        })
      : null;

  writeSSE(sub.res, {
    id: `snapshot:${Date.now()}`,
    event: "snapshot",
    data: {
      // Unchanged shape — CanonicalEvent[] only. Existing clients keep working untouched.
      events: snapshotPairs.map((p) => p.event),
      // V4.1 — additive, same length/order as `events`. Old clients ignore this key.
      summaries: snapshotPairs.map((p) => p.summary),
      lastEventId,
      generatedAt: new Date().toISOString(),
    },
  });

  // ── Start heartbeat + idle timer ──────────────────────────────────────────
  startHeartbeat(sub);
  resetIdleTimer(sub);

  // ── Start shared poller if needed ─────────────────────────────────────────
  if (!channel.pollTimer && !opts.isProjectTerminal) {
    channel.pollTimer = setInterval(() => {
      pollAndFanOut(channel!).catch((err) =>
        logger.error({ err, projectId: opts.projectId }, "[sse] Unexpected poll error"),
      );
    }, SSE_POLL_INTERVAL_MS);
  }

  logger.debug(
    { subId, projectId: opts.projectId, totalSubscribers: channel.subscribers.size },
    "[sse] Subscriber registered",
  );

  return { ok: true, sub };
}

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown (called from index.ts SIGTERM/SIGINT)
// ─────────────────────────────────────────────────────────────────────────────

export function shutdown(): void {
  isShuttingDown = true;
  logger.info({ channels: channels.size }, "[sse] Graceful shutdown — closing all SSE connections");

  for (const channel of channels.values()) {
    if (channel.pollTimer) clearInterval(channel.pollTimer);
    for (const sub of channel.subscribers) {
      if (sub.heartbeatTimer) clearInterval(sub.heartbeatTimer);
      if (sub.idleTimer) clearTimeout(sub.idleTimer);
      if (!sub.res.writableEnded) {
        try {
          writeSSE(sub.res, {
            event: "stream.warning",
            data: { message: "Server is restarting. Please reconnect." },
          });
          sub.res.end();
        } catch { /* ignore */ }
      }
    }
  }
  channels.clear();
  connectionsByIp.clear();
  connectionsByToken.clear();
}
