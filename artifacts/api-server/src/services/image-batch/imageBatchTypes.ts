/**
 * imageBatchTypes.ts — Phase 5 Creative Asset Batch Engine
 *
 * Shared type contracts for the Image Batch Engine. A "batch" is a set of
 * related images produced for one creative project (e.g. 3 logo concepts,
 * a 4-platform social media pack, a packaging front view). The engine is
 * generic — per-batch-type behavior lives in services/image-batch/definitions/.
 */

import type { NamedAssetRole, GeneratedNamedAsset } from "../imageDesignerService.js";

/** Supported batch types. Add new entries as new batch definitions are built. */
export type ImageBatchType = "logo_design" | "social_media" | "packaging_design";

/** One group within an entitlement (e.g. one logo concept, one social platform). */
export interface EntitlementGroup {
  /** Stable machine key, also used as the item group/folder key. */
  key: string;
  /** Human label shown in the gallery / admin monitor. */
  label: string;
  /** How many images this group produces (almost always 1 for Phase 5). */
  count: number;
  /** Aspect ratio hint passed to the image provider, e.g. "1:1", "9:16". */
  aspectRatio?: string;
  /** Platform this group targets, for social batches (e.g. "instagram"). */
  platform?: string;
}

/** Where an entitlement's quantity/shape actually came from — for honesty in
 * the admin monitor and to avoid ever inferring quantity from a package name. */
export type EntitlementSource = "service_request_snapshot" | "package_limits" | "catalog_fallback";

export interface BatchEntitlement {
  batchType: ImageBatchType;
  groups: EntitlementGroup[];
  totalItems: number;
  /** Whether a downloadable ZIP is part of what was promised to the customer. */
  zipRequired: boolean;
  source: EntitlementSource;
}

/** A single generation unit derived from an entitlement group. */
export interface ImageBatchItemSpec {
  itemKey: string;
  group: string;
  groupLabel: string;
  role: NamedAssetRole;
  platform?: string;
}

export type BatchItemStatus = "completed" | "failed" | "duplicate_rejected";

/** A generated + validated batch item, ready to persist as a creative_ai_asset. */
export interface GeneratedImageBatchItem extends GeneratedNamedAsset {
  itemKey: string;
  group: string;
  groupLabel: string;
  platform?: string;
  itemStatus: BatchItemStatus;
  perceptualHash?: string;
  duplicateScore?: number;
  duplicateOfItemKey?: string;
}

export interface BatchValidationResult {
  ok: boolean;
  missingGroups: string[];
  completedCount: number;
  requiredCount: number;
}

/** Contract every batch type (logo/social/packaging/...) must implement. */
export interface ImageBatchDefinition {
  batchType: ImageBatchType;
  /** Catalog serviceCodes this definition applies to. */
  serviceCodes: string[];
  /** Last-resort entitlement when no snapshot/limits data exists (legacy orders). */
  catalogFallback: Omit<BatchEntitlement, "source">;
  /** Turn an entitlement into concrete generation specs, using project brief context. */
  buildItems: (entitlement: BatchEntitlement, brief: Record<string, unknown>) => ImageBatchItemSpec[];
  /** True only when every required group produced a non-duplicate-rejected completed item. */
  validateBatch: (items: GeneratedImageBatchItem[], entitlement: BatchEntitlement) => BatchValidationResult;
  /** ZIP folder for a given item, e.g. "logo-concepts/concept-1". */
  zipFolderFor: (item: GeneratedImageBatchItem) => string;
}
