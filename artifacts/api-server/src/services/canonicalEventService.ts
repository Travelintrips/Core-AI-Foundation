/**
 * canonicalEventService.ts — V4.0C Canonical Runtime Event Model
 *
 * Single adapter that projects source-of-truth tables into a unified,
 * customer-safe CanonicalEvent stream. NO new table required — all data
 * comes from existing tables:
 *
 *   creative_projects          → project-level events
 *   creative_project_steps     → step + worker events  (primary execution source)
 *   creative_ai_assets         → artifact events
 *   creative_ai_client_reviews → review events (history from timestamp columns)
 *
 * Design rules enforced here:
 *   - publicMessage is ALWAYS customer-safe (no prompt / key / trace / stack)
 *   - metadata NEVER contains: prompt, reasoning, API key, secret, system
 *     prompt, stack trace, errorMessage, raw model output
 *   - eventId is DETERMINISTIC → idempotent (same row + same status = same id)
 *   - Two sources never emit the same event type for the same fact
 *   - Security: projectId/internalProjectId MUST be pre-validated by caller
 *   - No SSE, no WebSocket, no polling — pure adapter/query layer
 *
 * This service is the SOLE authoritative source of runtime events for:
 *   Workspace Timeline · Activity Feed · AI Workforce · Notifications ·
 *   SSE (future) · WebSocket (future) · Audit Trail · Admin Monitoring ·
 *   Customer Progress
 */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeProjectStepsTable,
  creativeAiAssetsTable,
  creativeAiClientReviewsTable,
} from "@workspace/db";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Event Types
// ─────────────────────────────────────────────────────────────────────────────

export const CANONICAL_EVENT_TYPES = [
  // Project lifecycle
  "project.created",
  "project.workflow_started",
  "project.completed",
  "project.failed",
  // Step lifecycle (creative_project_steps)
  "step.queued",
  "step.started",
  "step.completed",
  "step.failed",
  "step.blocked",
  // Worker lifecycle (derived from same step rows — different view)
  "worker.assigned",
  "worker.started",
  "worker.completed",
  "worker.failed",
  // Artifact lifecycle (creative_ai_assets)
  "artifact.queued",
  "artifact.generating",
  "artifact.created",
  "artifact.approved",
  "artifact.revision_requested",
  "artifact.failed",
  // Review lifecycle (creative_ai_client_reviews)
  "review.requested",
  "review.started",
  "review.approved",
  "review.revision_requested",
  "review.completed",
] as const;

export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Safe Metadata
// NEVER include: prompt, reasoning, API key, secret, system prompt, stack trace,
// errorMessage, raw model output, or internal identifiers that leak internals.
// ─────────────────────────────────────────────────────────────────────────────

