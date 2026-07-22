/**
 * legacyArtifactAdapter.ts — Team 38: Design Migration
 *
 * Maps creative_ai_assets rows to CanonicalDesignAsset.
 *
 * Invariants:
 *  - legacyAssetId is always the DB integer PK — never remapped.
 *  - projectId UUID is preserved verbatim.
 *  - renderStage defaults to "legacy" for rows predating two-stage pipeline
 *    (which is the DB default — no inference needed, flagged anyway for clarity).
 *  - Unmappable status strings are captured, asset is still returned.
 *  - metadata JSONB is passed through as-is (no deep normalisation).
 */

import type { CreativeAiAsset } from "@workspace/db";
import type {
  CanonicalAssetStatus,
  CanonicalDesignAsset,
  CanonicalRenderStage,
} from "./designMigrationTypes.js";

// ── Status map ───────────────────────────────────────────────────────────────

const ASSET_STATUS_MAP: Record<string, CanonicalAssetStatus> = {
  pending: "pending",
  generating: "generating",
  completed: "completed",
  failed: "failed",
  approved: "approved",
  needs_revision: "needs_revision",
  rejected: "rejected",
};

const RENDER_STAGE_MAP: Record<string, CanonicalRenderStage> = {
  legacy: "legacy",
  preview: "preview",
  final: "final",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapAssetStatus(
  raw: string,
  assetId: number,
  unmappable: Array<{ field: string; value: unknown; reason: string }>,
): CanonicalAssetStatus {
  const mapped = ASSET_STATUS_MAP[raw];
  if (!mapped) {
    unmappable.push({
      field: "status",
      value: raw,
      reason: `Asset ${assetId}: unknown status "${raw}" — defaulted to "pending"`,
    });
    return "pending";
  }
  return mapped;
}

function mapRenderStage(
  raw: string | null,
  inferredFields: string[],
): CanonicalRenderStage {
  if (!raw) {
    inferredFields.push("renderStage");
    return "legacy";
  }
  return RENDER_STAGE_MAP[raw] ?? "legacy";
}

// ── Adapter ──────────────────────────────────────────────────────────────────

/** Maps a single creative_ai_assets row to CanonicalDesignAsset. */
export function mapLegacyAsset(asset: CreativeAiAsset): CanonicalDesignAsset {
  const inferredFields: string[] = [];
  const unmappableFields: Array<{ field: string; value: unknown; reason: string }> = [];

  const status = mapAssetStatus(asset.status, asset.id, unmappableFields);
  const renderStage = mapRenderStage(asset.renderStage, inferredFields);

  // qcScore must be 1-100 — out-of-range values are flagged
  let qcScore = asset.qcScore ?? null;
  if (qcScore !== null && (qcScore < 1 || qcScore > 100)) {
    unmappableFields.push({
      field: "qcScore",
      value: qcScore,
      reason: `QC score ${qcScore} is outside the valid range 1-100`,
    });
    qcScore = null;
    inferredFields.push("qcScore");
  }

  // cost is a numeric string from DB — kept in metadata, not surfaced on canonical type
  const metadata: Record<string, unknown> = {
    ...(asset.metadata as Record<string, unknown> | null ?? {}),
  };
  if (asset.cost !== null && asset.cost !== undefined) {
    metadata["_legacyCostUsd"] = asset.cost;
  }
  if (asset.estimatedFinalCostUsd !== null && asset.estimatedFinalCostUsd !== undefined) {
    metadata["_legacyEstimatedFinalCostUsd"] = asset.estimatedFinalCostUsd;
  }

  return {
    legacyAssetId: asset.id,
    projectId: asset.projectId,
    assetType: asset.assetType,
    status,
    renderStage,
    imageUrl: asset.imageUrl ?? null,
    storagePath: asset.storagePath ?? null,
    thumbnailUrl: asset.thumbnailUrl ?? null,
    provider: asset.provider,
    model: asset.model,
    prompt: asset.prompt,
    qcScore,
    qcNotes: asset.qcNotes ?? null,
    category: asset.category ?? null,
    version: asset.version ?? 1,
    parentAssetId: asset.parentAssetId ?? null,
    approvedBy: asset.approvedBy ?? null,
    createdAt: asset.createdAt,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
    inferredFields,
    unmappableFields,
  };
}

/** Maps an array of creative_ai_assets rows for a project. */
export function mapLegacyAssets(assets: CreativeAiAsset[]): CanonicalDesignAsset[] {
  return assets.map(mapLegacyAsset);
}
