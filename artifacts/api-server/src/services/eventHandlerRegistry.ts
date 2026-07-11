/**
 * eventHandlerRegistry — Phase 5.5 AI Event Bus
 *
 * Modular, extensible handlers invoked by aiEventBusService when an event
 * matches a subscription's handlerType.
 *
 * Handlers must:
 *   - Never throw (catch internally)
 *   - Return { ok: true } on success or { ok: false, error: string } on failure
 *   - Be idempotent (safe to call more than once for the same event/subscription)
 */

import { db, aiJobsTable, creativeProjectsTable } from "@workspace/db";
import type { AiEvent, AiEventSubscription } from "@workspace/db";
import { eq } from "drizzle-orm";
import { enqueue } from "./queueManagerService.js";
import { logAudit } from "./aiAuditService.js";
import { logger } from "../lib/logger.js";

export interface HandlerResult {
  ok:     boolean;
  error?: string;
  data?:  Record<string, unknown>;
}

export type HandlerFn = (
  event:        AiEvent,
  subscription: AiEventSubscription,
  config:       Record<string, unknown>,
) => Promise<HandlerResult>;

// ── create_job ────────────────────────────────────────────────────────────────

const createJobHandler: HandlerFn = async (event, sub, config) => {
  try {
    const jobType           = (config["jobType"]           as string | undefined)  ?? "custom";
    const requiredCapability= (config["requiredCapability"]as string | undefined)  ?? undefined;
    const priority          = (config["priority"]          as number | undefined)  ?? 50;
    const correlationId     = event.correlationId;

    // Idempotency: use a deterministic job code derived from eventId + subscriptionId
    // so replaying the same event cannot create duplicate jobs.
    const dedupeKey = `EVT-${event.eventId.slice(0, 8)}-SUB${sub.id}`.toUpperCase();

    // Check if a job with this code already exists
    const { db: dbInst, aiJobsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [existing] = await dbInst.select({ id: aiJobsTable.id, jobCode: aiJobsTable.jobCode })
      .from(aiJobsTable).where(eq(aiJobsTable.jobCode, dedupeKey)).limit(1);
    if (existing) {
      logger.info({ jobCode: dedupeKey, eventId: event.eventId }, "[event-handler] create_job: already exists (idempotent skip)");
      return { ok: true, data: { jobCode: dedupeKey, skipped: true } };
    }

    const payload: Record<string, unknown> = {
      triggeredByEvent: event.eventId,
      eventType:        event.eventType,
      correlationId,
      ...(config["extraPayload"] as Record<string, unknown> | undefined ?? {}),
      ...(event.payloadJson as Record<string, unknown>),
    };

    const job = await enqueue({
      jobType,
      priority,
      payloadJson: { ...payload, requiredCapability },
    });

    logger.info({ jobCode: job.jobCode, triggeredBy: event.eventId }, "[event-handler] create_job: job enqueued");
    return { ok: true, data: { jobCode: job.jobCode } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, eventId: event.eventId }, "[event-handler] create_job failed");
    return { ok: false, error: msg };
  }
};

// ── audit_log ─────────────────────────────────────────────────────────────────

