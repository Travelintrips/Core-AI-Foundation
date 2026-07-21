/**
 * universal-design-engine — Public barrel
 *
 * This is the only import surface for consumers of the Universal Design Engine.
 * Team 24 (integration) wires concrete adapter implementations against these
 * exported interfaces. Domain logic stays isolated in the engine.
 *
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 *
 * ─── How to use ──────────────────────────────────────────────────────────────
 *
 *   import {
 *     UniversalDesignEngine,
 *     type DesignEnginePorts,
 *     type DesignCommand,
 *   } from "../../services/universal-design-engine/index.js";
 *
 *   // Wire concrete ports (DB, AI dispatcher, event bus, etc.)
 *   const ports: DesignEnginePorts = { ... };
 *   const engine = new UniversalDesignEngine(ports);
 *
 *   // Execute commands
 *   const result = await engine.execute(requestContext, command, idempotencyKey);
 *
 * ─── Ports to implement ───────────────────────────────────────────────────────
 *
 *   DesignProjectRepository     — persist/restore sessions (→ creative_projects)
 *   DesignPluginResolver        — load plugin manifests from registry
 *   DesignWorkflowResolver      — load workflow definitions from registry
 *   DesignArtifactRepository    — attach artifacts (→ creative_ai_assets)
 *   DesignEventPublisher        — fan out to canonical event bus
 *   DesignExecutionDispatcher   — enqueue AI/render jobs (→ ai_jobs)
 *   DesignClock                 — injectable time source
 *   DesignIdGenerator           — deterministic event IDs + random correlation IDs
 *   DesignAuditSink             — write audit trail entries
 *
 * ─── Stubs (Team 05 / 07 / 08) ───────────────────────────────────────────────
 *
 *   - Plugin registry (DesignPluginResolver) — Team 05 owns the domain plugin catalog
 *   - Workflow registry (DesignWorkflowResolver) — Team 07 owns workflow definitions
 *   - Execution dispatcher wiring to ai_jobs — Team 08 owns the job engine integration
 *   - Null adapters exported below are STUBS for testing only, not production adapters
 */

// ── Core engine ───────────────────────────────────────────────────────────────
export { UniversalDesignEngine } from "./UniversalDesignEngine.js";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  // Session
  DesignProjectSession,
  DesignStage,
  DesignArtifactRef,
  // Lifecycle enums
  StageStatus,
  ProjectStatus,
  // Workflow / plugin definitions
  DesignWorkflowDefinition,
  WorkflowStageDef,
  DesignPluginManifest,
  // Events
  DesignEvent,
  DesignEventType,
  // Result
  DesignCommandResult,
} from "./types.js";

export {
  STAGE_STATUSES,
  PROJECT_STATUSES,
  DESIGN_EVENT_TYPES,
  TERMINAL_STAGE_STATUSES,
  TERMINAL_PROJECT_STATUSES,
} from "./types.js";

// ── Commands ──────────────────────────────────────────────────────────────────
export type {
  DesignCommand,
  DesignCommandType,
  InitializeProjectCommand,
  ActivateStageCommand,
  CompleteStageCommand,
  SkipOptionalStageCommand,
  FailStageCommand,
  RetryStageCommand,
  AttachArtifactCommand,
  RequestReviewCommand,
  ReopenStageCommand,
} from "./commands.js";

// ── Ports ─────────────────────────────────────────────────────────────────────
export type {
  DesignEnginePorts,
  DesignProjectRepository,
  DesignPluginResolver,
  DesignWorkflowResolver,
  DesignArtifactRepository,
  DesignEventPublisher,
  DesignExecutionDispatcher,
  DesignDispatchInput,
  DesignClock,
  DesignIdGenerator,
  DesignAuditSink,
  DesignAuditEntry,
} from "./ports.js";

// ── Errors ────────────────────────────────────────────────────────────────────
export {
  DesignEngineError,
  InvalidTransitionError,
  TerminalProjectError,
  DependencyNotMetError,
  MandatoryStageSkipError,
  UnknownPluginError,
  UnsupportedWorkflowVersionError,
  TenantMismatchError,
  DuplicateCommandError,
} from "./errors.js";

// ── Null adapters (for testing / local dev — NOT production adapters) ─────────
export { NullDesignProjectRepository } from "./adapters/nullDesignProjectRepository.js";
export { NullDesignPluginResolver }    from "./adapters/nullDesignPluginResolver.js";
export { NullDesignWorkflowResolver }  from "./adapters/nullDesignWorkflowResolver.js";
export { NullDesignArtifactRepository } from "./adapters/nullDesignArtifactRepository.js";
export { NullDesignEventPublisher }    from "./adapters/nullDesignEventPublisher.js";
export { NullDesignExecutionDispatcher } from "./adapters/nullDesignExecutionDispatcher.js";
export { NullDesignClock }             from "./adapters/nullDesignClock.js";
export { NullDesignIdGenerator }       from "./adapters/nullDesignIdGenerator.js";
export { NullDesignAuditSink }         from "./adapters/nullDesignAuditSink.js";
