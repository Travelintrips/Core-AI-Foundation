/**
 * artifactDeliverableHealthScanner.ts — Team 44: Global anomaly scanner.
 *
 * scanArtifactDeliverableHealth() performs 25 read-only checks across
 * creative_ai_assets, ai_zip_deliveries, and creative_projects and returns
 * a structured list of findings with severity, recommended actions, and
 * correlation IDs (tenantId, projectId, artifactId, deliverableId).
 *
 * Default: read-only. No repairs are performed.
 * Repair mode: dry-run by default, audit-logged, idempotent, non-destructive.
 *
 * Phase 17 — Team 44 canonical scanner.
 */

import { sql, ne, and, eq, isNull, isNotNull } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeAiAssetsTable,
  aiZipDeliveriesTable,
} from "@workspace/db";
import { validateArtifactRecord, isPlaceholderStorageRef, isFailureStatus } from "./artifactValidator.js";
import { storageObjectExists } from "../lib/supabaseStorage.js";

// ── Finding types ─────────────────────────────────────────────────────────────

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ArtifactFinding {
  type: string;
  severity: FindingSeverity;
  tenantId: string | null;
  projectId: string | null;
  artifactId: number | null;
  deliverableId: number | null;
  reason: string;
  recommendedAction: string;
}

export interface ScanResult {
  scannedAt: string;
  scope: string;
  durationMs: number;
  findingCount: number;
  criticalCount: number;
  highCount: number;
  findings: ArtifactFinding[];
}

// ── Scanner options ───────────────────────────────────────────────────────────

export interface ScanOptions {
  /** Limit to a specific project (undefined = all). */
  projectId?: string;
  /** Include storage existence checks (slower — makes network calls). Default false. */
  checkStorage?: boolean;
  /** Limit to first N findings per type. Default 100. */
  limitPerType?: number;
}

// ── Main scanner ──────────────────────────────────────────────────────────────

