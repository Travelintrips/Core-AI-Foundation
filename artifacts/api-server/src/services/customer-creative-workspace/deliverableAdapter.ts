/**
 * deliverableAdapter.ts — Customer-safe deliverable read model.
 *
 * Reads creative_ai_assets and ai_zip_deliveries.
 * Security:
 *   • storagePath is NEVER included in any DTO
 *   • imageUrl is NEVER included (may be pre-signed internal URL)
 *   • signEndpoint gives the frontend the path to call for a time-limited URL
 * IDOR: caller must pass in a project already verified to belong to clientEmail.
 */
import { eq } from "drizzle-orm";
import { db, creativeAiAssetsTable, aiZipDeliveriesTable } from "@workspace/db";
import type { DeliverableBundle, CWDeliverable, CWZipBundle } from "./types.js";

const STATUS_LABELS: Record<string, string> = {
  pending:            "Dalam Proses",
  completed:          "Siap",
  approved:           "Disetujui",
  rejected:           "Perlu Revisi",
  pending_review:     "Menunggu Review",
  revision_requested: "Revisi Diminta",
  generated:          "Dibuat",
};

function assetTitle(assetType: string, category: string | null, version: number): string {
  const cat = category ?? assetType;
  const label = cat
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return version > 1 ? `${label} v${version}` : label;
}

export async function getDeliverableBundle(
  projectId: string,      // text UUID (from creative_projects.project_id)
  internalProjectId: number,
  projectNumber: string,
  filesUnlocked: boolean,
  token: string,          // workspace token — used to build signEndpoint paths
): Promise<DeliverableBundle> {
  // Fetch assets — SELECT only safe columns (no storagePath, no imageUrl)
  const assets = await db
    .select({
      id:            creativeAiAssetsTable.id,
      assetType:     creativeAiAssetsTable.assetType,
      category:      creativeAiAssetsTable.category,
      version:       creativeAiAssetsTable.version,
      status:        creativeAiAssetsTable.status,
      revisionNotes: creativeAiAssetsTable.revisionNotes,
      createdAt:     creativeAiAssetsTable.createdAt,
    })
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.projectId, projectId))
    .orderBy(creativeAiAssetsTable.createdAt);

  // Fetch zip bundles — SELECT only safe columns (no storagePath)
  const zips = await db
    .select({
      id:          aiZipDeliveriesTable.id,
      status:      aiZipDeliveriesTable.status,
      manifestJson:aiZipDeliveriesTable.manifestJson,
      createdAt:   aiZipDeliveriesTable.createdAt,
    })
    .from(aiZipDeliveriesTable)
    .where(eq(aiZipDeliveriesTable.projectId, projectId))
    .orderBy(aiZipDeliveriesTable.createdAt);

  const deliverables: CWDeliverable[] = assets.map((a) => ({
    id:              a.id,
    assetType:       a.assetType ?? "asset",
    category:        a.category,
    title:           assetTitle(a.assetType ?? "asset", a.category, a.version ?? 1),
    status:          a.status ?? "pending",
    statusLabel:     STATUS_LABELS[a.status ?? "pending"] ?? a.status ?? "Dalam Proses",
    version:         a.version ?? 1,
    revisionNotes:   a.revisionNotes ?? null,
    locked:          !filesUnlocked,
    downloadAvailable: filesUnlocked && (a.status === "completed" || a.status === "approved"),
    signEndpoint:    `/api/public/customer/workspace/${token}/downloads/${a.id}/sign`,
    createdAt:       a.createdAt.toISOString(),
  }));

  // Use the most recent completed zip, else most recent zip overall
  const completedZip = zips.find((z) => z.status === "completed") ?? zips[zips.length - 1] ?? null;
  const zipBundle: CWZipBundle | null = completedZip
    ? {
        id:           completedZip.id,
        status:       completedZip.status ?? "pending",
        signEndpoint: `/api/public/customer/workspace/${token}/downloads/zip/${completedZip.id}/sign`,
        assetCount:   (() => {
          const m = completedZip.manifestJson as Record<string, unknown> | null;
          if (!m) return null;
          const items = (m["items"] ?? m["files"] ?? m["assets"]) as unknown[] | undefined;
          return Array.isArray(items) ? items.length : null;
        })(),
        createdAt:    completedZip.createdAt.toISOString(),
      }
    : null;

  return {
    projectNumber,
    filesUnlocked,
    deliverables,
    zipBundle,
    totalAssets:    deliverables.length,
    approvedAssets: deliverables.filter((d) => d.status === "approved").length,
    pendingAssets:  deliverables.filter((d) => d.status === "pending" || d.status === "generated").length,
  };
}