const auditLogHandler: HandlerFn = async (event, sub, _config) => {
  try {
    await logAudit(
      "event-bus",
      `event_dispatched:${event.eventType}`,
      event.eventId,
      "ai_event",
      "success",
      {
        subscriptionName: sub.subscriptionName,
        sourceModule:     event.sourceModule,
        correlationId:    event.correlationId,
      },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};

// ── notification_hook ─────────────────────────────────────────────────────────
// For now: audit log + structured console log. No real email/WhatsApp.

const notificationHookHandler: HandlerFn = async (event, sub, config) => {
  try {
    const message = (config["message"] as string | undefined) ??
      `[Notification] Event ${event.eventType} from ${event.sourceModule}`;

    logger.info({
      eventId:          event.eventId,
      eventType:        event.eventType,
      subscriptionName: sub.subscriptionName,
      message,
      payload:          event.payloadJson,
    }, "[event-handler] notification_hook");

    await logAudit(
      "event-bus",
      "notification_hook",
      event.eventId,
      "ai_event",
      "success",
      { subscriptionName: sub.subscriptionName, message },
    );

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};

// ── update_project_status ─────────────────────────────────────────────────────

const updateProjectStatusHandler: HandlerFn = async (event, _sub, config) => {
  try {
    const payload   = event.payloadJson as Record<string, unknown>;
    const projectId = (config["projectId"] as string | undefined) ??
                      (payload["projectId"] as string | undefined);
    const newStatus = (config["status"]    as string | undefined);

    if (!projectId || !newStatus) {
      return { ok: false, error: "update_project_status requires projectId and status in config" };
    }

    await db
      .update(creativeProjectsTable)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(creativeProjectsTable.projectId, projectId));

    logger.info({ projectId, newStatus, eventId: event.eventId }, "[event-handler] update_project_status");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};

// ── call_webhook ──────────────────────────────────────────────────────────────

const callWebhookHandler: HandlerFn = async (event, _sub, config) => {
  try {
    const url    = config["url"] as string | undefined;
    const method = (config["method"] as string | undefined) ?? "POST";

    if (!url) return { ok: false, error: "call_webhook requires url in config" };

    const body = JSON.stringify({
      eventId:       event.eventId,
      eventType:     event.eventType,
      sourceModule:  event.sourceModule,
      correlationId: event.correlationId,
      payload:       event.payloadJson,
    });

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!resp.ok) {
      return { ok: false, error: `Webhook returned ${resp.status}` };
    }

    logger.info({ url, eventId: event.eventId }, "[event-handler] call_webhook success");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};

// ── Registry ──────────────────────────────────────────────────────────────────

// ── automation_trigger ────────────────────────────────────────────────────────
// Evaluates all matching automation rules when an event fires.

const automationTriggerHandler: HandlerFn = async (event, _sub, _config) => {
  try {
    const { evaluateRulesForEvent } = await import("./commercialAutomationService.js");
    const payload = (event.payloadJson ?? {}) as Record<string, unknown>;
    const customerProfileId =
      typeof payload.customerProfileId === "number" ? payload.customerProfileId : null;
    const results = await evaluateRulesForEvent({
      eventType: event.eventType,
      eventId: event.eventId,
      payload,
      customerProfileId,
    });
    return { ok: true, data: { rulesEvaluated: results.length, results } };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};

// ── recalculate_health ────────────────────────────────────────────────────────
// Recalculates a customer's health score on-demand from event data.

const recalculateHealthHandler: HandlerFn = async (event, _sub, _config) => {
  try {
    const payload = (event.payloadJson ?? {}) as Record<string, unknown>;
    const customerProfileId =
      typeof payload.customerProfileId === "number" ? payload.customerProfileId : null;
    if (customerProfileId == null) return { ok: true, data: { skipped: "no_customer_profile_id" } };
    const { calculateHealthScore } = await import("./customerHealthService.js");
    const score = await calculateHealthScore(customerProfileId);
    return { ok: true, data: { customerProfileId, overallScore: score.overallScore } };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};

// ── resegment_customer ────────────────────────────────────────────────────────
// Re-evaluates a customer's segment from event data.

const resegmentCustomerHandler: HandlerFn = async (event, _sub, _config) => {
  try {
    const payload = (event.payloadJson ?? {}) as Record<string, unknown>;
    const customerProfileId =
      typeof payload.customerProfileId === "number" ? payload.customerProfileId : null;
    if (customerProfileId == null) return { ok: true, data: { skipped: "no_customer_profile_id" } };
    const { calculateCustomerSegment } = await import("./customerSegmentService.js");
    const seg = await calculateCustomerSegment(customerProfileId);
    return { ok: true, data: { customerProfileId, segment: seg.segment } };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};

// ── track_funnel_event ────────────────────────────────────────────────────────
// Auto-tracks a funnel event from the event bus payload.

const trackFunnelEventHandler: HandlerFn = async (event, _sub, _config) => {
  try {
    const { trackFunnelEvent } = await import("./funnelEventService.js");
    const payload = (event.payloadJson ?? {}) as Record<string, unknown>;
    await trackFunnelEvent({
      eventType: String(payload.funnelEventType ?? event.eventType),
      visitorId: typeof payload.visitorId === "string" ? payload.visitorId : undefined,
      customerId: typeof payload.customerId === "number" ? payload.customerId : undefined,
      sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
      serviceId: typeof payload.serviceId === "number" ? payload.serviceId : undefined,
      portfolioId: typeof payload.portfolioId === "number" ? payload.portfolioId : undefined,
      packageId: typeof payload.packageId === "number" ? payload.packageId : undefined,
      projectId: typeof payload.projectId === "string" ? payload.projectId : undefined,
      device: typeof payload.device === "string" ? payload.device : undefined,
      country: typeof payload.country === "string" ? payload.country : undefined,
      metadata: typeof payload.metadata === "object" && payload.metadata !== null
        ? payload.metadata as Record<string, unknown>
        : undefined,
    });
    return { ok: true, data: { tracked: true } };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const eventHandlerRegistry: Record<string, HandlerFn> = {
  create_job:             createJobHandler,
  audit_log:              auditLogHandler,
  notification_hook:      notificationHookHandler,
  update_project_status:  updateProjectStatusHandler,
  call_webhook:           callWebhookHandler,
  automation_trigger:     automationTriggerHandler,
  recalculate_health:     recalculateHealthHandler,
  resegment_customer:     resegmentCustomerHandler,
  track_funnel_event:     trackFunnelEventHandler,
};
