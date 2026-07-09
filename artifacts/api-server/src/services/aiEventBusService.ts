/**
 * aiEventBusService — Phase 5.5 AI Event Bus
 *
 * publish()         — create + persist an event, then dispatch to matching subscriptions
 * subscribe()       — create a subscription
 * unsubscribe()     — disable a subscription
 * dispatch()        — find matching subscriptions and invoke handlers
 * processEvent()    — (re)process a single event against all active subscriptions
 * markProcessed()   — set event status to "processed"
 * markFailed()      — set event status to "failed"
 * replay()          — re-run an already-processed event safely
 * getEventTimeline()— all events sharing a correlationId
 *
 * Safety rules:
 *   - Event publish failures never propagate to callers (fire-and-forget variant)
 *   - Handler failures are isolated; one bad handler does not skip others
 *   - Idempotency: replay checks that the event already exists (no duplicate creation)
 *   - correlation_id is auto-generated when not supplied
 */

import { randomUUID } from "crypto";
import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import {
  db,
  aiEventsTable,
  aiEventSubscriptionsTable,
} from "@workspace/db";
import type {
  AiEvent,
  AiEventSubscription,
  InsertAiEvent,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { eventHandlerRegistry } from "./eventHandlerRegistry.js";
import { logger } from "../lib/logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PublishOptions {
  eventType:     string;
  sourceModule:  string;
  sourceId?:     string;
  correlationId?: string;
  causationId?:  string;
  payload?:      Record<string, unknown>;
  metadata?:     Record<string, unknown>;
}

export interface DispatchResult {
  eventId:  string;
  handlers: { subscriptionName: string; ok: boolean; error?: string }[];
}

// ── publish ───────────────────────────────────────────────────────────────────

export async function publish(opts: PublishOptions): Promise<AiEvent> {
  const eventId      = randomUUID();
  const correlationId= opts.correlationId ?? randomUUID();
  const now          = new Date();

  const row: InsertAiEvent = {
    eventId,
    eventType:     opts.eventType,
    sourceModule:  opts.sourceModule,
    sourceId:      opts.sourceId ?? null,
    correlationId,
    causationId:   opts.causationId ?? null,
    payloadJson:   opts.payload  ?? {},
    metadataJson:  opts.metadata ?? {},
    status:        "published",
    publishedAt:   now,
  };

  const [event] = await db.insert(aiEventsTable).values(row).returning();
  if (!event) throw new Error("Failed to insert event");

  await logAudit("event-bus", "event_published", eventId, "ai_event", "success", {
    eventType:    opts.eventType,
    sourceModule: opts.sourceModule,
    correlationId,
  });

  // Dispatch in background — never block the caller
  dispatch(event).catch((err) =>
    logger.error({ err, eventId }, "[event-bus] Background dispatch failed"),
  );

  return event;
}

/**
 * Fire-and-forget variant: swallows all errors. Use when the caller must not fail.
 */
export function publishSafe(opts: PublishOptions): void {
  publish(opts).catch((err) =>
    logger.error({ err, eventType: opts.eventType }, "[event-bus] publishSafe failed"),
  );
}

// ── subscribe / unsubscribe ───────────────────────────────────────────────────

export async function subscribe(input: {
  subscriptionName:  string;
  eventType:         string;
  targetType?:       string;
  targetId?:         string;
  handlerType:       string;
  handlerConfig?:    Record<string, unknown>;
  retryPolicy?:      Record<string, unknown>;
}): Promise<AiEventSubscription> {
  const [sub] = await db
    .insert(aiEventSubscriptionsTable)
    .values({
      subscriptionName:  input.subscriptionName,
      eventType:         input.eventType,
      targetType:        input.targetType ?? null,
      targetId:          input.targetId   ?? null,
      handlerType:       input.handlerType,
      handlerConfigJson: input.handlerConfig ?? {},
      status:            "active",
      retryPolicy:       input.retryPolicy ?? {},
    })
    .returning();

  if (!sub) throw new Error("Failed to create subscription");

  await logAudit("event-bus", "subscription_created", String(sub.id), "ai_event_subscription", "success", {
    subscriptionName: input.subscriptionName,
    eventType:        input.eventType,
    handlerType:      input.handlerType,
  });

  return sub;
}

export async function unsubscribe(id: number): Promise<void> {
  await db
    .update(aiEventSubscriptionsTable)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(aiEventSubscriptionsTable.id, id));

  await logAudit("event-bus", "subscription_deleted", String(id), "ai_event_subscription", "success");
}

// ── dispatch ──────────────────────────────────────────────────────────────────