export interface SafeMetadata {
  stepName?:  string;
  agentRole?: string;
  provider?:  string;
  model?:     string;
  assetType?: string;
  assetId?:   number;
  reviewId?:  number;
  qcScore?:   number;
  latencyMs?: number;
  tokenUsage?: number;
  stepIndex?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Event
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalEvent {
  /** Deterministic — same source row + same status always produces same ID. */
  eventId:       string;
  eventType:     CanonicalEventType;
  /** Primary security / tenant boundary — always present, never null. */
  projectId:     string;
  workflowId:    string | null;
  stepId:        number | null;
  /** Agent role key e.g. "brand-strategist". Null for project/artifact/review events. */
  workerId:      string | null;
  /** Real timestamp from DB — never invented. ISO-8601 string. */
  createdAt:     string;
  /** Customer-safe. Never contains prompt / key / trace / reasoning. */
  publicMessage: string;
  severity:      "info" | "warning" | "error";
  /** Raw status from source table — for admin/debug use only. */
  status:        string;
  /** 0–100 — derived from position in pipeline. Never fabricated. */
  progress:      number;
  source:        "project" | "step" | "worker" | "artifact" | "review";
  metadata:      SafeMetadata;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step pipeline constants
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors PIPELINE in creativeWorkflowRunner.ts — stepName values written to DB. */
const STEP_PIPELINE: readonly string[] = [
  "Brand Strategy",
  "Creative Direction",
  "Copy Production",
  "Quality Control",
];

const STEP_ROLE_KEY: Record<string, string> = {
  "Brand Strategy":    "brand-strategist",
  "Creative Direction": "creative-director",
  "Copy Production":   "copywriter",
  "Quality Control":   "quality-control",
};

// ─────────────────────────────────────────────────────────────────────────────
// Customer-safe public messages
// ─────────────────────────────────────────────────────────────────────────────

const STEP_MESSAGES: Record<string, Record<string, string>> = {
  "Brand Strategy": {
    "step.queued":   "Brand Strategist AI is queued and will begin shortly.",
    "step.started":  "Brand Strategist AI started analyzing your brief.",
    "step.completed":"Brand Strategist AI completed market positioning.",
    "step.failed":   "Brand Strategist AI encountered an issue. Our team has been notified.",
    "step.blocked":  "Strategy step paused — project budget limit reached.",
  },
  "Creative Direction": {
    "step.queued":   "Creative Director AI is queued and will begin shortly.",
    "step.started":  "Creative Director AI started developing your creative concept.",
    "step.completed":"Creative Director AI completed creative direction.",
    "step.failed":   "Creative Director AI encountered an issue. Our team has been notified.",
    "step.blocked":  "Creative step paused — project budget limit reached.",
  },
  "Copy Production": {
    "step.queued":   "Copywriter AI is queued and will begin shortly.",
    "step.started":  "Copywriter AI started writing copy for your brand.",
    "step.completed":"Copywriter AI completed copy production.",
    "step.failed":   "Copywriter AI encountered an issue. Our team has been notified.",
    "step.blocked":  "Copy step paused — project budget limit reached.",
  },
  "Quality Control": {
    "step.queued":   "Quality Control AI is queued and will begin shortly.",
    "step.started":  "Quality Control AI started reviewing the creative output.",
    "step.completed":"Quality Control AI approved the creative output.",
    "step.failed":   "Quality Control AI found issues. Our team has been notified.",
    "step.blocked":  "QC step paused — project budget limit reached.",
  },
};

function stepMessage(stepName: string, eventType: CanonicalEventType): string {
  const msgs = STEP_MESSAGES[stepName];
  if (!msgs) return `AI is processing ${stepName}.`;
  return msgs[eventType] ?? `AI is processing ${stepName}.`;
}

const ARTIFACT_MESSAGES: Record<CanonicalEventType, string> = {
  "artifact.queued":             "Visual asset generation is queued.",
  "artifact.generating":         "Designer AI is generating visual concepts for your brand.",
  "artifact.created":            "Designer AI created a visual concept and it is ready for review.",
  "artifact.approved":           "Visual asset approved and added to your brand library.",
  "artifact.revision_requested": "Visual asset sent back for revision.",
  "artifact.failed":             "Visual asset generation encountered an issue. Our team has been notified.",
} as Record<CanonicalEventType, string>;

const REVIEW_MESSAGES: Record<CanonicalEventType, string> = {
  "review.requested":          "Your creative output is ready for your review.",
  "review.started":            "You opened the review — your feedback is welcome.",
  "review.approved":           "You approved the creative output. Great choice!",
  "review.revision_requested": "Revision requested — our team will update the work.",
  "review.completed":          "Review cycle completed.",
} as Record<CanonicalEventType, string>;

// ─────────────────────────────────────────────────────────────────────────────
// Progress calculation
// ─────────────────────────────────────────────────────────────────────────────

function stepProgress(stepIdx: number, totalSteps: number, terminal: boolean): number {
  // Steps account for 0–80% of overall progress
  const frac = terminal
    ? (stepIdx + 1) / totalSteps
    : (stepIdx + 0.3) / totalSteps;
  return Math.round(frac * 80);
}

const ARTIFACT_PROGRESS: Partial<Record<CanonicalEventType, number>> = {
  "artifact.queued":             82,
  "artifact.generating":         85,
  "artifact.created":            90,
  "artifact.approved":           92,
  "artifact.revision_requested": 90,
  "artifact.failed":             80,
};

const REVIEW_PROGRESS: Partial<Record<CanonicalEventType, number>> = {
  "review.requested":          93,
  "review.started":            95,
  "review.approved":           100,
  "review.revision_requested": 95,
  "review.completed":          100,
};

// ─────────────────────────────────────────────────────────────────────────────
// Severity
// ─────────────────────────────────────────────────────────────────────────────

export function severityForEventType(eventType: CanonicalEventType): "info" | "warning" | "error" {
  if (eventType.endsWith(".failed")) return "error";
  if (eventType.endsWith(".blocked") || eventType.endsWith(".revision_requested")) return "warning";
  return "info";
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw DB row types (only the columns we need — no prompts/outputs/errors)
// ─────────────────────────────────────────────────────────────────────────────

export interface RawStepRow {
  id:         number;
  projectId:  number;   // internal integer FK
  stepName:   string;
  status:     string;
  provider:   string | null;
  model:      string | null;
  tokenUsage: number;
  latencyMs:  number | null;
  createdAt:  Date;
  updatedAt:  Date;
}

export interface RawAssetRow {
  id:        number;
  projectId: string;   // UUID string
  stepId:    number | null;
  assetType: string;
  status:    string;
  qcScore:   number | null;
  latencyMs: number | null;
  createdAt: Date;
}

export interface RawReviewRow {
  id:                  number;
  projectId:           string;
  status:              string;
  sharedAt:            Date | null;
  viewedAt:            Date | null;
  approvedAt:          Date | null;
  rejectedAt:          Date | null;
  revisionRequestedAt: Date | null;
  revokedAt:           Date | null;
  createdAt:           Date;
}

export interface RawProjectRow {
  id:        number;
  projectId: string;
  status:    string;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure projection functions (no DB calls — testable in isolation)
// ─────────────────────────────────────────────────────────────────────────────

/** Project a creative_project_steps row into CanonicalEvent[]. */
export function projectStep(
  projectIdStr: string,
  step: RawStepRow,
  stepIdx: number,
  totalSteps: number,
): CanonicalEvent[] {
  const roleKey = STEP_ROLE_KEY[step.stepName]
    ?? step.stepName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const safeMeta: SafeMetadata = {
    stepName:  step.stepName,
    agentRole: roleKey,
    stepIndex: stepIdx,
    // Only include provider/model/latency/tokens if they have real values
    ...(step.provider  ? { provider:  step.provider }  : {}),
    ...(step.model     ? { model:     step.model }     : {}),
    ...(step.latencyMs ? { latencyMs: step.latencyMs } : {}),
    ...(step.tokenUsage > 0 ? { tokenUsage: step.tokenUsage } : {}),
  };

  const events: CanonicalEvent[] = [];

  // ── Map status to event types ───────────────────────────────────────────────
  let startStepType:   CanonicalEventType;
  let startWorkerType: CanonicalEventType | null = null;
  let finalStepType:   CanonicalEventType | null = null;
  let finalWorkerType: CanonicalEventType | null = null;

  switch (step.status) {
    case "pending":
      startStepType   = "step.queued";
      startWorkerType = "worker.assigned";
      break;
    case "running":
      startStepType   = "step.started";
      startWorkerType = "worker.started";
      break;
    case "completed":
      startStepType   = "step.started";
      startWorkerType = "worker.started";
      finalStepType   = "step.completed";
      finalWorkerType = "worker.completed";
      break;
    case "failed":
      startStepType   = "step.started";
      startWorkerType = "worker.started";
      finalStepType   = "step.failed";
      finalWorkerType = "worker.failed";
      break;
    case "blocked_by_budget":
      startStepType = "step.blocked";
      // No worker event for budget-blocked steps — worker was never assigned
      break;
    default:
      startStepType = "step.queued";
  }

  const startProgress = stepProgress(stepIdx, totalSteps, false);
  const finalProgress = stepProgress(stepIdx, totalSteps, true);

  // Emit start step event (at createdAt — when runner inserted the row)
  events.push({
    eventId:       `step:${step.id}:start`,
    eventType:     startStepType,
    projectId:     projectIdStr,
    workflowId:    null,
    stepId:        step.id,
    workerId:      roleKey,
    createdAt:     step.createdAt.toISOString(),
    publicMessage: stepMessage(step.stepName, startStepType),
    severity:      severityForEventType(startStepType),
    status:        step.status,
    progress:      startProgress,
    source:        "step",
    metadata:      safeMeta,
  });

  // Emit start worker event (separate view of the same fact, different eventType)
  if (startWorkerType) {
    events.push({
      eventId:       `worker:${step.id}:start`,
      eventType:     startWorkerType,
      projectId:     projectIdStr,
      workflowId:    null,
      stepId:        step.id,
      workerId:      roleKey,
      createdAt:     step.createdAt.toISOString(),
      publicMessage: stepMessage(step.stepName, startStepType),
      severity:      "info",
      status:        step.status,
      progress:      startProgress,
      source:        "worker",
      metadata:      safeMeta,
    });
  }

  // Emit terminal events (at updatedAt — when runner wrote final status)
  if (finalStepType) {
    events.push({
      eventId:       `step:${step.id}:final`,
      eventType:     finalStepType,
      projectId:     projectIdStr,
      workflowId:    null,
      stepId:        step.id,
      workerId:      roleKey,
      createdAt:     step.updatedAt.toISOString(),
      publicMessage: stepMessage(step.stepName, finalStepType),
      severity:      severityForEventType(finalStepType),
      status:        step.status,
      progress:      finalProgress,
      source:        "step",
      metadata:      safeMeta,
    });
  }

  if (finalWorkerType) {
    events.push({
      eventId:       `worker:${step.id}:final`,
      eventType:     finalWorkerType,
      projectId:     projectIdStr,
      workflowId:    null,
      stepId:        step.id,
      workerId:      roleKey,
      createdAt:     step.updatedAt.toISOString(),
      publicMessage: stepMessage(step.stepName, finalStepType!),
      severity:      severityForEventType(finalWorkerType),
      status:        step.status,
      progress:      finalProgress,
      source:        "worker",
      metadata:      safeMeta,
    });
  }

  return events;
}

/** Project a creative_ai_assets row into a CanonicalEvent (or null if status unknown). */
export function projectAsset(asset: RawAssetRow): CanonicalEvent | null {
  const eventTypeMap: Partial<Record<string, CanonicalEventType>> = {
    pending:        "artifact.queued",
    generating:     "artifact.generating",
    completed:      "artifact.created",
    failed:         "artifact.failed",
    approved:       "artifact.approved",
    needs_revision: "artifact.revision_requested",
    rejected:       "artifact.failed",
  };

  const eventType = eventTypeMap[asset.status];
  if (!eventType) return null;

  const safeMeta: SafeMetadata = {
    assetType: asset.assetType,
    assetId:   asset.id,
    ...(asset.qcScore  ? { qcScore:  asset.qcScore }  : {}),
    ...(asset.latencyMs ? { latencyMs: asset.latencyMs } : {}),
  };

  return {
    eventId:       `asset:${asset.id}:${asset.status}`,
    eventType,
    projectId:     asset.projectId,
    workflowId:    null,
    stepId:        asset.stepId ?? null,
    workerId:      "image-designer",
    createdAt:     asset.createdAt.toISOString(),
    publicMessage: ARTIFACT_MESSAGES[eventType] ?? "Designer AI is processing your visual assets.",
    severity:      severityForEventType(eventType),
    status:        asset.status,
    progress:      ARTIFACT_PROGRESS[eventType] ?? 85,
    source:        "artifact",
    metadata:      safeMeta,
  };
}

/**
 * Project a creative_ai_client_reviews row into CanonicalEvent[].
 * Reconstructs history from timestamp columns — each timestamp = one real event.
 */
export function projectReview(review: RawReviewRow): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];

  const push = (
    suffix: string,
    eventType: CanonicalEventType,
    rawStatus: string,
    at: Date,
  ): void => {
    events.push({
      eventId:       `review:${review.id}:${suffix}`,
      eventType,
      projectId:     review.projectId,
      workflowId:    null,
      stepId:        null,
      workerId:      null,
      createdAt:     at.toISOString(),
      publicMessage: REVIEW_MESSAGES[eventType] ?? "Review updated.",
      severity:      severityForEventType(eventType),
      status:        rawStatus,
      progress:      REVIEW_PROGRESS[eventType] ?? 93,
      source:        "review",
      metadata:      { reviewId: review.id },
    });
  };

  if (review.sharedAt)            push("shared",   "review.requested",          "shared",             review.sharedAt);
  if (review.viewedAt)            push("viewed",   "review.started",            "viewed",             review.viewedAt);
  if (review.approvedAt)          push("approved", "review.approved",           "approved",           review.approvedAt);
  if (review.revisionRequestedAt) push("revision", "review.revision_requested", "revision_requested", review.revisionRequestedAt);
  if (review.rejectedAt)          push("rejected", "review.completed",          "rejected",           review.rejectedAt);
  if (review.revokedAt)           push("revoked",  "review.completed",          "revoked",            review.revokedAt);

  return events;
}

/** Project a creative_projects row into project-level CanonicalEvent[]. */
export function projectProjectRow(project: RawProjectRow): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];

