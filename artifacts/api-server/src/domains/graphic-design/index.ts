/**
 * graphic-design/index.ts — Team 15
 *
 * Barrel export for the Graphic Design domain adapter.
 *
 * Import from here instead of individual files.
 * The domain is an ADAPTER — it does not contain a rendering engine.
 * All execution goes through CanonicalJobAdapter → designStudioService.
 */

// Schema + types
export * from "./schema.js";
export * from "./blueprints.js";
export * from "./components.js";
export * from "./manifest.js";
export * from "./packagePolicy.js";

// Sanitization utilities (also used by tests)
export * from "./sanitize.js";

// QC engine
export * from "./qc.js";

// Port interfaces (documentation of the adapter boundary)
export * from "./ports.js";

// Service functions (adapter logic, not an engine)
export {
  // Canonical adapter interface + factory
  makeDefaultAdapter,
  type CanonicalJobAdapter,
  // Brief state management
  createBrief,
  listBriefs,
  getBrief,
  updateBriefStatus,
  // Execution (via CanonicalJobAdapter only)
  approveBriefAndDispatch,
  // QC
  runBriefQc,
  // Getters
  getBriefManifest,
  getBriefQcResult,
  // Job list (paginated)
  listBriefJobs,
  // Types
  type CreateBriefResult,
  type ListBriefsResult,
  type ListBriefsOptions,
  type BriefSummary,
  type UpdateStatusResult,
  type QcRunResult,
  type ListBriefJobsResult,
} from "./service.js";

// Router (config-only — NOT mounted; see integration/manifests/team-15.json)
export { default as graphicDesignRouter } from "./routes.js";
