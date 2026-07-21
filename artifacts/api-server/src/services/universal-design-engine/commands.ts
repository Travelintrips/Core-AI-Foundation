/**
 * commands.ts — Typed command union for UniversalDesignEngine
 *
 * Every command is a plain data object discriminated on `type`.
 * The engine handler switches on `type` — no string comparisons elsewhere.
 *
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */

// ─── Command types ─────────────────────────────────────────────────────────────

/**
 * Open a design project session.
 * Loads the plugin manifest and workflow definition, creates stage records.
 */
export interface InitializeProjectCommand {
  type: "initializeProject";
  projectId: string;
  pluginId: string;
}

/**
 * Start a stage. Verifies dependencies are met.
 * If the stage has a requiredCapability, dispatches execution via the port.
 */
export interface ActivateStageCommand {
  type: "activateStage";
  projectId: string;
  stageKey: string;
}

/**
 * Mark a stage as successfully completed.
 * Triggers derivation of project status.
 */
export interface CompleteStageCommand {
  type: "completeStage";
  projectId: string;
  stageKey: string;
  /** Optional result summary — customer-safe only */
  resultSummary?: string;
}

/**
 * Skip an optional stage with an explicit reason.
 * Throws MandatoryStageSkipError for non-optional stages.
 */
export interface SkipOptionalStageCommand {
  type: "skipOptionalStage";
  projectId: string;
  stageKey: string;
  reason: string;
}

/**
 * Mark a stage as failed with a reason.
 */
export interface FailStageCommand {
  type: "failStage";
  projectId: string;
  stageKey: string;
  /** Customer-safe reason only — no stack traces or internal errors */
  reason: string;
}

/**
 * Retry a failed stage. Must be within maxRetries policy.
 */
export interface RetryStageCommand {
  type: "retryStage";
  projectId: string;
  stageKey: string;
}

/**
 * Attach an artifact to a stage.
 * If the stage is already completed, creates a new artifact version.
 */
export interface AttachArtifactCommand {
  type: "attachArtifact";
  projectId: string;
  stageKey: string;
  artifactType: string;
}

/**
 * Request a client review of the current project state.
 */
export interface RequestReviewCommand {
  type: "requestReview";
  projectId: string;
  /** Optional specific stage to review — null means whole project */
  stageKey: string | null;
}

/**
 * Reopen a completed stage for revision.
 * Any previously attached approved artifacts are versioned up.
 */
export interface ReopenStageCommand {
  type: "reopenStage";
  projectId: string;
  stageKey: string;
  reason: string;
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type DesignCommand =
  | InitializeProjectCommand
  | ActivateStageCommand
  | CompleteStageCommand
  | SkipOptionalStageCommand
  | FailStageCommand
  | RetryStageCommand
  | AttachArtifactCommand
  | RequestReviewCommand
  | ReopenStageCommand;

export type DesignCommandType = DesignCommand["type"];
