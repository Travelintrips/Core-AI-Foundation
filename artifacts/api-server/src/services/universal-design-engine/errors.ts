/**
 * errors.ts — Typed errors for UniversalDesignEngine
 *
 * All errors are typed so callers can discriminate without inspecting strings.
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */

// ─── Base ─────────────────────────────────────────────────────────────────────

export abstract class DesignEngineError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export class InvalidTransitionError extends DesignEngineError {
  readonly code = "INVALID_TRANSITION" as const;
  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly stageKey?: string,
  ) {
    super(
      stageKey
        ? `Cannot transition stage "${stageKey}" from "${from}" to "${to}".`
        : `Cannot transition project from "${from}" to "${to}".`,
    );
  }
}

export class TerminalProjectError extends DesignEngineError {
  readonly code = "TERMINAL_PROJECT" as const;
  constructor(public readonly status: string) {
    super(`Project is in terminal state "${status}" and cannot accept commands.`);
  }
}

export class DependencyNotMetError extends DesignEngineError {
  readonly code = "DEPENDENCY_NOT_MET" as const;
  constructor(
    public readonly stageKey: string,
    public readonly unmetDeps: string[],
  ) {
    super(
      `Stage "${stageKey}" cannot activate: unmet dependencies [${unmetDeps.join(", ")}].`,
    );
  }
}

export class MandatoryStageSkipError extends DesignEngineError {
  readonly code = "MANDATORY_STAGE_SKIP" as const;
  constructor(public readonly stageKey: string) {
    super(`Stage "${stageKey}" is mandatory and cannot be skipped.`);
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export class UnknownPluginError extends DesignEngineError {
  readonly code = "UNKNOWN_PLUGIN" as const;
  constructor(public readonly pluginId: string) {
    super(`Plugin "${pluginId}" is not registered.`);
  }
}

export class UnsupportedWorkflowVersionError extends DesignEngineError {
  readonly code = "UNSUPPORTED_WORKFLOW_VERSION" as const;
  constructor(
    public readonly workflowId: string,
    public readonly version: string,
  ) {
    super(`Workflow "${workflowId}" version "${version}" is not supported.`);
  }
}

// ─── Security ─────────────────────────────────────────────────────────────────

export class TenantMismatchError extends DesignEngineError {
  readonly code = "TENANT_MISMATCH" as const;
  constructor() {
    super("Tenant ID in context does not match the project tenant.");
  }
}

// ─── Idempotency ──────────────────────────────────────────────────────────────

export class DuplicateCommandError extends DesignEngineError {
  readonly code = "DUPLICATE_COMMAND" as const;
  constructor(public readonly idempotencyKey: string) {
    super(`Command with idempotency key "${idempotencyKey}" was already processed.`);
  }
}
