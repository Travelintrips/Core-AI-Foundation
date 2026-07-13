/**
 * Portfolio asset storage — backed by Supabase Storage.
 *
 * All generated images (logo concepts, color palettes, brand visuals)
 * are uploaded to the public `ai-assets` bucket and served directly
 * via Supabase CDN. No proxy through the API server is needed.
 *
 * Storage path pattern:
 *   demo-portfolios/<brandSlug>/<role>-<timestamp>.<ext>
 *
 * Public URL pattern:
 *   https://<project>.supabase.co/storage/v1/object/public/ai-assets/demo-portfolios/...
 */

import sharp from "sharp";
import { logger } from "../lib/logger.js";
import {
  uploadToSupabase,
  downloadFromSupabase,
} from "../lib/supabaseStorage.js";

export const STORAGE_PROVIDER = "supabase";

/**
 * Download an image from a URL (Replicate delivery or any HTTP source)
 * and upload it to Supabase Storage under demo-portfolios/<brandSlug>/.
 *
 * Returns the permanent Supabase CDN URL and storage path.
 */
export async function archiveReplicateAsset(opts: {
  sourceUrl: string;
  brandSlug: string;
  role: string;
  mimeType?: string;
}): Promise<{
  permanentUrl: string;
  storagePath: string | null;
  storageProvider: string | null;
  storageBucket: string | null;
}> {
  const { sourceUrl, brandSlug, role, mimeType = "image/webp" } = opts;

  const ext = mimeType === "image/png" ? "png" : "webp";
  const filename = `${role}-${Date.now()}.${ext}`;
  const storagePath = `demo-portfolios/${brandSlug}/${filename}`;

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${sourceUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const permanentUrl = await uploadToSupabase(storagePath, buf, mimeType);

  logger.info(
    { storagePath, brandSlug, role, permanentUrl },
    "[portfolioStorage] asset archived to Supabase Storage"
  );

  return {
    permanentUrl,
    storagePath,
    storageProvider: STORAGE_PROVIDER,
    storageBucket: "ai-assets",
  };
}

/**
 * Re-encode an already-archived original into a smaller, web-optimized WebP
 * (used by the `optimize_asset` background job).
 * Downloads from Supabase, re-processes with Sharp, and re-uploads.
 */
export async function optimizeArchivedAsset(opts: {
  sourceStoragePath: string; // Supabase storage path of the archived original
  brandSlug: string;
  role: string;
}): Promise<{
  permanentUrl: string;
  storagePath: string;
  width: number | null;
  height: number | null;
}> {
  const buf = await downloadFromSupabase(opts.sourceStoragePath);

  const image = sharp(buf).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 });
  const optimizedBuf = await image.toBuffer();
  const meta = await sharp(optimizedBuf).metadata();

  const filename = `${opts.role}-optimized-${Date.now()}.webp`;
  const storagePath = `demo-portfolios/${opts.brandSlug}/${filename}`;
  const permanentUrl = await uploadToSupabase(storagePath, optimizedBuf, "image/webp");

  return {
    permanentUrl,
    storagePath,
    width: meta.width ?? null,
    height: meta.height ?? null,
  };
}

/**
 * Generate a small gallery-grid thumbnail (400px, WebP) from an already-archived
 * original (used by the `generate_thumbnail` background job).
 */
export async function generateAssetThumbnail(opts: {
  sourceStoragePath: string; // Supabase storage path of the archived original
  brandSlug: string;
  role: string;
}): Promise<{ permanentUrl: string; storagePath: string }> {
  const buf = await downloadFromSupabase(opts.sourceStoragePath);

  const thumbBuf = await sharp(buf)
    .resize({ width: 400, withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();

  const filename = `${opts.role}-thumb-${Date.now()}.webp`;
  const storagePath = `demo-portfolios/${opts.brandSlug}/${filename}`;
  const permanentUrl = await uploadToSupabase(storagePath, thumbBuf, "image/webp");

  return { permanentUrl, storagePath };
}
