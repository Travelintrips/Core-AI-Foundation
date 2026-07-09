/**
 * events.ts — AI Event Bus API (Phase 5.5)
 *
 * GET    /ai/events                        — list events
 * GET    /ai/events/timeline/:correlationId — events by correlation id
 * GET    /ai/events/:id                    — get single event
 * POST   /ai/events/publish                — publish a new event
 * POST   /ai/events/:id/replay             — replay an event
 *
 * GET    /ai/event-subscriptions           — list subscriptions
 * POST   /ai/event-subscriptions           — create subscription
 * PATCH  /ai/event-subscriptions/:id       — update subscription
 * DELETE /ai/event-subscriptions/:id       — delete subscription
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiEventsTable, aiEventSubscriptionsTable } from "@workspace/db";
import {
  PublishEventBody,
  CreateSubscriptionBody,
  UpdateSubscriptionBody,
  ListEventsQueryParams,
} from "@workspace/api-zod";
import {
  publish,
  subscribe,
  unsubscribe,
  replay,
  getEventTimeline,
  listEvents,
} from "../services/aiEventBusService.js";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();

// ── Events ────────────────────────────────────────────────────────────────────

// GET /ai/events — list events with filters
router.get("/ai/events", async (req, res): Promise<void> => {
  const q = ListEventsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  try {
    const result = await listEvents(q.data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /ai/events/timeline/:correlationId — MUST be before /:id
router.get("/ai/events/timeline/:correlationId", async (req, res): Promise<void> => {
  const { correlationId } = req.params;
  if (!correlationId) {
    res.status(400).json({ error: "correlationId is required" });
    return;
  }
  try {
    const events = await getEventTimeline(correlationId);
    res.json({ correlationId, events, total: events.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /ai/events/:id — get event by eventId (UUID string)
router.get("/ai/events/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  try {
    // Resolve by eventId (UUID)
    const byEventId = await db
      .select()
      .from(aiEventsTable)
      .where(eq(aiEventsTable.eventId, id))
      .limit(1);

    const event = byEventId[0] ?? null;
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /ai/events/publish — manually publish a new event
router.post("/ai/events/publish", async (req, res): Promise<void> => {
  const body = PublishEventBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const { eventType, sourceModule, sourceId, correlationId, causationId, payload, metadata } = body.data;
    const event = await publish({
      eventType,
      sourceModule,
      sourceId,
      correlationId,
      causationId,
      payload: payload as Record<string, unknown>,
      metadata: metadata as Record<string, unknown>,
    });
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /ai/events/:id/replay — replay an event through subscriptions
router.post("/ai/events/:id/replay", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  try {
    const result = await replay(id);
    await logAudit("event-bus", "event_replayed_via_api", id, "ai_event", "success");
    res.json(result);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ── Subscriptions ─────────────────────────────────────────────────────────────

// GET /ai/event-subscriptions — list all subscriptions
router.get("/ai/event-subscriptions", async (_req, res): Promise<void> => {
  try {
    const subs = await db
      .select()
      .from(aiEventSubscriptionsTable)
      .orderBy(aiEventSubscriptionsTable.createdAt);
    res.json({ subscriptions: subs, total: subs.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /ai/event-subscriptions — create subscription
router.post("/ai/event-subscriptions", async (req, res): Promise<void> => {
  const body = CreateSubscriptionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const { subscriptionName, eventType, targetType, targetId, handlerType, handlerConfig, retryPolicy } = body.data;
    const sub = await subscribe({
      subscriptionName,
      eventType,
      targetType,
      targetId,
      handlerType,
      handlerConfig: handlerConfig as Record<string, unknown>,
      retryPolicy:   retryPolicy  as Record<string, unknown>,
    });
    res.status(201).json(sub);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "Subscription name already exists" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// PATCH /ai/event-subscriptions/:id — update status, config, or retry policy
router.patch("/ai/event-subscriptions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid subscription id" });
    return;
  }
  const body = UpdateSubscriptionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.status)       patch["status"]             = body.data.status;
    if (body.data.handlerType)  patch["handlerType"]         = body.data.handlerType;
    if (body.data.handlerConfig)patch["handlerConfigJson"]   = body.data.handlerConfig;
    if (body.data.retryPolicy)  patch["retryPolicy"]         = body.data.retryPolicy;

    const [updated] = await db
      .update(aiEventSubscriptionsTable)
      .set(patch)
      .where(eq(aiEventSubscriptionsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }

    await logAudit("event-bus", "subscription_updated", String(id), "ai_event_subscription", "success", patch);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /ai/event-subscriptions/:id — soft-delete (disable)
router.delete("/ai/event-subscriptions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid subscription id" });
    return;
  }
  try {
    await unsubscribe(id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
