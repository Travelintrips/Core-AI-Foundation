/**
 * imageBatchAssetService.ts — Phase 5 Creative Asset Batch Engine
 *
 * Persists batch items into the existing creative_ai_assets table (no schema
 * migration — batch-specific fields live in `metadata`, matching the
 * convention already used by other asset producers in this codebase).
 *
 * category      = batchType (e.g. "logo_design") for individual image items,
 *                 or `${batchType}_zip` for the export archive.
 * assetType     = "image" for items, "archive" for the ZIP.
 * metadata      = { batchType, itemKey, group, groupLabel, platform,
 *                    itemStatus, duplicateScore, duplicateOfItemKey,
 *                    entitlementSource, perceptualHash }
 */

import { eq, and, inArray } from "drizzle-orm";
import { db, creativeAiAssetsTable, type CreativeAiAsset } from "@workspace/db";
import type { GeneratedImageBatchItem, ImageBatchType, BatchEntitlement } from "./imageBatchTypes.js";

export async function listBatchAssets(projectId: string, batchType: ImageBatchType): Promise<CreativeAiAsset[]> {
  return db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, projectId),
        eq(creativeAiAssetsTable.assetType, "image"),
        eq(creativeAiAssetsTable.category, batchType),
      ),
    )
    .orderBy(creativeAiAssetsTable.createdAt);
}

export async function listBatchAssetsByKeys(
  projectId: string,
  batchType: ImageBatchType,
  itemKeys: string[],
): Promise<CreativeAiAsset[]> {
  if (itemKeys.length === 0) return [];
  const rows = await listBatchAssets(projectId, batchType);
  return rows.filter((r) => itemKeys.includes(((r.metadata ?? {}) as Record<string, unknown>)["itemKey"] as string));
}

export async function persistBatchItem(
  projectId: string,
  batchType: ImageBatchType,
  entitlementSource: BatchEntitlement["source"],
  item: GeneratedImageBatchItem,
): Promise<CreativeAiAsset> {
  // Idempotency: replace any prior attempt for the same itemKey rather than
  // accumulating duplicate rows on retry.
  const existing = await listBatchAssetsByKeys(projectId, batchType, [item.itemKey]);

  const values = {
    projectId,
    provider: "replicate",
    model: item.role || "image-batch",
    assetType: "image" as const,
    category: batchType,
    prompt: item.prompt,
    imageUrl: item.imageUrl,
    status: item.itemStatus === "completed" ? ("completed" as const) : ("failed" as const),
    qcScore: Math.round(item.qcScore ?? 0),
    qcNotes: item.qcNotes ?? null,
    cost: String(item.cost ?? 0),
    metadata: {
      batchType,
      itemKey: item.itemKey,
      group: item.group,
      groupLabel: item.groupLabel,
      platform: item.platform ?? null,
      itemStatus: item.itemStatus,
      duplicateScore: item.duplicateScore ?? null,
      duplicateOfItemKey: item.duplicateOfItemKey ?? null,
      entitlementSource,
      perceptualHash: item.perceptualHash ?? null,
      sourceProviderUrl: item.sourceProviderUrl ?? null,
    },
  };

  if (existing[0]) {
    const [updated] = await db
      .update(creativeAiAssetsTable)
      .set(values)
      .where(eq(creativeAiAssetsTable.id, existing[0].id))
      .returning();
    return updated!;
  }

  const [created] = await db.insert(creativeAiAssetsTable).values(values).returning();
  return created!;
}

export async function persistBatchZip(
  projectId: string,
  batchType: ImageBatchType,
  storagePath: string,
  permanentUrl: string,
  itemCount: number,
  fileSizeBytes: number,
): Promise<CreativeAiAsset> {
  const category = `${batchType}_zip`;
  const [existing] = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, projectId),
        eq(creativeAiAssetsTable.assetType, "archive"),
        eq(creativeAiAssetsTable.category, category),
      ),
    );

  const values = {
    projectId,
    provider: "internal",
    model: "zip-export",
    prompt: `${batchType} batch export archive`,
    assetType: "archive" as const,
    category,
    imageUrl: permanentUrl,
    storagePath,
    status: "completed" as const,
    metadata: { batchType, itemCount, fileSizeBytes },
  };

  if (existing) {
    const [updated] = await db
      .update(creativeAiAssetsTable)
      .set({ ...values, version: existing.version + 1 })
      .where(eq(creativeAiAssetsTable.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db.insert(creativeAiAssetsTable).values(values).returning();
  return created!;
}

/** Group completed image items for the customer gallery / admin monitor. */
export function groupAssetsForGallery(assets: CreativeAiAsset[]): Array<{
  group: string;
  groupLabel: string;
  items: CreativeAiAsset[];
}> {
  const byGroup = new Map<string, { groupLabel: string; items: CreativeAiAsset[] }>();
  for (const asset of assets) {
    const meta = (asset.metadata ?? {}) as Record<string, unknown>;
    const group = String(meta["group"] ?? "ungrouped");
    const groupLabel = String(meta["groupLabel"] ?? group);
    if (!byGroup.has(group)) byGroup.set(group, { groupLabel, items: [] });
    byGroup.get(group)!.items.push(asset);
  }
  return Array.from(byGroup.entries()).map(([group, v]) => ({ group, groupLabel: v.groupLabel, items: v.items }));
}

export async function listBatchAssetsForProjects(projectIds: string[]): Promise<CreativeAiAsset[]> {
  if (projectIds.length === 0) return [];
  return db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        inArray(creativeAiAssetsTable.projectId, projectIds),
        inArray(creativeAiAssetsTable.assetType, ["image", "archive"]),
      ),
    );
}
