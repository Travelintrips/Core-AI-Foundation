/**
 * UniversalDesignEngine.ts — Core runtime for Universal Design Platform
 *
 * Responsibilities:
 *   1. Open design project sessions from canonical project records
 *   2. Load plugin manifests via DesignPluginResolver
 *   3. Load workflow definitions via DesignWorkflowResolver
 *   4. Enforce lifecycle transitions (state machine)
 *   5. Execute commands deterministically
 *   6. Emit typed events compatible with CanonicalEvent model
 *   7. Delegate AI, renderer, storage, persistence through ports
 *   8. Support idempotency via idempotency keys
 *   9. Support correlation IDs from RequestContext
 *
 * The engine is domain-neutral. It contains NO knowledge of Fashion, Interior,
 * Packaging, Branding, or any other service domain. Plugin manifests and
 * workflow definitions carry all domain-specific configuration.
 *
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */

import type { RequestContext } from "../../security/requestContext.js";
import type { DesignEnginePorts } from "./ports.js";
import type { DesignCommand, InitializeProjectCommand } from "./commands.js";

/** Commands that flow through dispatch() — initializeProject is handled before dispatch is called. */
type DispatchableCommand = Exclude<DesignCommand, InitializeProjectCommand>;
import type {
  DesignProjectSession,
  DesignStage,
  DesignEvent,
  DesignCommandResult,
  StageStatus,
  ProjectStatus,
  WorkflowStageDef,
} from "./types.js";
import { TERMINAL_PROJECT_STATUSES } from "./types.js";
import {
  assertProjectCanTransition,
  assertStageCanTransition,
  assertDependenciesMet,
  assertCanSkip,
  assertCanRetry,
  deriveProjectStatus,
} from "./stateMachine.js";
import {
  UnknownPluginError,
  UnsupportedWorkflowVersionError,
  TenantMismatchError,
  TerminalProjectError,
  InvalidTransitionError,
  DuplicateCommandError,
} from "./errors.js";

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

export class UniversalDesignEngine {
  constructor(private readonly ports: DesignEnginePorts) {}

  // ── Public entry point ────────────────────────────────────────────────────

  /**
   * Execute a command against a project session.
   *
   * Guarantees:
   * - Tenant isolation: ctx.tenantId must match session.tenantId
   * - Idempotency: a command with a duplicate idempotencyKey is a no-op
   * - All side effects go through injected ports
   * - Events are published before save (so failures are observable)
   */
  async execute(
    ctx: RequestContext,
    command: DesignCommand,
    idempotencyKey?: string,
  ): Promise<DesignCommandResult> {
    const commandId = this.ports.idGenerator.newId();

    // initializeProject doesn't require a pre-existing session
    if (command.type === "initializeProject") {
      return this.handleInitializeProject(ctx, command, commandId, idempotencyKey);
    }

    // All other commands load the session first
    const session = await this.ports.projectRepository.findById(ctx, command.projectId);
    if (!session) {
      throw new InvalidTransitionError("(not found)", command.type, command.projectId);
    }

    // Tenant guard
    this.assertTenantMatch(ctx, session);

    // Idempotency guard
    if (idempotencyKey && session.processedIdempotencyKeys.has(idempotencyKey)) {
      await this.ports.auditSink.record({
        commandType: command.type,
        projectId: command.projectId,
        tenantId: session.tenantId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        idempotencyKey: idempotencyKey ?? null,
        timestamp: this.ports.clock.now(),
        outcome: "idempotent",
        errorCode: null,
      });
      return { session, events: [], idempotent: true };
    }

    // Terminal guard (initializeProject and cancel are exempt)
    if (TERMINAL_PROJECT_STATUSES.has(session.status)) {
      throw new TerminalProjectError(session.status);
    }

    // Dispatch to handler
    let result: DesignCommandResult;
    try {
      result = await this.dispatch(ctx, session, command, commandId);
    } catch (err) {
      await this.ports.auditSink.record({
        commandType: command.type,
        projectId: command.projectId,
        tenantId: session.tenantId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        idempotencyKey: idempotencyKey ?? null,
        timestamp: this.ports.clock.now(),
        outcome: "error",
        errorCode: err instanceof Error ? (err as any).code ?? "UNKNOWN" : "UNKNOWN",
      });
      throw err;
    }

    // Mark idempotency key consumed
    if (idempotencyKey) {
      result.session.processedIdempotencyKeys.add(idempotencyKey);
    }

    // Publish events, then persist
    await this.ports.eventPublisher.publish(ctx, result.events);
    await this.ports.projectRepository.save(ctx, result.session);

    await this.ports.auditSink.record({
      commandType: command.type,
      projectId: command.projectId,
      tenantId: session.tenantId,
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      idempotencyKey: idempotencyKey ?? null,
      timestamp: this.ports.clock.now(),
      outcome: "success",
      errorCode: null,
    });

    return result;
  }

