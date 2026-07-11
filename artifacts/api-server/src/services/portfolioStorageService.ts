import { Storage } from "@google-cloud/storage";
import { logger } from "../lib/logger.js";

const BUCKET_ID = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";

let _gcs: Storage | null = null;
function gcs(): Storage {
  if (!_gcs) {
    _gcs = new Storage();
  }
  return _gcs;
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
}): Promise<{ permanentUrl: string; storagePath: string | null }> {
  const { sourceUrl, brandSlug, role, mimeType = "image/webp" } = opts;

  if (!BUCKET_ID) {
    logger.warn("[portfolioStorage] DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — skipping archive");
    return { permanentUrl: sourceUrl, storagePath: null };
  }

  const ext = mimeType === "image/png" ? "png" : "webp";
  const filename = `${role}-${Date.now()}.${ext}`;
  // GCS object path — must live under public/ so PUBLIC_OBJECT_SEARCH_PATHS resolves it
  const gcsObjectPath = `public/demo-portfolios/${brandSlug}/${filename}`;
  // API-relative URL served by the /storage/public-objects/* route
  const permanentUrl = `/storage/public-objects/demo-portfolios/${brandSlug}/${filename}`;

  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${sourceUrl}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const bucket = gcs().bucket(BUCKET_ID);
    const file = bucket.file(gcsObjectPath);
    await file.save(buf, {
      metadata: { contentType: mimeType },
      resumable: false,
    });

    logger.info({ gcsObjectPath, brandSlug, role }, "[portfolioStorage] asset archived to GCS");
    return { permanentUrl, storagePath: gcsObjectPath };
  } catch (err) {
    logger.error({ err, sourceUrl, gcsObjectPath }, "[portfolioStorage] archive failed — using original URL");
    return { permanentUrl: sourceUrl, storagePath: null };
  }
}

/**
 * Archive all completed assets for a portfolio in parallel.
 * Returns an array (same order as input) of permanent URL + storage path pairs.
 */
export async function archivePortfolioAssets(
  brandSlug: string,
  assets: Array<{
    role: string;
    status: string;
    imageUrl: string | null;
    [key: string]: unknown;
  }>,
): Promise<Array<{ permanentUrl: string | null; storagePath: string | null }>> {
  return Promise.all(
    assets.map(async (a) => {
      if (a.status !== "completed" || !a.imageUrl) {
        return { permanentUrl: a.imageUrl ?? null, storagePath: null };
      }
      if (!a.imageUrl.includes("replicate.delivery") && !a.imageUrl.startsWith("http")) {
        return { permanentUrl: a.imageUrl, storagePath: null };
      }
      return archiveReplicateAsset({
        sourceUrl: a.imageUrl,
        brandSlug,
        role: a.role,
      });
    }),
  );
}
