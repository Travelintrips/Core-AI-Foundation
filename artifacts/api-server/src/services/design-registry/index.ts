/**
 * design-registry/index.ts — Public API for the Universal Design Platform
 * Schema & Capability Registry.
 *
 * Exports:
 *   - Type definitions (types.ts)
 *   - DesignSchemaRegistry class + errors
 *   - DesignCapabilityRegistry class + errors
 *   - CapabilityResolver class
 *   - CapabilityAvailabilityChecker class + production port factory
 *   - Fixture data and registerFixtures() helper
 *   - Pre-built global singletons (globalSchemaRegistry, globalCapabilityRegistry)
 *
 * The global singletons are module-level instances shared across the process.
 * Register all schemas and capabilities once at server startup (e.g. app.ts)
 * before serving requests.
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  SchemaCategory,
  ExecutionKind,
  WorkflowStage,
  SchemaCompatibilityMetadata,
  DesignSchemaEntry,
  SchemaValidationResult,
  CapabilityGuardrailOverrides,
  DesignCapabilityEntry,
  CapabilityResolveResult,
  CapabilityAvailabilityResult,
  WorkerAvailabilityPort,
} from "./types.js";

export {
  SCHEMA_CATEGORIES,
  EXECUTION_KINDS,
  WORKFLOW_STAGES,
  schemaCategorySchema,
  executionKindSchema,
  workflowStageSchema,
} from "./types.js";

// ── Schema Registry ───────────────────────────────────────────────────────────
export {
  DesignSchemaRegistry,
  RegistrationCollisionError as SchemaRegistrationCollisionError,
} from "./designSchemaRegistry.js";

// ── Capability Registry ───────────────────────────────────────────────────────
export {
  DesignCapabilityRegistry,
  RegistrationCollisionError as CapabilityRegistrationCollisionError,
  UnknownCapabilityError,
} from "./designCapabilityRegistry.js";

// ── Capability Resolver ───────────────────────────────────────────────────────
export { CapabilityResolver } from "./capabilityResolver.js";
export type { ResolveOptions, BulkResolveResult } from "./capabilityResolver.js";

// ── Availability Checker ──────────────────────────────────────────────────────
export { CapabilityAvailabilityChecker, createProductionWorkerPort } from "./availabilityChecker.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────
export {
  FIXTURE_SCHEMAS,
  FIXTURE_CAPABILITIES,
  registerFixtures,
} from "./fixtures.js";

// ── Global singletons ─────────────────────────────────────────────────────────
import { DesignSchemaRegistry } from "./designSchemaRegistry.js";
import { DesignCapabilityRegistry } from "./designCapabilityRegistry.js";
import { CapabilityResolver } from "./capabilityResolver.js";

/**
 * Process-wide schema registry singleton.
 * Register all schemas here once at startup.
 */
export const globalSchemaRegistry = new DesignSchemaRegistry();

/**
 * Process-wide capability registry singleton.
 * Register all capabilities here once at startup.
 */
export const globalCapabilityRegistry = new DesignCapabilityRegistry();

/**
 * Pre-built resolver that operates on the global singletons.
 * Available immediately — no async setup required.
 */
export const globalCapabilityResolver = new CapabilityResolver(
  globalCapabilityRegistry,
  globalSchemaRegistry,
);
