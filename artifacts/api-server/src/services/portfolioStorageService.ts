/**
 * Portfolio asset storage — backed by Supabase Storage.
 *
 * Storage path conventions (Sprint P3):
 *   NEW preferred: demo-portfolios/{portfolioId}/{assetId}/original.{ext}
 *                  demo-portfolios/{portfolioId}/{assetId}/preview.webp
 *                  demo-portfolios/{portfolioId}/{assetId}/thumb.webp
 *   LEGACY compat: demo-portfolios/{brandSlug}/{role}-{timestamp}.{ext}
 *
 * Public URL pattern:
 *   https://<project>.supabase.co/storage/v1/object/public/ai-assets/demo-portfolios/...
 *
 * Asset purpose policy (Sprint P3):
 *   demo_portfolio → permanent, public CDN, no expiry — stored here
 *   live_preview   → temporary, base64 only, expires 1 h — NEVER stored here
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
 * and upload it to Supabase Storage.
 *
 * Sprint P3: when portfolioId + assetId are provided, uses deterministic
 * ID-based paths (no timestamp collision, always overrideable):
 *   demo-portfolios/{portfolioId}/{assetId}/original.{ext}
 *
 * Legacy fallback (in-flight jobs without new payload fields):
 *   demo-portfolios/{brandSlug}/{role}-{timestamp}.{ext}
 */
export async function archiveReplicateAsset(opts: {
  sourceUrl: string;
  // Sprint P3 preferred — deterministic, ID-based
  portfolioId?: number;
  assetId?: number;
  // Legacy fallback for in-flight queue jobs
  brandSlug?: string;
  role?: string;
  mimeType?: string;
}): Promise<{
  permanentUrl: string;
  storagePath: string | null;
  storageProvider: string | null;
  storageBucket: string | null;
}> {
  const { sourceUrl, portfolioId, assetId, brandSlug = "unknown", role = "asset", mimeType = "image/webp" } = opts;

  const ext = mimeType === "image/png" ? "png" : "webp";

  // Prefer ID-based path — deterministic, no timestamp collision
  const storagePath = (portfolioId != null && assetId != null)
    ? `demo-portfolios/${portfolioId}/${assetId}/original.${ext}`
    : `demo-portfolios/${brandSlug}/${role}-${Date.now()}.${ext}`;

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${sourceUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const permanentUrl = await uploadToSupabase(storagePath, buf, mimeType);

  logger.info(
    { storagePath, portfolioId, assetId, brandSlug, role, permanentUrl },
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
 *
 * Sprint P3 path: demo-portfolios/{portfolioId}/{assetId}/preview.webp
 * Legacy path:    demo-portfolios/{brandSlug}/{role}-optimized-{timestamp}.webp
 */
export async function optimizeArchivedAsset(opts: {
  sourceStoragePath: string;
  portfolioId?: number;
  assetId?: number;
  brandSlug?: string;
  role?: string;
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

  const storagePath = (opts.portfolioId != null && opts.assetId != null)
    ? `demo-portfolios/${opts.portfolioId}/${opts.assetId}/preview.webp`
    : `demo-portfolios/${opts.brandSlug ?? "unknown"}/${opts.role ?? "asset"}-optimized-${Date.now()}.webp`;

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
 *
 * Sprint P3 path: demo-portfolios/{portfolioId}/{assetId}/thumb.webp
 * Legacy path:    demo-portfolios/{brandSlug}/{role}-thumb-{timestamp}.webp
 */
export async function generateAssetThumbnail(opts: {
  sourceStoragePath: string;
  portfolioId?: number;
  assetId?: number;
  brandSlug?: string;
  role?: string;
}): Promise<{ permanentUrl: string; storagePath: string }> {
  const buf = await downloadFromSupabase(opts.sourceStoragePath);

  const thumbBuf = await sharp(buf)
    .resize({ width: 400, withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();

  const storagePath = (opts.portfolioId != null && opts.assetId != null)
    ? `demo-portfolios/${opts.portfolioId}/${opts.assetId}/thumb.webp`
    : `demo-portfolios/${opts.brandSlug ?? "unknown"}/${opts.role ?? "asset"}-thumb-${Date.now()}.webp`;

  const permanentUrl = await uploadToSupabase(storagePath, thumbBuf, "image/webp");

  return { permanentUrl, storagePath };
}
