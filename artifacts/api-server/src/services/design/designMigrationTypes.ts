/**
 * designMigrationTypes.ts — Team 38: Design Migration, Compatibility & Feature Flags
 *
 * Canonical contract types for the Universal Design Platform migration layer.
 * These types define the shape adapters produce, migration plans consume,
 * and readiness checks report — they are NOT new DB tables.
 *
 * Adapter contract invariants (enforced in each adapter implementation):
 *  - Original IDs are always preserved (legacyId / legacyProjectId).
 *  - Tenant is preserved from source row when available.
 *  - Timestamps are preserved verbatim (never synthesized).
 *  - Inferred or defaulted fields are flagged in `inferredFields[]`.
 *  - Unmappable data is captured in `unmappableFields[]` (never silently dropped).
 *  - No fabricated data — if a field cannot be derived, it stays undefined.
 */

// ── Canonical brief ──────────────────────────────────────────────────────────

/** Canonical representation of a design brief, mapped from legacy sources. */
export interface CanonicalDesignBrief {
  /** Original service request ID (null for direct/legacy projects with no SR). */
  legacyServiceRequestId: number | null;
  brandName: string;
  businessType: string;
  targetMarket: string;
  productOrService: string;
  goal: string;
  stylePreference: string | null;
  colorPreference: string | null;
  referenceLinks: string | null;
  notes: string | null;
  deadline: string | null;
  /** Extra fields from brief_json that don't map to known canonical fields. */
  extendedFields: Record<string, unknown>;
  /** Fields whose values were inferred or defaulted (not present in source). */
  inferredFields: string[];
  /** Source fields that could not be mapped to any canonical field. */
  unmappableFields: Array<{ field: string; value: unknown; reason: string }>;
}

// ── Canonical workflow ───────────────────────────────────────────────────────

export type CanonicalWorkflowStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface CanonicalWorkflowStep {
  legacyStepId: number;
  stepName: string;
  agentId: number | null;
  provider: string | null;
  model: string | null;
  status: CanonicalWorkflowStatus;
  /** Milliseconds the step took, if recorded. */
  latencyMs: number | null;
  tokenUsage: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Fields in this step that required inference or defaulting. */
  inferredFields: string[];
}

export interface CanonicalDesignWorkflow {
  legacyProjectId: number;
  status: CanonicalWorkflowStatus;
  steps: CanonicalWorkflowStep[];
  /** Project-level status string before mapping (preserved for audit). */
  rawStatus: string;
  /** Step statuses that could not be mapped. */
  unmappableStatuses: Array<{ stepId: number; rawStatus: string }>;
}

// ── Canonical asset ──────────────────────────────────────────────────────────

export type CanonicalAssetStatus =
  | "pending"
  | "generating"
  | "completed"
  | "failed"
  | "approved"
  | "needs_revision"
  | "rejected";

export type CanonicalRenderStage = "legacy" | "preview" | "final";

export interface CanonicalDesignAsset {
  legacyAssetId: number;
  projectId: string; // UUID string
  assetType: string;
  status: CanonicalAssetStatus;
  renderStage: CanonicalRenderStage;
  imageUrl: string | null;
  storagePath: string | null;
  thumbnailUrl: string | null;
  provider: string;
  model: string;
  prompt: string;
  qcScore: number | null;
  qcNotes: string | null;
  category: string | null;
  version: number;
  parentAssetId: number | null;
  approvedBy: string | null;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
  inferredFields: string[];
  unmappableFields: Array<{ field: string; value: unknown; reason: string }>;
}

// ── Canonical design project ─────────────────────────────────────────────────

export type CanonicalProjectSourceType = "direct" | "service_catalog";