  events.push({
    eventId:       `project:${project.id}:created`,
    eventType:     "project.created",
    projectId:     project.projectId,
    workflowId:    null,
    stepId:        null,
    workerId:      null,
    createdAt:     project.createdAt.toISOString(),
    publicMessage: "Your project has been created and is being prepared.",
    severity:      "info",
    status:        "created",
    progress:      5,
    source:        "project",
    metadata:      {},
  });

  if (project.status === "running") {
    events.push({
      eventId:       `project:${project.id}:workflow_started`,
      eventType:     "project.workflow_started",
      projectId:     project.projectId,
      workflowId:    null,
      stepId:        null,
      workerId:      null,
      createdAt:     project.updatedAt.toISOString(),
      publicMessage: "AI workflow started — your creative team is now working on your brief.",
      severity:      "info",
      status:        "running",
      progress:      10,
      source:        "project",
      metadata:      {},
    });
  } else if (project.status === "completed") {
    events.push({
      eventId:       `project:${project.id}:completed`,
      eventType:     "project.completed",
      projectId:     project.projectId,
      workflowId:    null,
      stepId:        null,
      workerId:      null,
      createdAt:     project.updatedAt.toISOString(),
      publicMessage: "Your project has been completed successfully.",
      severity:      "info",
      status:        "completed",
      progress:      100,
      source:        "project",
      metadata:      {},
    });
  } else if (project.status === "failed") {
    events.push({
      eventId:       `project:${project.id}:failed`,
      eventType:     "project.failed",
      projectId:     project.projectId,
      workflowId:    null,
      stepId:        null,
      workerId:      null,
      createdAt:     project.updatedAt.toISOString(),
      publicMessage: "Your project encountered an issue. Our team has been notified.",
      severity:      "error",
      status:        "failed",
      progress:      0,
      source:        "project",
      metadata:      {},
    });
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity Feed filter
// Only user-facing events — no internal worker chatter
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVITY_FEED_TYPES = new Set<CanonicalEventType>([
  "project.created",
  "project.workflow_started",
  "project.completed",
  "project.failed",
  "step.completed",
  "step.failed",
  "step.blocked",
  "artifact.created",
  "artifact.approved",
  "artifact.revision_requested",
  "review.requested",
  "review.started",
  "review.approved",
  "review.revision_requested",
]);

export function filterForActivityFeed(events: CanonicalEvent[]): CanonicalEvent[] {
  return events.filter((e) => ACTIVITY_FEED_TYPES.has(e.eventType));
}

// ─────────────────────────────────────────────────────────────────────────────
// Database queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch and project all canonical events for a single project.
 *
 * SECURITY CONTRACT: `internalProjectId` and `projectId` MUST have been
 * validated as belonging to the calling customer's session by the route
 * handler before invoking this function. This function trusts the caller.
 */
export async function getEventsForProject(
  projectId: string,
  internalProjectId: number,
): Promise<CanonicalEvent[]> {
  const [projectRows, stepRows, assetRows, reviewRows] = await Promise.all([
    db
      .select({
        id:        creativeProjectsTable.id,
        projectId: creativeProjectsTable.projectId,
        status:    creativeProjectsTable.status,
        createdAt: creativeProjectsTable.createdAt,
        updatedAt: creativeProjectsTable.updatedAt,
      })
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.id, internalProjectId)),

    db
      .select({
        id:         creativeProjectStepsTable.id,
        projectId:  creativeProjectStepsTable.projectId,
        stepName:   creativeProjectStepsTable.stepName,
        status:     creativeProjectStepsTable.status,
        provider:   creativeProjectStepsTable.provider,
        model:      creativeProjectStepsTable.model,
        tokenUsage: creativeProjectStepsTable.tokenUsage,
        latencyMs:  creativeProjectStepsTable.latencyMs,
        createdAt:  creativeProjectStepsTable.createdAt,
        updatedAt:  creativeProjectStepsTable.updatedAt,
      })
      .from(creativeProjectStepsTable)
      .where(eq(creativeProjectStepsTable.projectId, internalProjectId))
      .orderBy(creativeProjectStepsTable.id),

    db
      .select({
        id:        creativeAiAssetsTable.id,
        projectId: creativeAiAssetsTable.projectId,
        stepId:    creativeAiAssetsTable.stepId,
        assetType: creativeAiAssetsTable.assetType,
        status:    creativeAiAssetsTable.status,
        qcScore:   creativeAiAssetsTable.qcScore,
        latencyMs: creativeAiAssetsTable.latencyMs,
        createdAt: creativeAiAssetsTable.createdAt,
      })
      .from(creativeAiAssetsTable)
      .where(eq(creativeAiAssetsTable.projectId, projectId)),

    db
      .select({
        id:                  creativeAiClientReviewsTable.id,
        projectId:           creativeAiClientReviewsTable.projectId,
        status:              creativeAiClientReviewsTable.status,
        sharedAt:            creativeAiClientReviewsTable.sharedAt,
        viewedAt:            creativeAiClientReviewsTable.viewedAt,
        approvedAt:          creativeAiClientReviewsTable.approvedAt,
        rejectedAt:          creativeAiClientReviewsTable.rejectedAt,
        revisionRequestedAt: creativeAiClientReviewsTable.revisionRequestedAt,
        revokedAt:           creativeAiClientReviewsTable.revokedAt,
        createdAt:           creativeAiClientReviewsTable.createdAt,
      })
      .from(creativeAiClientReviewsTable)
      .where(eq(creativeAiClientReviewsTable.projectId, projectId)),
  ]);

