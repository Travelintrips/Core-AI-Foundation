/**
 * designCompatibilityAdapter.ts — Team 38: Design Migration
 *
 * Top-level orchestrator for the Universal Design Platform compatibility layer.
 *
 * Provides:
 *  1. Legacy read  — fetch creative_project + related rows from DB.
 *  2. Adapter read — map through all sub-adapters to CanonicalDesignProject.
 *  3. Dual-read comparison — compare a legacy field snapshot against the
 *     canonical view for a single project (optional, feature-flagged by caller).
 *  4. Feature-flagged canonical view — returns legacy data or canonical data
 *     depending on UNIVERSAL_DESIGN_WORKSPACE flag.
 *  5. Readiness check — per-project readiness assessment.
 *
 * DB rules:
 *  - Uses the shared `db` client (no direct pool queries).
 *  - creative_projects has no tenant_id column — scoped by projectId UUID.
 *  - Never writes; all operations are read-only.
 *
 * The migration service (designMigrationService.ts) handles write operations
 * (migration auditing, dry-run snapshots).
 */

import { eq } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeProjectStepsTable,
  creativeAiAssetsTable,
  aiServiceRequestsTable,
} from "@workspace/db";
import type { CreativeProject, CreativeProjectStep, CreativeAiAsset } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { mapLegacyDesignProject } from "./legacyDesignProjectAdapter.js";
import { isDesignWorkspaceEnabled } from "./designFeatureFlag.js";
import type {
  CanonicalDesignProject,
  DesignReadinessCheck,
  DualReadResult,
  DualReadComparison,
  ReadinessCheckStatus,
} from "./designMigrationTypes.js";

// ── Contract version ─────────────────────────────────────────────────────────
// Bump when CanonicalDesignProject shape changes in a breaking way.
export const DESIGN_CONTRACT_VERSION = "1.0.0";

// ── Data loader (pure DB reads) ──────────────────────────────────────────────

export interface LegacyProjectData {
  project: CreativeProject;
  steps: CreativeProjectStep[];
  assets: CreativeAiAsset[];
  briefJson: Record<string, unknown> | null;
  serviceRequestId: number | null;
}

/**
 * Loads all data required to map a creative project.
 * Returns null if the project does not exist or is soft-deleted.
 */
export async function loadLegacyProjectData(
  projectId: string,
): Promise<LegacyProjectData | null> {
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectId))
    .limit(1);

  if (!project || project.deletedAt !== null) return null;

  const [steps, assets] = await Promise.all([
    db
      .select()
      .from(creativeProjectStepsTable)
      .where(eq(creativeProjectStepsTable.projectId, project.id)),
    db
      .select()
      .from(creativeAiAssetsTable)
      .where(eq(creativeAiAssetsTable.projectId, projectId)),
  ]);

  // Load brief_json from service request if available
  let briefJson: Record<string, unknown> | null = null;
  let serviceRequestId: number | null = null;

  if (project.sourceType === "service_catalog" && project.serviceRequestId) {
    const [sr] = await db
      .select({ id: aiServiceRequestsTable.id, briefJson: aiServiceRequestsTable.briefJson })
      .from(aiServiceRequestsTable)
      .where(eq(aiServiceRequestsTable.id, project.serviceRequestId))
      .limit(1);

    if (sr) {
      serviceRequestId = sr.id;
      briefJson = (sr.briefJson as Record<string, unknown> | null) ?? null;
    }
  }

  return { project, steps, assets, briefJson, serviceRequestId };
}

// ── Canonical view ───────────────────────────────────────────────────────────

/**
 * Returns the canonical representation of a creative project.
 * Does NOT check feature flags — the caller decides when to use this.
 */
export async function getCanonicalProject(
  projectId: string,
): Promise<CanonicalDesignProject | null> {
  const data = await loadLegacyProjectData(projectId);
  if (!data) return null;
  return mapLegacyDesignProject(data);
}

