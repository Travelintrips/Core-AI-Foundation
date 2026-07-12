import type { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { logger } from "../lib/logger.js";
import { objectStorageClient } from "../lib/objectStorage.js";

const BUCKET_ID = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";
export const STORAGE_PROVIDER = "gcs";

// Reuse the Replit-sidecar-authenticated GCS client (see lib/objectStorage.ts) —
// a bare `new Storage()` has no credentials in this environment and fails with
// "Could not load the default credentials."
function gcs(): Storage {
  return objectStorageClient;
}

async function uploadBuffer(objectPath: string, buf: Buffer, contentType: string): Promise<void> {
  if (!BUCKET_ID) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  const bucket = gcs().bucket(BUCKET_ID);
  await bucket.file(objectPath).save(buf, { metadata: { contentType }, resumable: false });
}

function toApiUrl(objectPath: string): string {
  // objectPath is always under public/... — strip that prefix for the API route.
  return `/storage/public-objects/${objectPath.replace(/^public\//, "")}`;
}

/**
 * Download an image URL (Replicate delivery or any HTTP source) and upload it
 * to GCS under `public/demo-portfolios/<brandSlug>/<role>-<ts>.<ext>`.
 *
 * The `public/` prefix aligns with PUBLIC_OBJECT_SEARCH_PATHS so the storage
 * route can serve the file at:
 *   GET /api/storage/public-objects/demo-portfolios/<brandSlug>/<filename>
 *
 * Returns the permanent API-relative URL and GCS path, or the original URL
 * on graceful degradation.
 */
export async function archiveReplicateAsset(opts: {
  sourceUrl: string;
  brandSlug: string;
  role: string;
  mimeType?: string;
}): Promise<{ permanentUrl: string; storagePath: string | null; storageProvider: string | null; storageBucket: string | null }> {
  const { sourceUrl, brandSlug, role, mimeType = "image/webp" } = opts;

  if (!BUCKET_ID) {
    throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — cannot archive asset");
  }

  const ext = mimeType === "image/png" ? "png" : "webp";
  const filename = `${role}-${Date.now()}.${ext}`;
  // GCS object path — must live under public/ so PUBLIC_OBJECT_SEARCH_PATHS resolves it
  const gcsObjectPath = `public/demo-portfolios/${brandSlug}/${filename}`;
  const permanentUrl = toApiUrl(gcsObjectPath);

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${sourceUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());

  await uploadBuffer(gcsObjectPath, buf, mimeType);

  logger.info({ gcsObjectPath, brandSlug, role }, "[portfolioStorage] asset archived to GCS");
  return { permanentUrl, storagePath: gcsObjectPath, storageProvider: STORAGE_PROVIDER, storageBucket: BUCKET_ID };
}

/**
 * Re-encode an already-archived original into a smaller, web-optimized WebP
 * master (used by the `optimize_asset` background job). Uploads alongside the
 * original under the same brand-slug prefix.
 */
export async function optimizeArchivedAsset(opts: {
  sourceStoragePath: string; // GCS path of the archived original (public/...)
  brandSlug: string;
  role: string;
}): Promise<{ permanentUrl: string; storagePath: string; width: number | null; height: number | null }> {
  if (!BUCKET_ID) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — cannot optimize asset");

  const bucket = gcs().bucket(BUCKET_ID);
  const [buf] = await bucket.file(opts.sourceStoragePath).download();

  const image = sharp(buf).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 });
  const optimizedBuf = await image.toBuffer();
  const meta = await sharp(optimizedBuf).metadata();

  const filename = `${opts.role}-optimized-${Date.now()}.webp`;
  const objectPath = `public/demo-portfolios/${opts.brandSlug}/${filename}`;
  await uploadBuffer(objectPath, optimizedBuf, "image/webp");

  return { permanentUrl: toApiUrl(objectPath), storagePath: objectPath, width: meta.width ?? null, height: meta.height ?? null };
}

/**
 * Generate a small gallery-grid thumbnail (400px, WebP) from an already-archived
 * original (used by the `generate_thumbnail` background job).
 */
export async function generateAssetThumbnail(opts: {
  sourceStoragePath: string; // GCS path of the archived original (public/...)
  brandSlug: string;
  role: string;
}): Promise<{ permanentUrl: string; storagePath: string }> {
  if (!BUCKET_ID) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — cannot generate thumbnail");

  const bucket = gcs().bucket(BUCKET_ID);
  const [buf] = await bucket.file(opts.sourceStoragePath).download();

  const thumbBuf = await sharp(buf).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();

  const filename = `${opts.role}-thumb-${Date.now()}.webp`;
  const objectPath = `public/demo-portfolios/${opts.brandSlug}/${filename}`;
  await uploadBuffer(objectPath, thumbBuf, "image/webp");

  return { permanentUrl: toApiUrl(objectPath), storagePath: objectPath };
}