  const allEvents: CanonicalEvent[] = [];

  // 1. Project-level events
  for (const p of projectRows) {
    allEvents.push(...projectProjectRow(p));
  }

  // 2. Step + worker events (source of truth: creative_project_steps)
  const totalSteps = STEP_PIPELINE.length;
  for (const step of stepRows) {
    const stepIdx = STEP_PIPELINE.indexOf(step.stepName);
    const effectiveIdx = stepIdx === -1 ? 0 : stepIdx;
    allEvents.push(...projectStep(projectId, step, effectiveIdx, totalSteps));
  }

  // 3. Artifact events
  for (const asset of assetRows) {
    const evt = projectAsset(asset);
    if (evt) allEvents.push(evt);
  }

  // 4. Review events (history reconstructed from timestamp columns)
  for (const review of reviewRows) {
    allEvents.push(...projectReview(review));
  }

  // Sort by createdAt ASC (chronological order)
  allEvents.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return allEvents;
}

/**
 * Batch-fetch events for multiple projects (used by activity feed).
 * Uses a single DB round-trip per table — no N+1 queries.
 *
 * SECURITY CONTRACT: all projectId / internalProjectId pairs MUST have been
 * validated as belonging to the calling customer's session.
 */
export async function getEventsForProjects(
  projects: Array<{ projectId: string; internalProjectId: number | null }>,
  opts: { limit?: number; chronological?: boolean } = {},
): Promise<CanonicalEvent[]> {
  const { limit = 100, chronological = false } = opts;

  const withInternal = projects.filter(
    (p): p is { projectId: string; internalProjectId: number } => p.internalProjectId !== null,
  );
  if (withInternal.length === 0) return [];

  const internalIds   = withInternal.map((p) => p.internalProjectId);
  const projectIdStrs = withInternal.map((p) => p.projectId);

  // One round-trip per source table
  const [projectRows, stepRows, assetRows, reviewRows] = await Promise.all([
    db
      .select({
        id:        creativeProjectsTable.id,
        projectId: creativeProjectsTable.projectId,
        status:    creativeProjectsTable.status,
        createdAt: creativeProjectsTable.createdAt,
        updatedAt: creativeProjectsTable.updatedAt,
      })
      .from(creativeProjectsTable)
      .where(inArray(creativeProjectsTable.id, internalIds)),

    db
      .select({
        id:         creativeProjectStepsTable.id,
        projectId:  creativeProjectStepsTable.projectId,
        stepName:   creativeProjectStepsTable.stepName,
        status:     creativeProjectStepsTable.status,
        provider:   creativeProjectStepsTable.provider,
        model:      creativeProjectStepsTable.model,
        tokenUsage: creativeProjectStepsTable.tokenUsage,
        latencyMs:  creativeProjectStepsTable.latencyMs,
        createdAt:  creativeProjectStepsTable.createdAt,
        updatedAt:  creativeProjectStepsTable.updatedAt,
      })
      .from(creativeProjectStepsTable)
      .where(inArray(creativeProjectStepsTable.projectId, internalIds))
      .orderBy(creativeProjectStepsTable.id),

    db
      .select({
        id:        creativeAiAssetsTable.id,
        projectId: creativeAiAssetsTable.projectId,
        stepId:    creativeAiAssetsTable.stepId,
        assetType: creativeAiAssetsTable.assetType,
        status:    creativeAiAssetsTable.status,
        qcScore:   creativeAiAssetsTable.qcScore,
        latencyMs: creativeAiAssetsTable.latencyMs,
        createdAt: creativeAiAssetsTable.createdAt,
      })
      .from(creativeAiAssetsTable)
      .where(inArray(creativeAiAssetsTable.projectId, projectIdStrs)),

    db
      .select({
        id:                  creativeAiClientReviewsTable.id,
        projectId:           creativeAiClientReviewsTable.projectId,
        status:              creativeAiClientReviewsTable.status,
        sharedAt:            creativeAiClientReviewsTable.sharedAt,
        viewedAt:            creativeAiClientReviewsTable.viewedAt,
        approvedAt:          creativeAiClientReviewsTable.approvedAt,
        rejectedAt:          creativeAiClientReviewsTable.rejectedAt,
        revisionRequestedAt: creativeAiClientReviewsTable.revisionRequestedAt,
        revokedAt:           creativeAiClientReviewsTable.revokedAt,
        createdAt:           creativeAiClientReviewsTable.createdAt,
      })
      .from(creativeAiClientReviewsTable)
      .where(inArray(creativeAiClientReviewsTable.projectId, projectIdStrs)),
  ]);

  // Build lookup: internalId → projectId string
  const idToString = new Map(withInternal.map((p) => [p.internalProjectId, p.projectId]));

  const allEvents: CanonicalEvent[] = [];

  for (const p of projectRows) {
    allEvents.push(...projectProjectRow(p));
  }

  const totalSteps = STEP_PIPELINE.length;
  for (const step of stepRows) {
    const projectIdStr = idToString.get(step.projectId);
    if (!projectIdStr) continue;
    const stepIdx = STEP_PIPELINE.indexOf(step.stepName);
    allEvents.push(...projectStep(projectIdStr, step, stepIdx === -1 ? 0 : stepIdx, totalSteps));
  }

  for (const asset of assetRows) {
    const evt = projectAsset(asset);
    if (evt) allEvents.push(evt);
  }

  for (const review of reviewRows) {
    allEvents.push(...projectReview(review));
  }

  allEvents.sort(chronological
    ? (a, b) => a.createdAt.localeCompare(b.createdAt)
    : (a, b) => b.createdAt.localeCompare(a.createdAt),
  );

  return allEvents.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Event → Snapshot helpers (for Workspace Snapshot + Timeline)
// ─────────────────────────────────────────────────────────────────────────────

/** Derive the maximum progress reached from a set of canonical events. */
export function deriveProgress(events: CanonicalEvent[]): number {
  return events.reduce((max, e) => (e.progress > max ? e.progress : max), 0);
}

/** Return the most recent event (by createdAt) from a set. */
export function latestEvent(events: CanonicalEvent[]): CanonicalEvent | null {
  if (events.length === 0) return null;
  return events.reduce((latest, e) =>
    e.createdAt > latest.createdAt ? e : latest,
  );
}
