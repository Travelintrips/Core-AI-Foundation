/**
 * brandKitEnterpriseService.ts — V4.2D Brand Kit Enterprise
 *
 * Manages versioned brand kit slot assets, completeness scoring, and
 * the brand kit enterprise experience. Reads and writes ai_brand_kit_assets.
 * Never touches Queue / Dispatcher / Worker / Event Bus / Review / Payment.
 */
import { createHash } from "crypto";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  aiBrandKitAssetsTable,
  creativeProjectsTable,
  creativeAiClientReviewsTable,
  aiServiceRequestsTable,
  BRAND_KIT_SLOTS,
  SLOT_WEIGHTS,
  SLOT_DIMENSIONS,
  type BrandKitSlot,
  type AiBrandKitAsset,
  type InsertAiBrandKitAsset,
} from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";
import { logAudit } from "./aiAuditService.js";

// ── Completeness score ────────────────────────────────────────────────────────

export interface BrandCompletenessScore {
  total: number; // 0–100
  dimensions: {
    logo: number;
    colors: number;
    fonts: number;
    voice: number;
    assets: number;
    guidelines: number;
  };
  filledSlots: string[];
  missingSlots: string[];
  isComplete: boolean; // total >= 80
}

function computeCompleteness(activeSlots: Set<string>): BrandCompletenessScore {
  let total = 0;
  const dimensions: BrandCompletenessScore["dimensions"] = {
    logo: 0, colors: 0, fonts: 0, voice: 0, assets: 0, guidelines: 0,
  };

  for (const slot of BRAND_KIT_SLOTS) {
    if (slot === "monogram") continue; // bonus slot, not scored
    if (activeSlots.has(slot)) {
      const w = SLOT_WEIGHTS[slot] ?? 0;
      total += w;
      // Attribute to dimension
      for (const [dim, slots] of Object.entries(SLOT_DIMENSIONS)) {
        if ((slots as string[]).includes(slot)) {
          (dimensions as Record<string, number>)[dim] += w;
        }
      }
    }
  }

  const filledSlots = BRAND_KIT_SLOTS.filter((s) => s !== "monogram" && activeSlots.has(s));
  const missingSlots = BRAND_KIT_SLOTS.filter((s) => s !== "monogram" && !activeSlots.has(s));

  return { total: Math.min(total, 100), dimensions, filledSlots, missingSlots, isComplete: total >= 80 };
}

// ── Ownership guard ───────────────────────────────────────────────────────────

export async function customerOwnsProjectBrandKit(emailHash: string, clientEmail: string, projectId: string): Promise<boolean> {
  const email = clientEmail.toLowerCase().trim();
  // Via creative_ai_client_reviews
  const [review] = await db
    .select({ id: creativeAiClientReviewsTable.id })
    .from(creativeAiClientReviewsTable)
    .where(and(eq(creativeAiClientReviewsTable.projectId, projectId), eq(creativeAiClientReviewsTable.clientEmail, email)));
  if (review) return true;

  // Via service request
  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.projectId, projectId));
  if (project?.serviceRequestId) {
    const [sr] = await db
      .select({ id: aiServiceRequestsTable.id })
      .from(aiServiceRequestsTable)
      .where(and(eq(aiServiceRequestsTable.id, project.serviceRequestId), eq(aiServiceRequestsTable.customerEmail, email)));
    if (sr) return true;
  }
  return false;
}

// ── Read operations ───────────────────────────────────────────────────────────

export interface BrandKitAssetView {
  id: number;
  projectId: string;
  slot: string;
  fileName: string | null;
  previewUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  checksum: string | null;
  value: string | null;
  valueJson: Record<string, unknown> | null;
  version: number;
  active: boolean;
  archived: boolean;
  uploadedBy: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

function toView(a: AiBrandKitAsset): BrandKitAssetView {
  return {
    id: a.id,
    projectId: a.projectId,
    slot: a.slot,
    fileName: a.fileName ?? null,
    previewUrl: a.previewUrl ?? null,
    mimeType: a.mimeType ?? null,
    fileSizeBytes: a.fileSizeBytes ?? null,
    checksum: a.checksum ?? null,
    value: a.value ?? null,
    valueJson: (a.valueJson as Record<string, unknown> | null) ?? null,
    version: a.version,
    active: a.active,
    archived: a.archived,
    uploadedBy: a.uploadedBy ?? null,
    tags: Array.isArray(a.tags) ? (a.tags as string[]) : [],
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export interface BrandKitEnterpriseResult {
  projectId: string;
  brandName: string;
  slots: Record<string, BrandKitAssetView | null>;
  completeness: BrandCompletenessScore;
}

export async function getBrandKitEnterprise(
  projectId: string,
): Promise<BrandKitEnterpriseResult | null> {
  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.projectId, projectId));
  if (!project) return null;

  // Get all active assets for this project
  const assets = await db
    .select()
    .from(aiBrandKitAssetsTable)
    .where(and(eq(aiBrandKitAssetsTable.projectId, projectId), eq(aiBrandKitAssetsTable.active, true)))
    .orderBy(desc(aiBrandKitAssetsTable.version));

  // One active asset per slot (take highest version if multiple)
  const slotMap = new Map<string, AiBrandKitAsset>();
  for (const a of assets) {
    if (!slotMap.has(a.slot)) slotMap.set(a.slot, a);
  }

  const slots: Record<string, BrandKitAssetView | null> = {};
  for (const slot of BRAND_KIT_SLOTS) {
    const a = slotMap.get(slot);
    slots[slot] = a ? toView(a) : null;
  }

  const activeSlots = new Set(slotMap.keys());
  const completeness = computeCompleteness(activeSlots);

  return {
    projectId,
    brandName: project.brandName,
    slots,
    completeness,
  };
}

export async function listBrandKitEnterpriseForCustomer(
  emailHash: string,
  clientEmail: string,
): Promise<BrandKitEnterpriseResult[]> {
  // Get all projects owned by this customer
  const email = clientEmail.toLowerCase().trim();
  const reviews = await db
    .select({ projectId: creativeAiClientReviewsTable.projectId })
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.clientEmail, email));

  const serviceReqs = await db
    .select({ createdProjectId: aiServiceRequestsTable.createdProjectId })
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.customerEmail, email));

  const projectIds = new Set<string>([
    ...reviews.map((r) => r.projectId),
    ...serviceReqs.map((r) => r.createdProjectId).filter((id): id is string => !!id),
  ]);

  const results: BrandKitEnterpriseResult[] = [];
  for (const pid of projectIds) {
    const kit = await getBrandKitEnterprise(pid);
    if (kit) results.push(kit);
  }
  return results;
}