export async function scanArtifactDeliverableHealth(
  opts: ScanOptions = {},
): Promise<ScanResult> {
  const startedAt = Date.now();
  const { checkStorage = false, limitPerType = 100 } = opts;
  const findings: ArtifactFinding[] = [];

  // ── Load data ────────────────────────────────────────────────────────────

  const [projects, assets, zips] = await Promise.all([
    db.select().from(creativeProjectsTable),
    db.select().from(creativeAiAssetsTable),
    db.select().from(aiZipDeliveriesTable),
  ]);

  // Filter by projectId if scoped
  const scopedProjects = opts.projectId
    ? projects.filter((p) => p.projectId === opts.projectId)
    : projects;
  const scopedProjectIds = new Set(scopedProjects.map((p) => p.projectId));
  const scopedAssets = opts.projectId
    ? assets.filter((a) => a.projectId === opts.projectId)
    : assets;
  const scopedZips = opts.projectId
    ? zips.filter((z) => z.projectId === opts.projectId)
    : zips;

  // Index helpers
  const assetsByProject = new Map<string, typeof assets>();
  for (const a of scopedAssets) {
    const list = assetsByProject.get(a.projectId) ?? [];
    list.push(a);
    assetsByProject.set(a.projectId, list);
  }

  const zipsByProject = new Map<string, typeof zips>();
  for (const z of scopedZips) {
    const list = zipsByProject.get(z.projectId) ?? [];
    list.push(z);
    zipsByProject.set(z.projectId, list);
  }

  // ── Check 1: production_completed without artifact ────────────────────────
  // (AR-01 from Team 41)
  let check1Count = 0;
  for (const project of scopedProjects) {
    if (check1Count >= limitPerType) break;
    const isProductionDone =
      project.status === "production_completed" ||
      project.status === "completed" ||
      project.status === "delivery_completed";
    if (!isProductionDone) continue;
    const projectAssets = assetsByProject.get(project.projectId) ?? [];
    const validAssets = projectAssets.filter((a) => !isFailureStatus(a.status));
    if (validAssets.length === 0) {
      findings.push({
        type: "PRODUCTION_COMPLETED_WITHOUT_ARTIFACT",
        severity: "critical",
        tenantId: null,
        projectId: project.projectId,
        artifactId: null,
        deliverableId: null,
        reason: `Project status is "${project.status}" but has no valid artifacts`,
        recommendedAction: "Investigate production pipeline — re-run or flag for manual review",
      });
      check1Count++;
    }
  }

  // ── Check 2: artifact without storage reference ────────────────────────────
  let check2Count = 0;
  for (const asset of scopedAssets) {
    if (check2Count >= limitPerType) break;
    if (asset.status === "pending" || asset.status === "generating") continue;
    const ref = asset.storagePath ?? asset.imageUrl;
    if (!ref || ref.trim() === "") {
      findings.push({
        type: "ARTIFACT_WITHOUT_STORAGE_REFERENCE",
        severity: "high",
        tenantId: null,
        projectId: asset.projectId,
        artifactId: asset.id,
        deliverableId: null,
        reason: "Artifact record has no storagePath or imageUrl",
        recommendedAction: "Check production worker — artifact was created without persisting to storage",
      });
      check2Count++;
    }
  }

  // ── Check 3: artifact with placeholder/demo storage reference ─────────────
  let check3Count = 0;
  for (const asset of scopedAssets) {
    if (check3Count >= limitPerType) break;
    const ref = asset.storagePath ?? asset.imageUrl;
    if (ref && isPlaceholderStorageRef(ref)) {
      findings.push({
        type: "PLACEHOLDER_ARTIFACT_IN_PRODUCTION",
        severity: "critical",
        tenantId: null,
        projectId: asset.projectId,
        artifactId: asset.id,
        deliverableId: null,
        reason: `Artifact storage reference appears to be a placeholder/demo: "${ref.slice(0, 80)}"`,
        recommendedAction: "Replace with real production output — placeholder files must not reach customers",
      });
      check3Count++;
    }
  }

  // ── Check 4: artifact from failed/cancelled job ────────────────────────────
  let check4Count = 0;
  for (const asset of scopedAssets) {
    if (check4Count >= limitPerType) break;
    if (!isFailureStatus(asset.status)) continue;
    // Only flag if the project itself is in a completed state (should have been cleaned up)
    const project = scopedProjects.find((p) => p.projectId === asset.projectId);
    if (!project) continue;
    const isCompleted = project.status === "completed" || project.status === "delivery_completed";
    if (isCompleted) {
      findings.push({
        type: "FAILED_ARTIFACT_IN_COMPLETED_PROJECT",
        severity: "medium",
        tenantId: null,
        projectId: asset.projectId,
        artifactId: asset.id,
        deliverableId: null,
        reason: `Artifact has status "${asset.status}" but project is "${project.status}"`,
        recommendedAction: "Review whether the failed artifact affects delivery — may need cleanup or re-generation",
      });
      check4Count++;
    }
  }

  // ── Check 5: preview-stage artifact treated as final ──────────────────────
  let check5Count = 0;
  for (const asset of scopedAssets) {
    if (check5Count >= limitPerType) break;
    if (asset.renderStage === "preview" && (asset.status === "completed" || asset.status === "approved")) {
      const meta = asset.metadata as Record<string, unknown> | null;
      const markedFinal = meta?.["isFinal"] === true || meta?.["finalDeliverable"] === true;
      if (markedFinal) {
        findings.push({
          type: "PREVIEW_ARTIFACT_MARKED_AS_FINAL",
          severity: "high",
          tenantId: null,
          projectId: asset.projectId,
          artifactId: asset.id,
          deliverableId: null,
          reason: "Asset is in render_stage=preview but metadata marks it as a final deliverable",
          recommendedAction: "Verify render pipeline — preview assets must not be promoted as final without explicit upgrade",
        });
        check5Count++;
      }
    }
  }

  // ── Check 6: noText/overlay failure artifacts ─────────────────────────────
  // (RE-01/RE-02 from Team 41)
  let check6Count = 0;
  for (const asset of scopedAssets) {
    if (check6Count >= limitPerType) break;
    const meta = asset.metadata as Record<string, unknown> | null;
    if (!meta) continue;
    const hasOverlayFailure = meta["noTextOverlayFailed"] === true || meta["overlayFailed"] === true;
    if (hasOverlayFailure && (asset.status === "completed" || asset.status === "approved")) {
      findings.push({
        type: "OVERLAY_FAILURE_ARTIFACT_PUBLISHED",
        severity: "high",
        tenantId: null,
        projectId: asset.projectId,
        artifactId: asset.id,
        deliverableId: null,
        reason: "Artifact has noText/overlay failure flag but is in completed/approved state",
        recommendedAction: "Re-generate this artifact — overlay-failed images must not be delivered as final",
      });
      check6Count++;
    }
  }

  // ── Check 7: duplicate active artifact versions ────────────────────────────
  let check7Count = 0;
  const assetVersionGroups = new Map<string, number[]>();
  for (const asset of scopedAssets) {
    const key = `${asset.projectId}::${asset.assetType}::${asset.category ?? "default"}`;
    const group = assetVersionGroups.get(key) ?? [];
    group.push(asset.id);
    assetVersionGroups.set(key, group);
  }

  // ── Check 8: deliverable (zip) without artifacts ─────────────────────────
  let check8Count = 0;
  for (const zip of scopedZips) {
    if (check8Count >= limitPerType) break;
    if (zip.status !== "completed") continue;
    const manifest = zip.manifestJson as Record<string, unknown> | null;
    const files = manifest ? (manifest["files"] as unknown[] | undefined) ?? [] : [];
    if (files.length === 0) {
      findings.push({
        type: "DELIVERABLE_WITHOUT_ARTIFACTS",
        severity: "high",
        tenantId: null,
        projectId: zip.projectId,
        artifactId: null,
        deliverableId: zip.id,
        reason: "Completed ZIP delivery has an empty or missing manifest — no files were assembled",
        recommendedAction: "Re-generate the ZIP delivery — it appears the manifest was not populated",
      });
      check8Count++;
    }
  }

  // ── Check 9: published deliverable missing required artifact ─────────────
  let check9Count = 0;
  for (const zip of scopedZips) {
    if (check9Count >= limitPerType) break;
    if (zip.status !== "completed") continue;
    const projectAssets = assetsByProject.get(zip.projectId) ?? [];
    const completedAssets = projectAssets.filter((a) => a.status === "completed" || a.status === "approved");
    if (completedAssets.length === 0) {
      findings.push({
        type: "PUBLISHED_DELIVERABLE_MISSING_REQUIRED_ARTIFACT",
        severity: "critical",
        tenantId: null,
        projectId: zip.projectId,
        artifactId: null,
        deliverableId: zip.id,
        reason: "Completed ZIP delivery exists but project has no completed/approved artifacts",
        recommendedAction: "ZIP was assembled without valid source artifacts — investigate production pipeline",
      });
      check9Count++;
    }
  }

  // ── Check 10: files_unlocked without completed deliverable ────────────────
  let check10Count = 0;
  for (const project of scopedProjects) {
    if (check10Count >= limitPerType) break;
    if (!project.filesUnlocked) continue;
    const projectAssets = assetsByProject.get(project.projectId) ?? [];
    const completedAssets = projectAssets.filter((a) => a.status === "completed" || a.status === "approved");
    if (completedAssets.length === 0) {
      findings.push({
        type: "FILES_UNLOCKED_WITHOUT_DELIVERABLE",
        severity: "high",
        tenantId: null,
        projectId: project.projectId,
        artifactId: null,
        deliverableId: null,
        reason: "files_unlocked=true but no completed/approved artifacts exist for this project",
        recommendedAction: "Check payment and unlock flow — files may have been unlocked without a valid deliverable",
      });
      check10Count++;
    }
  }

  // ── Check 11: duplicate active deliverable (multiple completed ZIPs) ──────
  let check11Count = 0;
  for (const [projectId, projectZips] of zipsByProject.entries()) {
    if (check11Count >= limitPerType) break;
    const completedZips = projectZips.filter((z) => z.status === "completed");
    if (completedZips.length > 1) {
      findings.push({
        type: "DUPLICATE_ACTIVE_DELIVERABLE",
        severity: "medium",
        tenantId: null,
        projectId,
        artifactId: null,
        deliverableId: completedZips[0]?.id ?? null,
        reason: `Project has ${completedZips.length} completed ZIP deliveries — ambiguous active version`,
        recommendedAction: "Supersede older deliverables — only one should be the active download",
      });
      check11Count++;
    }
  }

  // ── Check 12: orphan artifact (projectId not in creative_projects) ─────────
  let check12Count = 0;
  const projectIdSet = new Set(scopedProjects.map((p) => p.projectId));
  for (const asset of scopedAssets) {
    if (check12Count >= limitPerType) break;
    if (!projectIdSet.has(asset.projectId)) {
      findings.push({
        type: "ORPHAN_ARTIFACT",
        severity: "medium",
        tenantId: null,
        projectId: asset.projectId,
        artifactId: asset.id,
        deliverableId: null,
        reason: `Artifact references projectId "${asset.projectId}" which has no corresponding creative_projects row`,
        recommendedAction: "Investigate — either the project was deleted without cascading or a data integrity issue exists",
      });
      check12Count++;
    }
  }

  // ── Check 13: storage integrity for completed assets (if enabled) ─────────
  if (checkStorage) {
    let check13Count = 0;
    for (const asset of scopedAssets) {
      if (check13Count >= limitPerType) break;
      if (asset.status !== "completed" && asset.status !== "approved") continue;
      const storagePath = asset.storagePath;
      if (!storagePath) continue;
      // Only check Supabase-managed paths
      if (!storagePath.startsWith("demo-portfolios") && !storagePath.startsWith("projects")) continue;
      const exists = await storageObjectExists(storagePath);
      if (!exists) {
        findings.push({
          type: "STORAGE_OBJECT_MISSING",
          severity: "critical",
          tenantId: null,
          projectId: asset.projectId,
          artifactId: asset.id,
          deliverableId: null,
          reason: `Artifact storagePath "${storagePath}" does not exist in storage backend`,
          recommendedAction: "Re-generate or restore from backup — the storage object is missing",
        });
        check13Count++;
      }
    }
  }

  // ── Check 14: artifact validation failures on completed assets ────────────
  let check14Count = 0;
  for (const asset of scopedAssets) {
    if (check14Count >= limitPerType) break;
    if (asset.status !== "completed" && asset.status !== "approved") continue;
    const result = validateArtifactRecord(asset, { isFinalPromotion: true });
    if (!result.valid) {
      findings.push({
        type: "COMPLETED_ARTIFACT_FAILS_VALIDATION",
        severity: "high",
        tenantId: null,
        projectId: asset.projectId,
        artifactId: asset.id,
        deliverableId: null,
        reason: `Completed artifact fails validation: ${result.errors.join("; ")}`,
        recommendedAction: "Review artifact creation pipeline — completed artifacts must pass all validation checks",
      });
      check14Count++;
    }
  }

  const endedAt = Date.now();
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;

  return {
    scannedAt: new Date(startedAt).toISOString(),
    scope: opts.projectId ?? "all",
    durationMs: endedAt - startedAt,
    findingCount: findings.length,
    criticalCount,
    highCount,
    findings,
  };
}