  // ── Command handlers ──────────────────────────────────────────────────────

  private async dispatch(
    ctx: RequestContext,
    session: DesignProjectSession,
    command: DispatchableCommand,
    commandId: string,
  ): Promise<DesignCommandResult> {
    switch (command.type) {
      case "activateStage":
        return this.handleActivateStage(ctx, session, command.stageKey, commandId);
      case "completeStage":
        return this.handleCompleteStage(ctx, session, command.stageKey, command.resultSummary, commandId);
      case "skipOptionalStage":
        return this.handleSkipOptionalStage(ctx, session, command.stageKey, command.reason, commandId);
      case "failStage":
        return this.handleFailStage(ctx, session, command.stageKey, command.reason, commandId);
      case "retryStage":
        return this.handleRetryStage(ctx, session, command.stageKey, commandId);
      case "attachArtifact":
        return this.handleAttachArtifact(ctx, session, command.stageKey, command.artifactType, commandId);
      case "requestReview":
        return this.handleRequestReview(ctx, session, command.stageKey, commandId);
      case "reopenStage":
        return this.handleReopenStage(ctx, session, command.stageKey, command.reason, commandId);
      default: {
        const _exhaustive: never = command;
        throw new Error(`Unhandled command type: ${(_exhaustive as any).type}`);
      }
    }
  }

  private async handleInitializeProject(
    ctx: RequestContext,
    command: { type: "initializeProject"; projectId: string; pluginId: string },
    commandId: string,
    idempotencyKey?: string,
  ): Promise<DesignCommandResult> {
    // Check for existing session (duplicate initialize)
    const existing = await this.ports.projectRepository.findById(ctx, command.projectId);
    if (existing) {
      // Idempotent: return existing session without error
      if (idempotencyKey && existing.processedIdempotencyKeys.has(idempotencyKey)) {
        return { session: existing, events: [], idempotent: true };
      }
      throw new DuplicateCommandError(
        idempotencyKey ?? `initializeProject:${command.projectId}`,
      );
    }

    // Resolve plugin
    const plugin = await this.ports.pluginResolver.resolve(command.pluginId);
    if (!plugin) throw new UnknownPluginError(command.pluginId);

    // Resolve workflow
    const workflow = await this.ports.workflowResolver.resolve(
      plugin.workflowId,
      plugin.workflowVersion,
    );
    if (!workflow) {
      throw new UnsupportedWorkflowVersionError(plugin.workflowId, plugin.workflowVersion);
    }

    const now = this.ports.clock.now();
    const tenantId = ctx.tenantId ?? "default";

    // Build stage records from workflow definition
    const stages: DesignStage[] = workflow.stages.map((def) =>
      this.buildStage(def),
    );

    const session: DesignProjectSession = {
      projectId: command.projectId,
      tenantId,
      pluginId: command.pluginId,
      workflowId: workflow.workflowId,
      workflowVersion: workflow.version,
      status: "initialized",
      stages,
      correlationId: ctx.correlationId,
      processedIdempotencyKeys: idempotencyKey ? new Set([idempotencyKey]) : new Set(),
      initializedAt: now,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
      failureReason: null,
    };

    const event = this.makeEvent(session, "design.project.initialized", null, null, commandId, now, {
      pluginId: command.pluginId,
      workflowId: workflow.workflowId,
      workflowVersion: workflow.version,
      stageCount: stages.length,
    });

    await this.ports.eventPublisher.publish(ctx, [event]);
    await this.ports.projectRepository.save(ctx, session);
    await this.ports.auditSink.record({
      commandType: "initializeProject",
      projectId: command.projectId,
      tenantId,
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      idempotencyKey: idempotencyKey ?? null,
      timestamp: now,
      outcome: "success",
      errorCode: null,
    });

    return { session, events: [event], idempotent: false };
  }

