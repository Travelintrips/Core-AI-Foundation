/**
 * deliveryCompletionGuard.ts — Team 44: Delivery completion eligibility guards.
 *
 * Defines the canonical three-tier readiness contract for artifact delivery:
 *
 *   deliverable_ready  — artifacts valid + storage verified + deliverable published
 *   files_unlocked     — deliverable_ready + canonical access policy satisfied
 *   delivery_completed — required deliverable available + delivery event recorded
 *
 * These guards sit on the Team 44 boundary (Phase 16).
 * - commercial_completed is NOT determined here (Team 41/42 contract).
 * - Payment calculation is NOT performed here (Team 42).
 *
 * All functions are read-only. They return structured results; callers decide
 * whether to throw or surface to the user.
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeAiAssetsTable,
  aiZipDeliveriesTable,
} from "@workspace/db";
import { storageObjectExists } from "../lib/supabaseStorage.js";
import { validateArtifactRecord, isFailureStatus } from "./artifactValidator.js";

// ── Result types ──────────────────────────────────────────────────────────────

export interface GuardResult {
  eligible: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

// ── deliverable_ready ─────────────────────────────────────────────────────────

/**
 * A project's deliverables are "ready" when:
 *  1. At least one completed asset exists for the project.
 *  2. Each completed asset passes artifact validation.
 *  3. At least one asset's storage object actually exists in the storage backend.
 *  4. No required asset has a blocking failure status.
 *
 * This does NOT check payment. Payment eligibility belongs to Team 42.
 */
export async function checkDeliverableReady(projectId: string): Promise<GuardResult> {
  // Load all assets for this project
  const assets = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.projectId, projectId));

  if (assets.length === 0) {
    return {
      eligible: false,
      reason: "No artifacts exist for this project — production may not have completed",
      details: { projectId, assetCount: 0 },
    };
  }

  const completedAssets = assets.filter((a) => a.status === "completed" || a.status === "approved");

  if (completedAssets.length === 0) {
    const statuses = [...new Set(assets.map((a) => a.status))];
    const hasFailure = assets.some((a) => isFailureStatus(a.status));
    return {
      eligible: false,
      reason: hasFailure
        ? "All artifacts are in failure states — production did not complete successfully"
        : "No artifacts are in completed/approved state",
      details: { projectId, totalAssets: assets.length, statuses },
    };
  }

  // Validate each completed asset
  const validationErrors: string[] = [];
  for (const asset of completedAssets) {
    const result = validateArtifactRecord(asset, { isFinalPromotion: true });
    if (!result.valid) {
      validationErrors.push(`Asset ${asset.id}: ${result.errors.join("; ")}`);
    }
  }

  if (validationErrors.length > 0) {
    return {
      eligible: false,
      reason: "One or more completed artifacts failed validation",
      details: { projectId, validationErrors },
    };
  }

  // Check storage existence for at least one asset
  let storageVerified = false;
  for (const asset of completedAssets) {
    const ref = asset.storagePath ?? asset.imageUrl;
    if (!ref) continue;
    // Only verify Supabase storage paths (not external HTTP URLs which we can't HEAD cheaply)
    if (ref.startsWith("http") && !ref.includes("supabase")) {
      storageVerified = true; // external CDN — trust the URL
      break;
    }
    const path = asset.storagePath;
    if (!path) continue;
    const exists = await storageObjectExists(path);
    if (exists) {
      storageVerified = true;
      break;
    }
  }

  if (!storageVerified) {
    return {
      eligible: false,
      reason: "No completed artifact has a verified storage object — files may not have been persisted",
      details: { projectId, completedAssetCount: completedAssets.length },
    };
  }

  return {
    eligible: true,
    reason: "Deliverable is ready — all required artifacts validated and storage verified",
    details: { projectId, completedAssetCount: completedAssets.length },
  };
}

// ── files_unlocked ────────────────────────────────────────────────────────────