// ── Write operations ──────────────────────────────────────────────────────────

export interface UpsertBrandKitSlotInput {
  projectId: string;
  emailHash: string;
  slot: string;
  fileName?: string;
  storagePath?: string;
  previewUrl?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  value?: string;
  valueJson?: Record<string, unknown>;
  uploadedBy?: string;
  tags?: string[];
  fileBuffer?: Buffer; // for checksum computation
}

export async function upsertBrandKitSlot(input: UpsertBrandKitSlotInput): Promise<BrandKitAssetView> {
  // Deactivate all existing active rows for this slot
  const existing = await db
    .select()
    .from(aiBrandKitAssetsTable)
    .where(and(eq(aiBrandKitAssetsTable.projectId, input.projectId), eq(aiBrandKitAssetsTable.slot, input.slot), eq(aiBrandKitAssetsTable.active, true)))
    .orderBy(desc(aiBrandKitAssetsTable.version));

  const currentVersion = existing[0]?.version ?? 0;
  const parentId = existing[0]?.id ?? null;

  // Mark all existing active as inactive
  if (existing.length > 0) {
    await db
      .update(aiBrandKitAssetsTable)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(aiBrandKitAssetsTable.projectId, input.projectId), eq(aiBrandKitAssetsTable.slot, input.slot), eq(aiBrandKitAssetsTable.active, true)));
  }

  // Compute checksum if buffer provided
  let checksum: string | undefined;
  if (input.fileBuffer) {
    checksum = createHash("sha256").update(input.fileBuffer).digest("hex");
  }

  // Insert new version
  const row: InsertAiBrandKitAsset = {
    projectId: input.projectId,
    emailHash: input.emailHash,
    slot: input.slot,
    fileName: input.fileName,
    storagePath: input.storagePath,
    previewUrl: input.previewUrl,
    mimeType: input.mimeType,
    fileSizeBytes: input.fileSizeBytes,
    checksum,
    value: input.value,
    valueJson: input.valueJson,
    version: currentVersion + 1,
    parentAssetId: parentId ?? undefined,
    active: true,
    archived: false,
    uploadedBy: input.uploadedBy,
    tags: input.tags ?? [],
  };

  const [inserted] = await db.insert(aiBrandKitAssetsTable).values(row).returning();

  // Publish analytics event
  await publishSafe("brand_kit_slot_updated", {
    projectId: input.projectId,
    slot: input.slot,
    version: inserted.version,
    uploadedBy: input.uploadedBy,
  });

  await logAudit("brand-kit", "slot_upserted", String(inserted.id), "ai_brand_kit_asset", "success", {
    projectId: input.projectId,
    slot: input.slot,
    version: inserted.version,
  });

  return toView(inserted);
}

export async function archiveBrandKitSlot(projectId: string, slot: string): Promise<boolean> {
  const rows = await db
    .update(aiBrandKitAssetsTable)
    .set({ archived: true, active: false, updatedAt: new Date() })
    .where(and(eq(aiBrandKitAssetsTable.projectId, projectId), eq(aiBrandKitAssetsTable.slot, slot)))
    .returning();
  return rows.length > 0;
}

export async function getSlotVersionHistory(projectId: string, slot: string): Promise<BrandKitAssetView[]> {
  const rows = await db
    .select()
    .from(aiBrandKitAssetsTable)
    .where(and(eq(aiBrandKitAssetsTable.projectId, projectId), eq(aiBrandKitAssetsTable.slot, slot)))
    .orderBy(desc(aiBrandKitAssetsTable.version));
  return rows.map(toView);
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

export async function getAdminBrandKitStats() {
  const allActive = await db
    .select({ projectId: aiBrandKitAssetsTable.projectId, slot: aiBrandKitAssetsTable.slot })
    .from(aiBrandKitAssetsTable)
    .where(eq(aiBrandKitAssetsTable.active, true));

  const byProject = new Map<string, Set<string>>();
  for (const row of allActive) {
    if (!byProject.has(row.projectId)) byProject.set(row.projectId, new Set());
    byProject.get(row.projectId)!.add(row.slot);
  }

  const scores = [...byProject.entries()].map(([pid, slots]) => ({
    projectId: pid,
    completeness: computeCompleteness(slots),
  }));

  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((s, r) => s + r.completeness.total, 0) / scores.length)
    : 0;
  const complete = scores.filter((r) => r.completeness.isComplete).length;

  return { totalProjects: scores.length, avgCompletenessScore: avgScore, completeCount: complete, scores };
}