/**
 * Feature-flagged view: returns canonical if UNIVERSAL_DESIGN_WORKSPACE is on,
 * otherwise returns null (caller should fall back to legacy read).
 *
 * This is the safe cutover boundary — both sides are reads; nothing is written.
 */
export async function getFeatureFlaggedProject(
  projectId: string,
  opts: { sessionId?: string } = {},
): Promise<{ canonical: true; project: CanonicalDesignProject } | { canonical: false; projectId: string }> {
  const flagOn = await isDesignWorkspaceEnabled(opts);

  if (!flagOn) {
    return { canonical: false, projectId };
  }

  const project = await getCanonicalProject(projectId);
  if (!project) {
    logger.warn({ projectId }, "[design-compat] project not found in canonical view");
    return { canonical: false, projectId };
  }

  return { canonical: true, project };
}

// ── Dual-read comparison ─────────────────────────────────────────────────────

/**
 * Compares key legacy fields against the canonical representation for
 * divergence detection.  Used during controlled cutover to validate the
 * adapter produces the expected output before switching.
 *
 * Only compares a defined set of scalar fields — deep JSONB parity is out
 * of scope for this comparison (too noisy; use full migration dry-run instead).
 */
export async function dualReadCompare(
  projectId: string,
): Promise<DualReadResult | null> {
  const data = await loadLegacyProjectData(projectId);
  if (!data) return null;

  const canonical = mapLegacyDesignProject(data);
  const { project } = data;

  const comparisons: DualReadComparison[] = [
    compareField(projectId, "projectId", project.projectId, canonical.projectId),
    compareField(projectId, "sourceType", project.sourceType, canonical.sourceType),
    compareField(projectId, "status", project.status, canonical.workflow.rawStatus),
    compareField(projectId, "brandName", project.brandName, canonical.brief.brandName),
    compareField(projectId, "businessType", project.businessType, canonical.brief.businessType),
    compareField(projectId, "goal", project.goal, canonical.brief.goal),
    compareField(projectId, "paymentStatus", project.paymentStatus, canonical.paymentStatus),
    compareField(projectId, "filesUnlocked", project.filesUnlocked, canonical.filesUnlocked),
    compareField(projectId, "createdAt", project.createdAt.toISOString(), canonical.createdAt.toISOString()),
  ];

  const divergent = comparisons.filter((c) => !c.match).map((c) => c.field);

  return {
    projectId,
    comparisons,
    allMatch: divergent.length === 0,
    divergentFields: divergent,
  };
}

function compareField(projectId: string, field: string, legacy: unknown, canonical: unknown): DualReadComparison {
  const match = legacy === canonical;
  return {
    projectId,
    field,
    legacyValue: legacy,
    canonicalValue: canonical,
    match,
    divergenceReason: match
      ? null
      : `Legacy "${String(legacy)}" ≠ canonical "${String(canonical)}"`,
  };
}

// ── Readiness check ──────────────────────────────────────────────────────────

/**
 * Evaluates whether a project is ready for migration to the Universal Design
 * Platform.  Returns a DesignReadinessCheck with per-check results and a
 * summary status.
 *
 * Readiness criteria:
 *  - required identity: projectId + brandName + goal are non-empty
 *  - compatible status: status maps to a known canonical workflow status
 *  - valid artifact refs: assets with imageUrl or storagePath exist (or project has none — ok)
 *  - workflow mapping: all step statuses are in the known map
 *  - review mapping: (deferred — creative_ai_client_reviews check, always true for now)
 *  - storage availability: at least one asset has a storagePath (or no assets — ok)
 *  - plugin mapping: (deferred — always true until plugin registry is built)
 *  - contract version: always the current DESIGN_CONTRACT_VERSION
 */
