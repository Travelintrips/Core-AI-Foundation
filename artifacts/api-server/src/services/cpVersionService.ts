/**
 * cpVersionService.ts — Company Profile V4.2C
 *
 * Version management for Company Profile documents.
 *
 * Responsibilities:
 *   - Snapshot a "document version" row whenever admin sends a revised document
 *   - Compute the next version number for a project
 *   - Section-level diff between two versions (no word-by-word diff, sections only)
 */

import { eq, desc, and } from "drizzle-orm";
import {
  db,
  cpDocumentVersionsTable,
  creativeAiAssetsTable,
  type CpDocumentVersion,
} from "@workspace/db";
import { scoreFromAssetMetadata } from "./companyProfileQcService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VersionSectionDiff {
  added:     string[];  // sections in v2 not in v1
  removed:   string[];  // sections in v1 not in v2
  unchanged: string[];  // sections in both
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSectionSet(version: CpDocumentVersion): Set<string> {
  const raw = version.sectionsJson;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((s): s is string => typeof s === "string"));
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Return the next version number for a project (max existing + 1, or 1).
 */
export async function getNextVersionNumber(projectId: string): Promise<number> {
  const [latest] = await db
    .select({ version: cpDocumentVersionsTable.version })
    .from(cpDocumentVersionsTable)
    .where(eq(cpDocumentVersionsTable.projectId, projectId))
    .orderBy(desc(cpDocumentVersionsTable.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

/**
 * Create a new document version snapshot.
 * Loads QC data from the asset's metadata automatically.
 */
export async function snapshotDocumentVersion(opts: {
  projectId:      string;
  reviewId?:      number;
  assetId?:       number;
  reason?:        string;
  revisionNotes?: string;
  createdBy?:     string;
}): Promise<CpDocumentVersion> {
  const { projectId, reviewId, assetId, reason, revisionNotes, createdBy } = opts;

  const version = await getNextVersionNumber(projectId);
  const versionLabel = `v${version}`;

  // Load QC from asset metadata
  let qcScore: number | null = null;
  let qcPassed: boolean | null = null;
  let qcDimensions: Record<string, unknown> | null = null;
  let sectionsJson: string[] | null = null;

  if (assetId) {
    const [asset] = await db
      .select({ metadata: creativeAiAssetsTable.metadata })
      .from(creativeAiAssetsTable)
      .where(eq(creativeAiAssetsTable.id, assetId))
      .limit(1);

    if (asset?.metadata) {
      const meta = asset.metadata as Record<string, unknown>;
      const qc = scoreFromAssetMetadata(meta);
      if (qc) {
        qcScore      = qc.qcScore;
        qcPassed     = qc.passed;
        qcDimensions = qc.dimensions as unknown as Record<string, unknown>;
      }
      const report = meta["generationReport"] as Record<string, unknown> | undefined;
      if (report && Array.isArray(report["sectionsIncluded"])) {
        sectionsJson = report["sectionsIncluded"] as string[];
      }
    }
  }

  const [row] = await db
    .insert(cpDocumentVersionsTable)
    .values({
      projectId,
      reviewId:     reviewId ?? null,
      assetId:      assetId  ?? null,
      version,
      versionLabel,
      reason:        reason        ?? null,
      revisionNotes: revisionNotes ?? null,
      sectionsJson:  sectionsJson  ?? null,
      qcScore:       qcScore       ?? null,
      qcPassed:      qcPassed      ?? null,
      qcDimensionsJson: qcDimensions ?? null,
      sentForReviewAt: new Date(),
      createdBy:     createdBy ?? null,
    })
    .returning();

  return row;
}

/**
 * List all versions for a project, newest first.
 */
export async function listVersionsForProject(projectId: string): Promise<CpDocumentVersion[]> {
  return db
    .select()
    .from(cpDocumentVersionsTable)
    .where(eq(cpDocumentVersionsTable.projectId, projectId))
    .orderBy(desc(cpDocumentVersionsTable.version));
}

/**
 * Get a specific version by number.
 */
export async function getVersionByNumber(
  projectId: string,
  version: number,
): Promise<CpDocumentVersion | null> {
  const [row] = await db
    .select()
    .from(cpDocumentVersionsTable)
    .where(
      and(
        eq(cpDocumentVersionsTable.projectId, projectId),
        eq(cpDocumentVersionsTable.version, version),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Compute section-level diff between two document versions.
 * No word-by-word diff — section presence/absence only.
 */
export function diffVersionSections(
  v1: CpDocumentVersion,
  v2: CpDocumentVersion,
): VersionSectionDiff {
  const set1 = toSectionSet(v1);
  const set2 = toSectionSet(v2);

  const added     = [...set2].filter((s) => !set1.has(s));
  const removed   = [...set1].filter((s) => !set2.has(s));
  const unchanged = [...set1].filter((s) =>  set2.has(s));

  return { added, removed, unchanged };
}

/**
 * Mark a version as approved.
 */
export async function approveVersion(
  projectId: string,
  version: number,
  approvedBy: string,
): Promise<CpDocumentVersion | null> {
  const [row] = await db
    .update(cpDocumentVersionsTable)
    .set({ approved: true, approvedAt: new Date(), approvedBy })
    .where(
      and(
        eq(cpDocumentVersionsTable.projectId, projectId),
        eq(cpDocumentVersionsTable.version, version),
      ),
    )
    .returning();
  return row ?? null;
}
