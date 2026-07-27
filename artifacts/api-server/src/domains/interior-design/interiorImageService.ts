/**
 * Interior Design Asset Image Service
 *
 * Fetches images from Pexels API, uploads to Supabase Storage (interior-assets bucket),
 * and persists metadata to id_interior_asset_images.
 *
 * API key (PEXELS_API_KEY) is read server-side only — never exposed to frontend.
 * Gracefully degrades when no key is configured.
 */

import { pool } from "@workspace/db";
import { uploadToSupabase, getSupabasePublicUrl, storageObjectExists } from "../../lib/supabaseStorage.js";
import { logger } from "../../lib/logger.js";

export const INTERIOR_ASSETS_BUCKET = "interior-assets";

// Folder per item type inside the bucket
const FOLDER_MAP: Record<string, string> = {
  material:   "materials",
  furniture:  "furniture",
  lighting:   "lighting",
  space_plan: "space-plans",
};

// ── Types ──────────────────────────────────────────────────────────────────────

export interface InteriorAssetImage {
  id: number;
  projectUuid: string;
  itemType: string;
  itemId: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  imageSource: string | null;
  imageSourceUrl: string | null;
  imageLicense: string | null;
  imageAttribution: string | null;
  isManualUpload: boolean;
  storagePath: string | null;
  mimeType: string;
  fileSizeBytes: number | null;
  imageUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PexelsPhoto {
  id: number;
  url: string;
  photographer: string;
  photographer_url: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    small: string;
    portrait: string;
    landscape: string;
    tiny: string;
  };
  alt: string;
}

interface PexelsSearchResult {
  photos: PexelsPhoto[];
  total_results: number;
}

// ── Pexels search ──────────────────────────────────────────────────────────────

/**
 * Build a specific, multi-field search query for a given item.
 * Uses category + type + style/color to avoid single-word generic matches.
 */
export function buildSearchQuery(item: {
  itemType: string;
  name?: string;
  category?: string;
  materialType?: string;
  style?: string;
  color?: string;
  zone?: string;
  lightingType?: string;
  fixtureType?: string;
}): string {
  const parts: string[] = [];

  switch (item.itemType) {
    case "material": {
      if (item.color) parts.push(item.color);
      if (item.materialType) parts.push(item.materialType);
      parts.push("texture close-up");
      if (item.category && item.category !== item.materialType) parts.push(item.category);
      break;
    }
    case "furniture": {
      if (item.style) parts.push(item.style);
      if (item.color) parts.push(item.color);
      if (item.name) parts.push(item.name);
      else if (item.category) parts.push(item.category);
      parts.push("furniture product white background");
      break;
    }
    case "lighting": {
      if (item.lightingType) parts.push(item.lightingType);
      else if (item.fixtureType) parts.push(item.fixtureType);
      else parts.push("light fixture");
      parts.push("lamp fixture");
      break;
    }
    case "space_plan": {
      if (item.zone) parts.push(item.zone);
      else if (item.name) parts.push(item.name);
      parts.push("floor plan top view layout diagram");
      break;
    }
    default: {
      parts.push(item.name ?? item.category ?? "interior design");
    }
  }

  return parts.filter(Boolean).join(" ").slice(0, 120);
}

/** Retry helper with exponential backoff. Returns null if all attempts fail. */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) {
        logger.warn({ err, label, attempt }, "[interiorImage] All retry attempts exhausted");
        return null;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.debug({ label, attempt, delay }, "[interiorImage] Retrying after delay");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return null;
}

/**
 * Search Pexels for a relevant image.
 * Returns null when no key is configured or no results found.
 * Retries up to 3 times with exponential backoff on network errors.
 */