export async function checkProjectReadiness(
  projectId: string,
): Promise<DesignReadinessCheck> {
  const checkedAt = new Date();
  const issues: import("./designMigrationTypes.js").DesignMigrationIssue[] = [];
  const unresolvedFields: string[] = [];

  const data = await loadLegacyProjectData(projectId);

  if (!data) {
    return {
      projectId,
      tenantId: null,
      status: "blocked",
      contractVersion: DESIGN_CONTRACT_VERSION,
      checkedAt,
      checks: {
        hasRequiredIdentity: false,
        hasCompatibleStatus: false,
        hasValidArtifactRefs: false,
        hasWorkflowMapping: false,
        hasReviewMapping: false,
        hasStorageAvailability: false,
        hasPluginMapping: false,
        hasContractVersion: true,
      },
      issues: [
        {
          projectId,
          field: "projectId",
          severity: "error",
          message: "Project not found or is soft-deleted",
        },
      ],
      unresolvedFields: ["projectId"],
    };
  }

  const canonical = mapLegacyDesignProject(data);
  const { project, steps, assets } = data;

  // 1. Required identity
  const hasId = !!project.projectId && !!project.brandName && !!project.goal;
  if (!hasId) {
    issues.push({
      projectId,
      field: "identity",
      severity: "error",
      message: "Missing required identity fields (projectId, brandName, or goal)",
    });
  }

  // 2. Compatible status
  const { isProjectStatusMappable } = await import("./legacyWorkflowAdapter.js");
  const hasCompatibleStatus = isProjectStatusMappable(project.status);
  if (!hasCompatibleStatus) {
    issues.push({
      projectId,
      field: "status",
      severity: "warning",
      message: `Status "${project.status}" has no canonical mapping — will default to "pending"`,
      rawValue: project.status,
    });
  }

  // 3. Valid artifact refs (assets with broken refs)
  const brokenRefs = assets.filter(
    (a) => a.status === "completed" && !a.imageUrl && !a.storagePath,
  );
  const hasValidArtifactRefs = brokenRefs.length === 0;
  for (const a of brokenRefs) {
    issues.push({
      projectId,
      field: `asset.${a.id}.imageUrl`,
      severity: "warning",
      message: `Asset ${a.id} is completed but has no imageUrl or storagePath`,
    });
  }

  // 4. Workflow mapping (step statuses)
  const unmappableSteps = canonical.workflow.unmappableStatuses;
  const hasWorkflowMapping = unmappableSteps.length === 0;
  for (const s of unmappableSteps) {
    issues.push({
      projectId,
      field: `step.${s.stepId}.status`,
      severity: "warning",
      message: `Step ${s.stepId} has unmappable status "${s.rawStatus}"`,
      rawValue: s.rawStatus,
    });
  }

  // 5. Review mapping — deferred; always pass
  const hasReviewMapping = true;

  // 6. Storage availability
  const hasAnyStorage =
    assets.length === 0 || assets.some((a) => !!a.storagePath || !!a.imageUrl);
  if (!hasAnyStorage) {
    unresolvedFields.push("storage");
    issues.push({
      projectId,
      field: "storage",
      severity: "info",
      message: "No assets have a storagePath or imageUrl — storage may not be provisioned",
    });
  }

  // 7. Plugin mapping — deferred; always pass
  const hasPluginMapping = true;

  // ── Summary status ─────────────────────────────────────────────────────
  const hasErrors = issues.some((i) => i.severity === "error");
  const hasWarnings = issues.some((i) => i.severity === "warning");
  const status: ReadinessCheckStatus = hasErrors
    ? "blocked"
    : hasWarnings
      ? "needs_attention"
      : "ready";

  return {
    projectId,
    tenantId: null,
    status,
    contractVersion: DESIGN_CONTRACT_VERSION,
    checkedAt,
    checks: {
      hasRequiredIdentity: hasId,
      hasCompatibleStatus,
      hasValidArtifactRefs,
      hasWorkflowMapping,
      hasReviewMapping,
      hasStorageAvailability: hasAnyStorage,
      hasPluginMapping,
      hasContractVersion: true,
    },
    issues,
    unresolvedFields,
  };
}
