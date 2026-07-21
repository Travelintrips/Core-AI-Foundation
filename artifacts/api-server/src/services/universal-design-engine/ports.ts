/**
 * ports.ts — Port interfaces for UniversalDesignEngine
 *
 * The engine depends ONLY on these abstractions. No concrete adapter
 * or infrastructure concern leaks into the domain.
 *
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */

import type {
  DesignProjectSession,
  DesignPluginManifest,
  DesignWorkflowDefinition,
  DesignArtifactRef,
  DesignEvent,
} from "./types.js";
import type { RequestContext } from "../../security/requestContext.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. DesignProjectRepository
//    Persistence for project sessions. Implementations use existing tables
//    (creative_projects + creative_project_steps via adapter).
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignProjectRepository {
  /** Load a session by project ID. Returns undefined if not found. */
  findById(
    ctx: RequestContext,
    projectId: string,
  ): Promise<DesignProjectSession | undefined>;

  /** Persist (insert or upsert) the session. */
  save(ctx: RequestContext, session: DesignProjectSession): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DesignPluginResolver
//    Resolves a plugin manifest by plugin ID. Registry-backed.
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignPluginResolver {
  /**
   * Returns the plugin manifest, or undefined if the plugin is not registered.
   * Never throws — callers check for undefined and throw UnknownPluginError.
   */
  resolve(pluginId: string): Promise<DesignPluginManifest | undefined>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. DesignWorkflowResolver
//    Resolves a workflow definition by ID + version.
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignWorkflowResolver {
  /**
   * Returns the workflow definition, or undefined if not supported.
   * Callers check for undefined and throw UnsupportedWorkflowVersionError.
   */
  resolve(
    workflowId: string,
    version: string,
  ): Promise<DesignWorkflowDefinition | undefined>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DesignArtifactRepository
//    Artifact attachment and versioning. Delegates to creative_ai_assets.
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignArtifactRepository {
  /** Record a new artifact attachment for a stage. Returns the ref. */
  attach(
    ctx: RequestContext,
    projectId: string,
    stageKey: string,
    artifactType: string,
    isRevision: boolean,
  ): Promise<DesignArtifactRef>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DesignEventPublisher
//    Publishes domain events. Implementations fan out to the canonical
//    event bus (aiEventBusService) or write to audit logs.
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignEventPublisher {
  publish(ctx: RequestContext, events: DesignEvent[]): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. DesignExecutionDispatcher
//    Enqueues AI/render tasks for stages that require async execution.
//    The engine never calls AI providers directly.
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignDispatchInput {
  projectId: string;
  tenantId: string;
  stageKey: string;
  requiredCapability: string;
  correlationId: string;
  schemaRef: string | undefined;
  artifactType: string | undefined;
}

export interface DesignExecutionDispatcher {
  /** Enqueue execution work for a stage. Returns a job reference ID. */
  dispatch(ctx: RequestContext, input: DesignDispatchInput): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. DesignClock
//    Provides the current time. Injected so tests are deterministic.
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignClock {
  now(): Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. DesignIdGenerator
//    Generates correlation IDs and deterministic event IDs.
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignIdGenerator {
  /** Generate a new random ID (for correlation IDs, command IDs). */
  newId(): string;
  /**
   * Generate a deterministic event ID from stable inputs.
   * Same inputs must always produce the same output (idempotency).
   */
  eventId(projectId: string, eventType: string, stageKey: string | null, occurredAt: Date): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. DesignAuditSink
//    Records audit trail entries for all commands.
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignAuditEntry {
  commandType: string;
  projectId: string;
  tenantId: string;
  actorId: string | null;
  actorType: string;
  idempotencyKey: string | null;
  timestamp: Date;
  outcome: "success" | "idempotent" | "error";
  errorCode: string | null;
}

export interface DesignAuditSink {
  record(entry: DesignAuditEntry): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate port bag — passed to the engine constructor
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignEnginePorts {
  projectRepository: DesignProjectRepository;
  pluginResolver: DesignPluginResolver;
  workflowResolver: DesignWorkflowResolver;
  artifactRepository: DesignArtifactRepository;
  eventPublisher: DesignEventPublisher;
  executionDispatcher: DesignExecutionDispatcher;
  clock: DesignClock;
  idGenerator: DesignIdGenerator;
  auditSink: DesignAuditSink;
}