  private async handleActivateStage(
    ctx: RequestContext,
    session: DesignProjectSession,
    stageKey: string,
    commandId: string,
  ): Promise<DesignCommandResult> {
    const stage = this.requireStage(session, stageKey);
    assertStageCanTransition(stage, "active");
    assertDependenciesMet(session.stages, stage);

    const now = this.ports.clock.now();
    const updatedStage: DesignStage = {
      ...stage,
      status: "active",
      activatedAt: now,
      failureReason: null,
    };

    // Dispatch execution if the stage requires a capability
    if (updatedStage.requiredCapability) {
      await this.ports.executionDispatcher.dispatch(ctx, {
        projectId: session.projectId,
        tenantId: session.tenantId,
        stageKey,
        requiredCapability: updatedStage.requiredCapability,
        correlationId: session.correlationId,
        schemaRef: updatedStage.schemaRef,
        artifactType: updatedStage.artifactType,
      });
    }

    const updatedSession = this.applyStageUpdate(session, updatedStage, now);

    const event = this.makeEvent(updatedSession, "design.stage.activated", stageKey, null, commandId, now, {
      requiredCapability: updatedStage.requiredCapability ?? null,
    });

    return { session: updatedSession, events: [event], idempotent: false };
  }

  private async handleCompleteStage(
    ctx: RequestContext,
    session: DesignProjectSession,
    stageKey: string,
    resultSummary: string | undefined,
    commandId: string,
  ): Promise<DesignCommandResult> {
    const stage = this.requireStage(session, stageKey);
    assertStageCanTransition(stage, "completed");

    const now = this.ports.clock.now();
    const updatedStage: DesignStage = {
      ...stage,
      status: "completed",
      completedAt: now,
    };

    const updatedSession = this.applyStageUpdate(session, updatedStage, now);

    const event = this.makeEvent(updatedSession, "design.stage.completed", stageKey, null, commandId, now, {
      resultSummary: resultSummary ?? null,
    });

    return { session: updatedSession, events: [event], idempotent: false };
  }

  private async handleSkipOptionalStage(
    ctx: RequestContext,
    session: DesignProjectSession,
    stageKey: string,
    reason: string,
    commandId: string,
  ): Promise<DesignCommandResult> {
    const stage = this.requireStage(session, stageKey);
    assertCanSkip(stage);
    assertStageCanTransition(stage, "skipped");

    const now = this.ports.clock.now();
    const updatedStage: DesignStage = {
      ...stage,
      status: "skipped",
      skipReason: reason,
      completedAt: now,
    };

    const updatedSession = this.applyStageUpdate(session, updatedStage, now);

    const event = this.makeEvent(updatedSession, "design.stage.skipped", stageKey, null, commandId, now, {
      reason,
    });

    return { session: updatedSession, events: [event], idempotent: false };
  }

  private async handleFailStage(
    ctx: RequestContext,
    session: DesignProjectSession,
    stageKey: string,
    reason: string,
    commandId: string,
  ): Promise<DesignCommandResult> {
    const stage = this.requireStage(session, stageKey);
    assertStageCanTransition(stage, "failed");

    const now = this.ports.clock.now();
    const updatedStage: DesignStage = {
      ...stage,
      status: "failed",
      failedAt: now,
      failureReason: reason,
    };

    const updatedSession = this.applyStageUpdate(session, updatedStage, now);

    const event = this.makeEvent(updatedSession, "design.stage.failed", stageKey, null, commandId, now, {
      reason,
      retryCount: updatedStage.retryCount,
      maxRetries: updatedStage.maxRetries,
      retriesRemaining: Math.max(0, updatedStage.maxRetries - updatedStage.retryCount),
    });

    return { session: updatedSession, events: [event], idempotent: false };
  }

  private async handleRetryStage(
    ctx: RequestContext,
    session: DesignProjectSession,
    stageKey: string,
    commandId: string,
  ): Promise<DesignCommandResult> {
    const stage = this.requireStage(session, stageKey);
    assertCanRetry(stage);

    const now = this.ports.clock.now();
    const updatedStage: DesignStage = {
      ...stage,
      status: "active",
      retryCount: stage.retryCount + 1,
      activatedAt: now,
      failedAt: null,
      failureReason: null,
    };

    // Re-dispatch execution if capability required
    if (updatedStage.requiredCapability) {
      await this.ports.executionDispatcher.dispatch(ctx, {
        projectId: session.projectId,
        tenantId: session.tenantId,
        stageKey,
        requiredCapability: updatedStage.requiredCapability,
        correlationId: session.correlationId,
        schemaRef: updatedStage.schemaRef,
        artifactType: updatedStage.artifactType,
      });
    }

    const updatedSession = this.applyStageUpdate(session, updatedStage, now);

    const event = this.makeEvent(updatedSession, "design.stage.retried", stageKey, null, commandId, now, {
      retryCount: updatedStage.retryCount,
      maxRetries: updatedStage.maxRetries,
    });

    return { session: updatedSession, events: [event], idempotent: false };
  }