/**
 * Files are "unlocked" when:
 *  1. deliverable_ready passes.
 *  2. The project's files_unlocked flag is true (set by payment verification or admin override).
 *
 * Team 44 reads the canonical unlock flag; it does NOT compute payment conditions.
 */
export async function checkFilesUnlocked(projectId: string): Promise<GuardResult> {
  // First, deliverable must be ready
  const readyResult = await checkDeliverableReady(projectId);
  if (!readyResult.eligible) {
    return {
      eligible: false,
      reason: `Files cannot be unlocked: deliverable not ready — ${readyResult.reason}`,
      details: readyResult.details,
    };
  }

  // Load project for canonical unlock flag
  const [project] = await db
    .select({
      id: creativeProjectsTable.id,
      projectId: creativeProjectsTable.projectId,
      filesUnlocked: creativeProjectsTable.filesUnlocked,
      status: creativeProjectsTable.status,
    })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectId))
    .limit(1);

  if (!project) {
    return {
      eligible: false,
      reason: "Project not found",
      details: { projectId },
    };
  }

  if (!project.filesUnlocked) {
    return {
      eligible: false,
      reason: "Files are not unlocked — payment or admin approval required",
      details: { projectId, projectStatus: project.status, filesUnlocked: false },
    };
  }

  return {
    eligible: true,
    reason: "Files are unlocked — deliverable ready and access policy satisfied",
    details: { projectId, filesUnlocked: true },
  };
}

// ── delivery_completed ────────────────────────────────────────────────────────

/**
 * Delivery is "completed" when:
 *  1. files_unlocked passes.
 *  2. At least one ZIP delivery record exists in "completed" state.
 *  3. The ZIP delivery has a non-null storage path (actual file present).
 *
 * This does NOT imply commercial_completed (Team 41/42 contract).
 */
export async function checkDeliveryCompleted(projectId: string): Promise<GuardResult> {
  // files_unlocked is a prerequisite
  const unlockedResult = await checkFilesUnlocked(projectId);
  if (!unlockedResult.eligible) {
    return {
      eligible: false,
      reason: `Delivery cannot be completed: ${unlockedResult.reason}`,
      details: unlockedResult.details,
    };
  }

  // Check ZIP delivery
  const zips = await db
    .select()
    .from(aiZipDeliveriesTable)
    .where(eq(aiZipDeliveriesTable.projectId, projectId));

  const completedZip = zips.find((z) => z.status === "completed" && z.storagePath);

  if (!completedZip) {
    const hasAnyZip = zips.length > 0;
    return {
      eligible: false,
      reason: hasAnyZip
        ? "ZIP delivery exists but is not yet completed or missing storage path"
        : "No ZIP delivery record found — delivery package has not been generated",
      details: {
        projectId,
        zipCount: zips.length,
        statuses: zips.map((z) => z.status),
      },
    };
  }

  return {
    eligible: true,
    reason: "Delivery is completed — package assembled and available",
    details: {
      projectId,
      zipDeliveryId: completedZip.id,
      fileSizeBytes: completedZip.fileSizeBytes,
    },
  };
}

// ── Production completion guard ───────────────────────────────────────────────

/**
 * Guard to call before marking a project as "production_completed".
 * Ensures the project has at least one valid, non-placeholder artifact
 * before the status transition is allowed.
 *
 * Addresses Team 41 finding AR-01.
 */
export async function assertProductionCompletedEligible(projectId: string): Promise<GuardResult> {
  const assets = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, projectId),
      ),
    );

  const viableAssets = assets.filter((a) => {
    if (isFailureStatus(a.status)) return false;
    const validation = validateArtifactRecord(a);
    return validation.valid;
  });

  if (viableAssets.length === 0) {
    return {
      eligible: false,
      reason: "Cannot mark production_completed — no valid artifact found for this project",
      details: {
        projectId,
        totalAssets: assets.length,
        failedValidation: assets.length - viableAssets.length,
      },
    };
  }

  return {
    eligible: true,
    reason: `Production completion eligible — ${viableAssets.length} valid artifact(s) found`,
    details: { projectId, viableAssetCount: viableAssets.length },
  };
}
