/**
 * Supabase Storage client — implemented as direct REST API calls via fetch.
 *
 * Uses the Supabase Storage REST API directly instead of the @supabase/supabase-js
 * SDK to avoid the WebSocket/Node.js 22 requirement that the SDK imposes.
 *
 * Bucket: ai-assets (public)
 * Public URL pattern:
 *   {SUPABASE_URL}/storage/v1/object/public/ai-assets/{path}
 *
 * Picks dev vs prod Supabase project based on NODE_ENV.
 */

import { logger } from "./logger.js";

export const SUPABASE_STORAGE_BUCKET = "ai-assets";

interface SupabaseCredentials {
  url: string;
  serviceKey: string;
}

function getCredentials(): SupabaseCredentials {
  const isDev = process.env["NODE_ENV"] !== "production";
  const url = isDev
    ? process.env["SUPABASE_URL_DEV"]
    : process.env["SUPABASE_URL"];
  const serviceKey = isDev
    ? process.env["SUPABASE_SERVICE_ROLE_KEY_DEV"]
    : process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url || !serviceKey) {
    const env = isDev ? "SUPABASE_URL_DEV + SUPABASE_SERVICE_ROLE_KEY_DEV" : "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY";
    throw new Error(`Supabase Storage credentials not configured. Expected: ${env}`);
  }
  return { url, serviceKey };
}

function authHeaders(serviceKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
  };
}

/**
 * Ensure the `ai-assets` bucket exists and is public.
 * Safe to call repeatedly — no-ops if bucket already exists.
 */
export async function ensureStorageBucket(): Promise<void> {
  const { url, serviceKey } = getCredentials();

  // Check if bucket exists
  const listRes = await fetch(`${url}/storage/v1/bucket`, {
    headers: authHeaders(serviceKey),
  });

  if (!listRes.ok) {
    const text = await listRes.text();
    logger.warn({ status: listRes.status, body: text }, "[supabaseStorage] Could not list buckets");
    return;
  }

  const buckets = (await listRes.json()) as Array<{ id: string; name: string }>;
  const exists = buckets.some((b) => b.name === SUPABASE_STORAGE_BUCKET);

  if (!exists) {
    const createRes = await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
      body: JSON.stringify({
        id: SUPABASE_STORAGE_BUCKET,
        name: SUPABASE_STORAGE_BUCKET,
        public: true,
        file_size_limit: 52428800, // 50 MB
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`Failed to create Supabase Storage bucket: ${createRes.status} ${text}`);
    }
    logger.info("[supabaseStorage] Created public bucket: ai-assets");
  } else {
    logger.info("[supabaseStorage] Bucket ai-assets already exists");
  }
}

/**
 * Upload a buffer to Supabase Storage.
 * Returns the permanent public CDN URL.
 */
export async function uploadToSupabase(
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const { url, serviceKey } = getCredentials();

  // Remove leading slash if any
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;

  const uploadUrl = `${url}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${cleanPath}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      ...authHeaders(serviceKey),
      "Content-Type": contentType,
      "x-upsert": "true", // overwrite if exists
    },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Storage upload failed (${res.status}): ${text}`);
  }

  return getSupabasePublicUrl(path);
}

/**
 * Download a file from Supabase Storage by its storage path.
 * Returns a Buffer of the file contents.
 */
export async function downloadFromSupabase(path: string): Promise<Buffer> {
  const { url, serviceKey } = getCredentials();
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;

  const res = await fetch(
    `${url}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${cleanPath}`,
    { headers: authHeaders(serviceKey) }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Storage download failed (${res.status}): ${text}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Get the permanent public CDN URL for a storage path.
 * Does not make a network call — constructs URL from env config.
 */
export function getSupabasePublicUrl(path: string): string {
  const { url } = getCredentials();
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${url}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${cleanPath}`;
}

/**
 * True if Supabase Storage credentials are configured in this environment.
 */
export function isSupabaseStorageAvailable(): boolean {
  const isDev = process.env["NODE_ENV"] !== "production";
  const url = isDev ? process.env["SUPABASE_URL_DEV"] : process.env["SUPABASE_URL"];
  const key = isDev
    ? process.env["SUPABASE_SERVICE_ROLE_KEY_DEV"]
    : process.env["SUPABASE_SERVICE_ROLE_KEY"];
  return Boolean(url && key);
}

/**
 * Upload a base64-encoded payment proof image to Supabase Storage.
 * Stored under payment-proofs/<scheduleId>-<timestamp>.<ext>
 * Returns the permanent public CDN URL.
 */
export async function uploadPaymentProofImage(
  base64Data: string,
  mimeType: string,
  scheduleId: string | number
): Promise<string> {
  // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
  const raw = base64Data.includes(",") ? base64Data.split(",")[1]! : base64Data;
  const buffer = Buffer.from(raw, "base64");
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const path = `payment-proofs/${scheduleId}-${Date.now()}.${ext}`;
  return uploadToSupabase(path, buffer, mimeType);
}
