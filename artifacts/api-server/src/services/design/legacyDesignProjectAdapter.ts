/**
 * legacyDesignProjectAdapter.ts — Team 38: Design Migration
 *
 * Composes LegacyBriefAdapter, LegacyWorkflowAdapter, and LegacyArtifactAdapter
 * to produce a CanonicalDesignProject from a creative_projects row plus its
 * related steps and assets.
 *
 * Data loading is the caller's responsibility — this adapter is pure mapping
 * logic with no DB I/O.  The migration service and compatibility adapter
 * handle the DB queries and pass data in.
 *
 * Invariants:
 *  - legacyId (DB integer PK) and projectId (UUID) are always preserved.
 *  - tenantId is null until creative_projects gets a tenant_id column.
 *  - All sub-adapter invariants apply (IDs, timestamps, inferred/unmappable).
 */

import type {
  CreativeProject,
  CreativeProjectStep,
  CreativeAiAsset,
} from "@workspace/db";
import type { CanonicalDesignProject } from "./designMigrationTypes.js";
import { mapLegacyBrief } from "./legacyBriefAdapter.js";
import { mapLegacyWorkflow } from "./legacyWorkflowAdapter.js";
import { mapLegacyAssets } from "./legacyArtifactAdapter.js";

// ── Adapter ──────────────────────────────────────────────────────────────────

export interface LegacyProjectInput {
  project: CreativeProject;
  steps: CreativeProjectStep[];
  assets: CreativeAiAsset[];
  /** Parsed brief_json from ai_service_requests, if available. */
  briefJson: Record<string, unknown> | null;
  /** The ai_service_requests.id, if available. */
  serviceRequestId: number | null;
}

/**
 * Maps one creative_projects row (plus its related rows) to a
 * CanonicalDesignProject.  Pure function — no side-effects.
 */
export function mapLegacyDesignProject(input: LegacyProjectInput): CanonicalDesignProject {
  const { project, steps, assets, briefJson, serviceRequestId } = input;

  const inferredFields: string[] = [];
  const unmappableFields: Array<{ field: string; value: unknown; reason: string }> = [];

  // sourceType must be one of the canonical values
  const rawSourceType = project.sourceType ?? "direct";
  const sourceType =
    rawSourceType === "service_catalog" ? "service_catalog" : "direct";
  if (rawSourceType !== sourceType) {
    inferredFields.push("sourceType");
  }

  // paymentPolicy sanity — surface unknown values as unmappable
  const knownPaymentPolicies = new Set([
    "full_payment",
    "deposit",
    "subscription",
    "purchase_order",
  ]);
  if (!knownPaymentPolicies.has(project.paymentPolicy)) {
    unmappableFields.push({
      field: "paymentPolicy",
      value: project.paymentPolicy,
      reason: "Unknown paymentPolicy value",
    });
  }

  const brief = mapLegacyBrief(project, briefJson, serviceRequestId);
  const workflow = mapLegacyWorkflow(project, steps);
  const mappedAssets = mapLegacyAssets(assets);

  return {
    legacyId: project.id,
    projectId: project.projectId,
    sourceType,
    tenantId: null, // creative_projects has no tenant_id column yet
    brief,
    workflow,
    assets: mappedAssets,
    paymentStatus: project.paymentStatus ?? "pending",
    paymentPolicy: project.paymentPolicy ?? "full_payment",
    filesUnlocked: project.filesUnlocked ?? false,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deletedAt: project.deletedAt ?? null,
    inferredFields: [
      ...inferredFields,
      ...brief.inferredFields.map((f) => `brief.${f}`),
    ],
    unmappableFields: [
      ...unmappableFields,
      ...brief.unmappableFields.map((u) => ({ ...u, field: `brief.${u.field}` })),
    ],
  };
}