export async function searchPexels(query: string, perPage = 5): Promise<PexelsPhoto | null> {
  const apiKey = process.env["PEXELS_API_KEY"];
  if (!apiKey) {
    logger.debug({ query }, "[interiorImage] PEXELS_API_KEY not set — skipping search");
    return null;
  }

  const result = await withRetry(async () => {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=square`;
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429) throw new Error("Pexels rate-limited (429)");
    if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);

    const data = await res.json() as PexelsSearchResult;
    if (!data.photos || data.photos.length === 0) return null;

    // Pick first photo — caller may implement scoring
    return data.photos[0] ?? null;
  }, `searchPexels("${query.slice(0, 40)}")`);

  return result ?? null;
}

// ── Validation ─────────────────────────────────────────────────────────────────

const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB source tolerance
const MIN_SIZE_BYTES = 1024; // 1KB minimum (reject near-empty responses)

/** Validate MIME type and size. Throws descriptive error on rejection. */
function validateImageBuffer(buffer: Buffer, contentType: string): void {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error(`Rejected: MIME type not allowed: ${mime}`);
  }
  if (buffer.byteLength < MIN_SIZE_BYTES) {
    throw new Error(`Rejected: file too small (${buffer.byteLength} bytes)`);
  }
  if (buffer.byteLength > MAX_SIZE_BYTES) {
    throw new Error(`Rejected: file too large (${Math.round(buffer.byteLength / 1024)}KB)`);
  }
  // Check for common watermark/ad patterns in filenames (not binary sniff)
  // MIME-only validation is sufficient here; binary checks are out of scope.
}

/** Sanitise a filename to prevent path traversal. */
function safeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

// ── Supabase bucket for interior-assets ───────────────────────────────────────

let bucketEnsured = false;

export async function ensureInteriorAssetsBucket(): Promise<void> {
  if (bucketEnsured) return;

  const isDev = process.env["NODE_ENV"] !== "production";
  const url = isDev ? process.env["SUPABASE_URL_DEV"] : process.env["SUPABASE_URL"];
  const key = isDev ? process.env["SUPABASE_SERVICE_ROLE_KEY_DEV"] : process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) { logger.warn("[interiorImage] Supabase credentials not set — bucket check skipped"); return; }

  const listRes = await fetch(`${url}/storage/v1/bucket`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (!listRes.ok) { logger.warn("[interiorImage] Could not list buckets"); return; }

  const buckets = await listRes.json() as Array<{ name: string }>;
  if (buckets.some((b) => b.name === INTERIOR_ASSETS_BUCKET)) {
    bucketEnsured = true;
    return;
  }

  const createRes = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ id: INTERIOR_ASSETS_BUCKET, name: INTERIOR_ASSETS_BUCKET, public: true, file_size_limit: 5 * 1024 * 1024 }),
  });
  if (createRes.ok) {
    logger.info("[interiorImage] Created public bucket: interior-assets");
    bucketEnsured = true;
  } else {
    const t = await createRes.text();
    logger.warn({ body: t }, "[interiorImage] Could not create interior-assets bucket");
  }
}

/**
 * Upload a buffer to the interior-assets bucket and return the public URL.
 */
async function uploadToInteriorBucket(
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  await ensureInteriorAssetsBucket();

  const isDev = process.env["NODE_ENV"] !== "production";
  const supabaseUrl = isDev ? process.env["SUPABASE_URL_DEV"] : process.env["SUPABASE_URL"];
  const serviceKey  = isDev ? process.env["SUPABASE_SERVICE_ROLE_KEY_DEV"] : process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase credentials not set");

  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${INTERIOR_ASSETS_BUCKET}/${cleanPath}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`interior-assets upload failed (${res.status}): ${text}`);
  }
  return `${supabaseUrl}/storage/v1/object/public/${INTERIOR_ASSETS_BUCKET}/${cleanPath}`;
}

// ── Core: fetch + upload ───────────────────────────────────────────────────────

export interface FetchAndUploadResult {
  storagePath: string;
  thumbnailUrl: string;
  imageUrl: string;
  imageAlt: string;
  imageSource: string;
  imageSourceUrl: string;
  imageLicense: string;
  imageAttribution: string;
  mimeType: string;
  fileSizeBytes: number;
}

/**
 * Download a Pexels photo (medium size), validate, and upload to Supabase.
 * Returns permanent CDN URLs and attribution metadata.
 */
export async function fetchAndUploadPexelsPhoto(
  photo: PexelsPhoto,
  projectUuid: string,
  itemType: string,
  itemId: string,
): Promise<FetchAndUploadResult> {
  await ensureInteriorAssetsBucket();

  // Use medium-size Pexels image (typically 400-600px — ideal thumbnail)
  const sourceUrl = photo.src.medium;

  const downloaded = await withRetry(async () => {
    const r = await fetch(sourceUrl, {
      headers: { "User-Agent": "Creative-AI-Studio/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`Failed to download Pexels image: ${r.status}`);
    const ct = r.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());
    return { contentType: ct, buffer: buf };
  }, `downloadPexels(photo=${photo.id})`);

  if (!downloaded) throw new Error("Failed to download Pexels image after retries");
  const { contentType, buffer } = downloaded;

  validateImageBuffer(buffer, contentType);

  const folder = FOLDER_MAP[itemType] ?? "misc";
  const ext = contentType.includes("webp") ? "webp" : contentType.includes("png") ? "png" : "jpg";
  const safeName = safeFilename(`${itemId}-${photo.id}`);
  const storagePath = `${folder}/${projectUuid}/${safeName}.${ext}`;

  const thumbnailUrl = await withRetry(
    () => uploadToInteriorBucket(storagePath, buffer, contentType),
    `uploadToSupabase(${storagePath.slice(-50)})`,
  ).then((url) => {
    if (!url) throw new Error("Upload to Supabase failed after retries");
    return url;
  });

  return {
    storagePath,
    thumbnailUrl,
    imageUrl: thumbnailUrl,
    imageAlt: photo.alt || `${itemType} image`,
    imageSource: "pexels",
    imageSourceUrl: photo.url,
    imageLicense: "Pexels License",
    imageAttribution: photo.photographer,
    mimeType: contentType,
    fileSizeBytes: buffer.byteLength,
  };
}

// ── DB operations ──────────────────────────────────────────────────────────────

function rowToImage(row: Record<string, unknown>): InteriorAssetImage {
  return {
    id:               row["id"] as number,
    projectUuid:      row["project_uuid"] as string,
    itemType:         row["item_type"] as string,
    itemId:           row["item_id"] as string,
    thumbnailUrl:     row["thumbnail_url"] as string | null,
    imageUrl:         row["image_url"] as string | null,
    imageAlt:         row["image_alt"] as string | null,
    imageSource:      row["image_source"] as string | null,
    imageSourceUrl:   row["image_source_url"] as string | null,
    imageLicense:     row["image_license"] as string | null,
    imageAttribution: row["image_attribution"] as string | null,
    isManualUpload:   Boolean(row["is_manual_upload"]),
    storagePath:      row["storage_path"] as string | null,
    mimeType:         (row["mime_type"] as string) ?? "image/jpeg",
    fileSizeBytes:    row["file_size_bytes"] as number | null,
    imageUpdatedAt:   row["image_updated_at"] ? new Date(row["image_updated_at"] as string) : null,
    createdAt:        new Date(row["created_at"] as string),
    updatedAt:        new Date(row["updated_at"] as string),
  };
}

/**
 * Get all asset images for a project, keyed as `{itemType}:{itemId}`.
 */
export async function getImagesByProject(projectUuid: string): Promise<InteriorAssetImage[]> {
  const res = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ai_platform.id_interior_asset_images
     WHERE project_uuid = $1
     ORDER BY item_type, created_at`,
    [projectUuid],
  );
  return res.rows.map(rowToImage);
}

/**
 * Get a single image record.
 */
export async function getImage(
  projectUuid: string,
  itemType: string,
  itemId: string,
): Promise<InteriorAssetImage | null> {
  const res = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ai_platform.id_interior_asset_images
     WHERE project_uuid = $1 AND item_type = $2 AND item_id = $3`,
    [projectUuid, itemType, itemId],
  );
  if (res.rows.length === 0) return null;
  return rowToImage(res.rows[0]!);
}

/**
 * Upsert an image record. Manual uploads are never overwritten by auto-enrichment.
 * Set forceOverwrite = true to replace a manual upload (admin explicit action).
 */
export async function upsertImage(
  data: {
    projectUuid: string;
    itemType: string;
    itemId: string;
    thumbnailUrl: string;
    imageUrl: string;
    imageAlt: string;
    imageSource: string;
    imageSourceUrl?: string;
    imageLicense?: string;
    imageAttribution?: string;
    isManualUpload?: boolean;
    storagePath?: string;
    mimeType?: string;
    fileSizeBytes?: number;
  },
  forceOverwrite = false,
): Promise<InteriorAssetImage> {
  // Check existing — don't overwrite manual uploads unless forced
  if (!forceOverwrite) {
    const existing = await getImage(data.projectUuid, data.itemType, data.itemId);
    if (existing?.isManualUpload) {
      logger.debug({ projectUuid: data.projectUuid, itemType: data.itemType, itemId: data.itemId },
        "[interiorImage] Skipping auto-overwrite of manual upload");
      return existing;
    }
  }

  const res = await pool.query<Record<string, unknown>>(
    `INSERT INTO ai_platform.id_interior_asset_images
       (project_uuid, item_type, item_id, thumbnail_url, image_url, image_alt,
        image_source, image_source_url, image_license, image_attribution,
        is_manual_upload, storage_path, mime_type, file_size_bytes, image_updated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
     ON CONFLICT (project_uuid, item_type, item_id) DO UPDATE SET
       thumbnail_url     = EXCLUDED.thumbnail_url,
       image_url         = EXCLUDED.image_url,
       image_alt         = EXCLUDED.image_alt,
       image_source      = EXCLUDED.image_source,
       image_source_url  = EXCLUDED.image_source_url,
       image_license     = EXCLUDED.image_license,
       image_attribution = EXCLUDED.image_attribution,
       is_manual_upload  = EXCLUDED.is_manual_upload,
       storage_path      = EXCLUDED.storage_path,
       mime_type         = EXCLUDED.mime_type,
       file_size_bytes   = EXCLUDED.file_size_bytes,
       image_updated_at  = NOW(),
       updated_at        = NOW()
     RETURNING *`,
    [
      data.projectUuid, data.itemType, data.itemId,
      data.thumbnailUrl, data.imageUrl, data.imageAlt,
      data.imageSource, data.imageSourceUrl ?? null,
      data.imageLicense ?? null, data.imageAttribution ?? null,
      data.isManualUpload ?? false,
      data.storagePath ?? null,
      data.mimeType ?? "image/jpeg",
      data.fileSizeBytes ?? null,
    ],
  );
  return rowToImage(res.rows[0]!);
}

/**
 * Delete an image record (and optionally the storage object).
 * Returns true if a row was deleted.
 */
export async function deleteImage(
  projectUuid: string,
  itemType: string,
  itemId: string,
): Promise<boolean> {
  const res = await pool.query(
    `DELETE FROM ai_platform.id_interior_asset_images
     WHERE project_uuid = $1 AND item_type = $2 AND item_id = $3`,
    [projectUuid, itemType, itemId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Revert an item back to fallback (delete its image record).
 * Same as deleteImage — kept as a named alias for admin intent clarity.
 */
export const revertToFallback = deleteImage;

// ── Enrichment: single item ────────────────────────────────────────────────────

export interface EnrichItemInput {
  projectUuid: string;
  itemType: "material" | "furniture" | "lighting" | "space_plan";
  itemId: string;
  name?: string;
  category?: string;
  materialType?: string;
  style?: string;
  color?: string;
  zone?: string;
  lightingType?: string;
  fixtureType?: string;
}

export interface EnrichItemResult {
  itemId: string;
  itemType: string;
  status: "enriched" | "skipped" | "no_results" | "no_key" | "error";
  thumbnailUrl?: string;
  error?: string;
}

/**
 * Enrich a single item: search Pexels → download → upload → save to DB.
 * Skips if the item already has a manual upload or (force=false) any upload.
 */
export async function enrichItem(
  input: EnrichItemInput,
  opts: { dryRun?: boolean; force?: boolean } = {},
): Promise<EnrichItemResult> {
  const { dryRun = false, force = false } = opts;

  // Check existing
  const existing = await getImage(input.projectUuid, input.itemType, input.itemId);
  if (existing) {
    if (existing.isManualUpload) {
      return { itemId: input.itemId, itemType: input.itemType, status: "skipped" };
    }
    if (!force && existing.thumbnailUrl) {
      return { itemId: input.itemId, itemType: input.itemType, status: "skipped", thumbnailUrl: existing.thumbnailUrl };
    }
  }

  const query = buildSearchQuery(input);
  logger.debug({ query, itemId: input.itemId, itemType: input.itemType }, "[interiorImage] Searching for image");

  const photo = await searchPexels(query);
  if (!photo) {
    const hasKey = Boolean(process.env["PEXELS_API_KEY"]);
    return { itemId: input.itemId, itemType: input.itemType, status: hasKey ? "no_results" : "no_key" };
  }

  if (dryRun) {
    return {
      itemId: input.itemId,
      itemType: input.itemType,
      status: "enriched",
      thumbnailUrl: `[dry-run] ${photo.src.medium}`,
    };
  }

  try {
    const uploaded = await fetchAndUploadPexelsPhoto(photo, input.projectUuid, input.itemType, input.itemId);
    await upsertImage({
      projectUuid:      input.projectUuid,
      itemType:         input.itemType,
      itemId:           input.itemId,
      thumbnailUrl:     uploaded.thumbnailUrl,
      imageUrl:         uploaded.imageUrl,
      imageAlt:         uploaded.imageAlt || `${input.name ?? input.itemType} image`,
      imageSource:      uploaded.imageSource,
      imageSourceUrl:   uploaded.imageSourceUrl,
      imageLicense:     uploaded.imageLicense,
      imageAttribution: uploaded.imageAttribution,
      isManualUpload:   false,
      storagePath:      uploaded.storagePath,
      mimeType:         uploaded.mimeType,
      fileSizeBytes:    uploaded.fileSizeBytes,
    }, force);

    return { itemId: input.itemId, itemType: input.itemType, status: "enriched", thumbnailUrl: uploaded.thumbnailUrl };
  } catch (err) {
    logger.warn({ err, itemId: input.itemId }, "[interiorImage] Enrichment failed");
    return {
      itemId: input.itemId,
      itemType: input.itemType,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Manual upload (admin) ──────────────────────────────────────────────────────

const ADMIN_UPLOAD_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ADMIN_UPLOAD_MAX_BYTES    = 5 * 1024 * 1024; // 5MB

/**
 * Accept a base64 image from admin, validate, upload to Supabase, and save to DB.
 * Manual uploads are protected from auto-overwrite.
 */
export async function adminUploadImage(
  projectUuid: string,
  itemType: string,
  itemId: string,
  base64Data: string,
  mimeType: string,
  altText?: string,
  forceReplace = false,
): Promise<InteriorAssetImage> {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ADMIN_UPLOAD_ALLOWED_MIME.has(mime)) {
    throw Object.assign(new Error(`File type not allowed: ${mime}`), { status: 400 });
  }

  const raw    = base64Data.includes(",") ? base64Data.split(",")[1]! : base64Data;
  const buffer = Buffer.from(raw, "base64");

  if (buffer.byteLength > ADMIN_UPLOAD_MAX_BYTES) {
    throw Object.assign(
      new Error(`File size exceeds limit (${Math.round(buffer.byteLength / 1024 / 1024)}MB > 5MB)`),
      { status: 400 },
    );
  }
  if (buffer.byteLength < 1024) {
    throw Object.assign(new Error("File too small"), { status: 400 });
  }

  await ensureInteriorAssetsBucket();

  const folder   = FOLDER_MAP[itemType] ?? "misc";
  const ext      = mime.includes("webp") ? "webp" : mime.includes("png") ? "png" : "jpg";
  const safeName = safeFilename(`manual-${itemId}-${Date.now()}`);
  const storagePath = `${folder}/${projectUuid}/${safeName}.${ext}`;

  const thumbnailUrl = await uploadToInteriorBucket(storagePath, buffer, mime);

  return upsertImage({
    projectUuid,
    itemType,
    itemId,
    thumbnailUrl,
    imageUrl: thumbnailUrl,
    imageAlt: altText ?? `${itemType} image`,
    imageSource: "manual",
    isManualUpload: true,
    storagePath,
    mimeType: mime,
    fileSizeBytes: buffer.byteLength,
  }, forceReplace);
}