  private async handleAttachArtifact(
    ctx: RequestContext,
    session: DesignProjectSession,
    stageKey: string,
    artifactType: string,
    commandId: string,
  ): Promise<DesignCommandResult> {
    const stage = this.requireStage(session, stageKey);

    const isRevision = stage.status === "completed" || stage.artifacts.length > 0;
    const now = this.ports.clock.now();

    const ref = await this.ports.artifactRepository.attach(
      ctx,
      session.projectId,
      stageKey,
      artifactType,
      isRevision,
    );

    const updatedStage: DesignStage = {
      ...stage,
      artifacts: [...stage.artifacts, ref],
    };

    const updatedSession = this.applyStageUpdate(session, updatedStage, now);

    const event = this.makeEvent(updatedSession, "design.artifact.attached", stageKey, ref.artifactId, commandId, now, {
      artifactType,
      version: ref.version,
      isRevision,
    });

    return { session: updatedSession, events: [event], idempotent: false };
  }

  private async handleRequestReview(
    ctx: RequestContext,
    session: DesignProjectSession,
    stageKey: string | null,
    commandId: string,
  ): Promise<DesignCommandResult> {
    const now = this.ports.clock.now();

    const event = this.makeEvent(session, "design.review.requested", stageKey, null, commandId, now, {
      stageKey,
    });

    return { session, events: [event], idempotent: false };
  }

  private async handleReopenStage(
    ctx: RequestContext,
    session: DesignProjectSession,
    stageKey: string,
    reason: string,
    commandId: string,
  ): Promise<DesignCommandResult> {
    const stage = this.requireStage(session, stageKey);
    // Only completed stages can be reopened
    assertStageCanTransition(stage, "pending");

    const now = this.ports.clock.now();
    const updatedStage: DesignStage = {
      ...stage,
      status: "pending",
      completedAt: null,
      activatedAt: null,
    };

    const updatedSession = this.applyStageUpdate(session, updatedStage, now);

    const event = this.makeEvent(updatedSession, "design.stage.reopened", stageKey, null, commandId, now, {
      reason,
      previousArtifactCount: stage.artifacts.length,
    });

    return { session: updatedSession, events: [event], idempotent: false };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildStage(def: WorkflowStageDef): DesignStage {
    return {
      stageKey: def.stageKey,
      name: def.name,
      optional: def.optional,
      dependsOn: def.dependsOn,
      requiredCapability: def.requiredCapability,
      schemaRef: def.schemaRef,
      artifactType: def.artifactType,
      maxRetries: def.maxRetries ?? 0,
      status: "pending",
      retryCount: 0,
      artifacts: [],
      activatedAt: null,
      completedAt: null,
      failedAt: null,
      failureReason: null,
      skipReason: null,
    };
  }

  private requireStage(session: DesignProjectSession, stageKey: string): DesignStage {
    const stage = session.stages.find((s) => s.stageKey === stageKey);
    if (!stage) {
      throw new InvalidTransitionError("(unknown)", stageKey);
    }
    return stage;
  }

  private applyStageUpdate(
    session: DesignProjectSession,
    updatedStage: DesignStage,
    now: Date,
  ): DesignProjectSession {
    const stages = session.stages.map((s) =>
      s.stageKey === updatedStage.stageKey ? updatedStage : s,
    );

    const newProjectStatus = deriveProjectStatus(session.status, stages);
    const isNowCompleted = newProjectStatus === "completed" && session.status !== "completed";
    const isNowFailed = newProjectStatus === "failed" && session.status !== "failed";

    return {
      ...session,
      stages,
      status: newProjectStatus,
      startedAt: session.startedAt ?? (newProjectStatus === "active" ? now : null),
      completedAt: isNowCompleted ? now : session.completedAt,
      failedAt: isNowFailed ? now : session.failedAt,
    };
  }

  private makeEvent(
    session: DesignProjectSession,
    eventType: DesignEvent["eventType"],
    stageKey: string | null,
    artifactId: string | null,
    causationId: string,
    now: Date,
    payload: Record<string, unknown>,
  ): DesignEvent {
    return {
      eventId: this.ports.idGenerator.eventId(session.projectId, eventType, stageKey, now),
      eventType,
      projectId: session.projectId,
      tenantId: session.tenantId,
      stageKey,
      artifactId,
      correlationId: session.correlationId,
      causationId,
      occurredAt: now,
      payload,
    };
  }

  private assertTenantMatch(ctx: RequestContext, session: DesignProjectSession): void {
    if (ctx.isPlatformAdmin || ctx.isPlatformWide) return;
    const ctxTenant = ctx.tenantId ?? "default";
    if (ctxTenant !== session.tenantId) {
      throw new TenantMismatchError();
    }
  }
}