export interface CanonicalDesignProject {
  /** Preserves DB integer PK for joins. */
  legacyId: number;
  /** UUID client-facing ID — capability token, always preserved. */
  projectId: string;
  sourceType: CanonicalProjectSourceType;
  tenantId: string | null; // null until tenant_id column added to creative_projects
  brief: CanonicalDesignBrief;
  workflow: CanonicalDesignWorkflow;
  assets: CanonicalDesignAsset[];
  /** Payment and commercial status, preserved verbatim. */
  paymentStatus: string;
  paymentPolicy: string;
  filesUnlocked: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Fields on the project that required inference or defaulting. */
  inferredFields: string[];
  /** Unmappable project-level fields. */
  unmappableFields: Array<{ field: string; value: unknown; reason: string }>;
}

// ── Feature flags ────────────────────────────────────────────────────────────

/** Well-known feature flag keys for the Universal Design Platform rollout. */
export const DESIGN_FLAG_KEYS = {
  UNIVERSAL_DESIGN_WORKSPACE: "design_universal_workspace",
  DYNAMIC_DESIGN_BRIEF: "design_dynamic_brief",
  DESIGN_PLUGIN_RUNTIME: "design_plugin_runtime",
  DESIGN_MATERIAL_LIBRARY: "design_material_library",
  DESIGN_COMPONENT_LIBRARY: "design_component_library",
  DESIGN_AI_ORCHESTRATION: "design_ai_orchestration",
  DESIGN_EXPORT_WORKSPACE: "design_export_workspace",
} as const;

export type DesignFlagKey = (typeof DESIGN_FLAG_KEYS)[keyof typeof DESIGN_FLAG_KEYS];

// ── Migration types ──────────────────────────────────────────────────────────

export type MigrationIssueSeverity = "error" | "warning" | "info";

export interface DesignMigrationIssue {
  projectId: string;
  field: string;
  severity: MigrationIssueSeverity;
  message: string;
  rawValue?: unknown;
}

export type MigrationStatus = "pending" | "running" | "completed" | "failed" | "rolled_back";

export interface DesignMigrationPlan {
  planId: string; // UUID, deterministic per (runId + tenantId)
  tenantId: string | null;
  totalProjects: number;
  /** Project IDs to migrate (subset when batchSize specified). */
  projectIds: string[];
  isDryRun: boolean;
  createdAt: Date;
  /** Adapter contract version this plan was generated against. */
  contractVersion: string;
}

export interface DesignMigrationResult {
  planId: string;
  status: MigrationStatus;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  issues: DesignMigrationIssue[];
  startedAt: Date;
  finishedAt: Date | null;
  /** If isDryRun=true, mapped projects are here but nothing was written. */
  dryRunProjects: CanonicalDesignProject[];
  /** Rollback metadata: original status values for each project touched. */
  rollbackSnapshot: Array<{ projectId: string; originalStatus: string }>;
  isDryRun: boolean;
  isResumed: boolean;
  /** IDs of projects that were skipped because they were already migrated. */
  alreadyMigratedIds: string[];
}

// ── Readiness check ──────────────────────────────────────────────────────────

export type ReadinessCheckStatus = "ready" | "needs_attention" | "blocked";

export interface DesignReadinessCheck {
  projectId: string;
  tenantId: string | null;
  status: ReadinessCheckStatus;
  /** Contract version the check was run against. */
  contractVersion: string;
  checkedAt: Date;
  checks: {
    hasRequiredIdentity: boolean;
    hasCompatibleStatus: boolean;
    hasValidArtifactRefs: boolean;
    hasWorkflowMapping: boolean;
    hasReviewMapping: boolean;
    hasStorageAvailability: boolean;
    hasPluginMapping: boolean;
    hasContractVersion: boolean;
  };
  /** Issues found during readiness check. */
  issues: DesignMigrationIssue[];
  /** Fields that could not be validated. */
  unresolvedFields: string[];
}

// ── Dual-read comparison ─────────────────────────────────────────────────────

export interface DualReadComparison {
  projectId: string;
  legacyValue: unknown;
  canonicalValue: unknown;
  field: string;
  match: boolean;
  divergenceReason: string | null;
}

export interface DualReadResult {
  projectId: string;
  comparisons: DualReadComparison[];
  allMatch: boolean;
  divergentFields: string[];
}