export async function dispatch(event: AiEvent): Promise<DispatchResult> {
  // Find subscriptions that match: eventType exact-match OR wildcard "*"
  const subscriptions = await db
    .select()
    .from(aiEventSubscriptionsTable)
    .where(
      and(
        inArray(aiEventSubscriptionsTable.eventType, [event.eventType, "*"]),
        eq(aiEventSubscriptionsTable.status, "active"),
      ),
    );

  const results: DispatchResult["handlers"] = [];

  for (const sub of subscriptions) {
    const handler = eventHandlerRegistry[sub.handlerType];
    if (!handler) {
      results.push({ subscriptionName: sub.subscriptionName, ok: false, error: `Unknown handler: ${sub.handlerType}` });
      continue;
    }

    const config = (sub.handlerConfigJson ?? {}) as Record<string, unknown>;
    const result = await handler(event, sub, config).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));

    results.push({ subscriptionName: sub.subscriptionName, ...result });

    if (!result.ok) {
      logger.warn({ subscriptionName: sub.subscriptionName, eventId: event.eventId, error: result.error },
        "[event-bus] Handler failed");
    }
  }

  // Mark processed only when ALL handlers succeeded; otherwise mark failed.
  if (subscriptions.length > 0) {
    const anyFailed = results.some((r) => !r.ok);
    if (anyFailed) {
      const errors = results.filter((r) => !r.ok).map((r) => `${r.subscriptionName}: ${r.error}`).join("; ");
      await markFailed(event.eventId, errors);
    } else {
      await markProcessed(event.eventId);
    }
  }

  return { eventId: event.eventId, handlers: results };
}

// ── processEvent ──────────────────────────────────────────────────────────────

export async function processEvent(eventId: string): Promise<DispatchResult> {
  const [event] = await db
    .select()
    .from(aiEventsTable)
    .where(eq(aiEventsTable.eventId, eventId));

  if (!event) throw new Error(`Event ${eventId} not found`);

  await db
    .update(aiEventsTable)
    .set({ status: "processing" })
    .where(eq(aiEventsTable.eventId, eventId));

  return dispatch(event);
}

// ── markProcessed / markFailed ────────────────────────────────────────────────

export async function markProcessed(eventId: string): Promise<void> {
  await db
    .update(aiEventsTable)
    .set({ status: "processed", processedAt: new Date() })
    .where(eq(aiEventsTable.eventId, eventId));

  await logAudit("event-bus", "event_processed", eventId, "ai_event", "success");
}

export async function markFailed(eventId: string, error: string): Promise<void> {
  await db
    .update(aiEventsTable)
    .set({ status: "failed" })
    .where(eq(aiEventsTable.eventId, eventId));

  await logAudit("event-bus", "event_failed", eventId, "ai_event", "failure", { error });
}

// ── replay ────────────────────────────────────────────────────────────────────

/**
 * Replay: re-dispatch an existing event without creating a new one.
 * Idempotent — safe if called multiple times (handler idempotency is the caller's responsibility).
 */
export async function replay(eventId: string): Promise<DispatchResult> {
  const [event] = await db
    .select()
    .from(aiEventsTable)
    .where(eq(aiEventsTable.eventId, eventId));

  if (!event) throw new Error(`Event ${eventId} not found`);

  // Reset to published so dispatch can re-process it
  await db
    .update(aiEventsTable)
    .set({ status: "published", processedAt: null })
    .where(eq(aiEventsTable.eventId, eventId));

  await logAudit("event-bus", "event_replayed", eventId, "ai_event", "success", {
    eventType:    event.eventType,
    sourceModule: event.sourceModule,
  });

  return dispatch({ ...event, status: "published", processedAt: null });
}

// ── getEventTimeline ──────────────────────────────────────────────────────────

export async function getEventTimeline(correlationId: string): Promise<AiEvent[]> {
  return db
    .select()
    .from(aiEventsTable)
    .where(eq(aiEventsTable.correlationId, correlationId))
    .orderBy(aiEventsTable.createdAt);
}

// ── list helpers ──────────────────────────────────────────────────────────────

export interface ListEventsFilter {
  eventType?:    string;
  sourceModule?: string;
  status?:       string;
  from?:         string;
  to?:           string;
  limit?:        number;
  offset?:       number;
}

export async function listEvents(filter: ListEventsFilter): Promise<{ events: AiEvent[]; total: number }> {
  const { eventType, sourceModule, status, from, to, limit = 50, offset = 0 } = filter;

  const conditions = [];
  if (eventType)    conditions.push(eq(aiEventsTable.eventType,    eventType));
  if (sourceModule) conditions.push(eq(aiEventsTable.sourceModule,  sourceModule));
  if (status)       conditions.push(eq(aiEventsTable.status,        status));
  if (from)         conditions.push(gte(aiEventsTable.createdAt,    new Date(from)));
  if (to)           conditions.push(lte(aiEventsTable.createdAt,    new Date(to)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [events, [{ count }]] = await Promise.all([
    db.select().from(aiEventsTable).where(where).orderBy(desc(aiEventsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: db.$count(aiEventsTable, where) }).from(aiEventsTable),
  ]);

  return { events, total: Number(count) };
}
