/**
 * branding-identity/index.ts — Team 27
 *
 * Barrel export for the Branding & Identity domain plugin.
 *
 * Import from here instead of individual files.
 * The domain is an ADAPTER — it does not contain a rendering engine.
 * AI execution goes through BrandingAgentAdapter → existing discovery agents.
 */

// Schema + types
export * from "./schema.js";

// Workflow state machine
export {
  createWorkflowState,
  advanceStage,
  nextStage,
  stageIndex,
  isTransitionAllowed,
  getWorkflowProgress,
  type WorkflowState,
  type StageTransition,
  type WorkflowProgress,
  type AdvanceResult,
  type AdvanceError,
} from "./workflow.js";

// Manifest
export {
  buildBrandingManifest,
  getStageArtifacts,
  getMissingRequiredArtifacts,
  canExport,
  type ManifestEntry,
  type BrandingManifest,
} from "./manifest.js";

// Agent adapter (Team 39 integration point)
export {
  defaultBrandingAgentAdapter,
  makeMockBrandingAgentAdapter,
  type BrandingAgentAdapter,
} from "./agentAdapter.js";

// Service functions
export {
  createBrief,
  getBrief,
  listBriefs,
  advanceBriefStage,
  getBriefWorkflow,
  registerArtifact,
  listArtifacts,
  exportGuideline,
  runCreativeBriefExtraction,
  runBrandStrategyForBrief,
  _resetStore,
  type StoredBrief,
  type RegisteredArtifact,
  type CreateBriefResult,
  type ListBriefsResult,
  type BriefSummary,
  type AdvanceStageResult,
  type GuidelineExport,
  type ListOptions,
} from "./service.js";

// Router (default export — mounted in routes/index.ts)
export { default as brandingIdentityRouter } from "./routes.js";
