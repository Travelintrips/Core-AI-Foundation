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

import sharp from "sharp";
import { logger } from "./logger.js";

export const SUPABASE_STORAGE_BUCKET = "ai-assets";

interface SupabaseCredentials {
  url: string;
  serviceKey: string;
}

export interface StorageImageCompressionResult {
  buffer: Buffer;
  contentType: string;
  originalBytes: number;
  storedBytes: number;
  compressed: boolean;
}

export interface PublicInteriorStorageProxyInput {
  projectId: number;
  accessToken: string;
  variantIndex: number;
  buffer: Buffer;
}

export interface PublicInteriorStorageProxyResult {
  publicUrl: string;
  storagePath: string;
  storedBytes: number;
}

function normalizedEnvironmentValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function hasAnyValue(env: NodeJS.ProcessEnv, keys: string[]): boolean {
  return keys.some((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function isProductionStorageEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const nodeEnv = normalizedEnvironmentValue(env["NODE_ENV"]);
  const appEnv = normalizedEnvironmentValue(env["APP_ENV"]);
  if (nodeEnv === "production" || appEnv === "production") return true;

  // Hostinger can occasionally start a process without NODE_ENV while still
  // injecting only production Supabase variables. In that case fail toward the
  // only complete credential set rather than incorrectly selecting DEV keys.
  const hasProd = hasAnyValue(env, [
    "SUPABASE_PROD_DATABASE_URL",
    "SUPABASE_DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_PROD_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_PROD_SECRET_KEY",
  ]);
  const hasDev = hasAnyValue(env, [
    "SUPABASE_DEV_DATABASE_URL",
    "SUPABASE_DATABASE_URL_DEV",
    "SUPABASE_SERVICE_ROLE_KEY_DEV",
    "SUPABASE_DEV_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY_DEV",
    "SUPABASE_DEV_SECRET_KEY",
  ]);

  return hasProd && !hasDev;
}

const COMPRESSIBLE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function compressImageForStorage(
  buffer: Buffer,
  contentType: string,
): Promise<StorageImageCompressionResult> {
  const normalizedType = contentType.split(";")[0]?.trim().toLowerCase() || contentType;
  const originalBytes = buffer.byteLength;

  if (!COMPRESSIBLE_IMAGE_MIME_TYPES.has(normalizedType) || originalBytes === 0) {
    return {
      buffer,
      contentType: normalizedType,
      originalBytes,
      storedBytes: originalBytes,
      compressed: false,
    };
  }

  let encoded: Buffer;
  const base = sharp(buffer, { failOn: "warning" }).rotate();

  if (normalizedType === "image/webp") {
    encoded = await base.webp({ quality: 78, effort: 5, smartSubsample: true }).toBuffer();
  } else if (normalizedType === "image/jpeg") {
    encoded = await base.jpeg({ quality: 82, mozjpeg: true, progressive: true }).toBuffer();
  } else {
    // Keep PNG lossless to avoid damaging diagrams, logos, or proof imagery.
    encoded = await base.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  }

  // Already-optimized images are still compressed inputs. Never replace them
  // with a larger re-encode merely to satisfy the compression pass.
  const useEncoded = encoded.byteLength > 0 && encoded.byteLength < originalBytes;
  const stored = useEncoded ? encoded : buffer;

  return {
    buffer: stored,
    contentType: normalizedType,
    originalBytes,
    storedBytes: stored.byteLength,
    compressed: useEncoded || normalizedType === "image/png" || normalizedType === "image/webp" || normalizedType === "image/jpeg",
  };
}

export async function compressInteriorRenderForStorage(
  buffer: Buffer,
): Promise<StorageImageCompressionResult> {
  const originalBytes = buffer.byteLength;
  if (originalBytes === 0) {
    throw new Error("Interior render image is empty");
  }

  const encoded = await sharp(buffer, { failOn: "warning" })
    .rotate()
    .webp({ quality: 78, effort: 5, smartSubsample: true })
    .toBuffer();

  const sourceIsWebp =
    buffer.byteLength >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 &&
    buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 &&
    buffer[10] === 0x42 && buffer[11] === 0x50;
  const stored = sourceIsWebp && encoded.byteLength >= originalBytes ? buffer : encoded;

  return {
    buffer: stored,
    contentType: "image/webp",
    originalBytes,
    storedBytes: stored.byteLength,
    compressed: true,
  };
}

function supabaseUrlFromProjectRef(projectRef: string | undefined): string | undefined {
  const normalized = projectRef?.trim().toLowerCase();
  return normalized && /^[a-z0-9-]+$/.test(normalized)
    ? `https://${normalized}.supabase.co`
    : undefined;
}

function deriveSupabaseUrlFromDatabaseUrl(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) return undefined;

  // Pooler URLs normally contain the project ref in the username. Extract it
  // from the raw URL first so passwords containing URL-sensitive characters
  // cannot interfere with parsing.
  const poolerRef = databaseUrl.match(/postgres\.([a-z0-9-]+)(?=[:@])/i)?.[1];
  if (poolerRef) return supabaseUrlFromProjectRef(poolerRef);

  const directRef = databaseUrl.match(/db\.([a-z0-9-]+)\.supabase\.co/i)?.[1];
  if (directRef) return supabaseUrlFromProjectRef(directRef);

  try {
    const parsed = new URL(databaseUrl);
    const decodedUser = decodeURIComponent(parsed.username || "");
    const usernameRef = decodedUser.match(/^postgres\.([a-z0-9-]+)$/i)?.[1];
    if (usernameRef) return supabaseUrlFromProjectRef(usernameRef);

    const directHost = parsed.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i);
    if (directHost?.[1]) return supabaseUrlFromProjectRef(directHost[1]);
  } catch {
    return undefined;
  }

  return undefined;
}

function deriveSupabaseUrlFromLegacyJwt(apiKey: string | undefined): string | undefined {
  if (!apiKey || apiKey.split(".").length !== 3) return undefined;

  try {
    const payload = apiKey.split(".")[1];
    if (!payload) return undefined;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      ref?: unknown;
    };
    return typeof parsed.ref === "string"
      ? supabaseUrlFromProjectRef(parsed.ref)
      : undefined;
  } catch {
    return undefined;
  }
}

function getSupabaseBridgeProjectUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const isProduction = isProductionStorageEnvironment(env);
  const databaseUrl = isProduction
    ? env["SUPABASE_PROD_DATABASE_URL"] || env["SUPABASE_DATABASE_URL"]
    : env["SUPABASE_DEV_DATABASE_URL"] || env["SUPABASE_DATABASE_URL_DEV"];
  const anonKey = isProduction
    ? env["SUPABASE_ANON_KEY"] || env["VITE_SUPABASE_ANON_KEY"]
    : env["SUPABASE_ANON_KEY_DEV"] || env["VITE_SUPABASE_ANON_KEY_DEV"];
  const explicitUrl = isProduction
    ? env["SUPABASE_URL"] ||
      env["SUPABASE_PROD_URL"] ||
      env["VITE_SUPABASE_URL"] ||
      env["NEXT_PUBLIC_SUPABASE_URL"]
    : env["SUPABASE_URL_DEV"] ||
      env["SUPABASE_DEV_URL"] ||
      env["VITE_SUPABASE_URL_DEV"];
  const projectRef = isProduction
    ? env["SUPABASE_PROD_PROJECT_REF"] || env["SUPABASE_PROJECT_REF"]
    : env["SUPABASE_DEV_PROJECT_REF"] || env["SUPABASE_PROJECT_REF"];

  const url = (
    isProduction
      ? deriveSupabaseUrlFromDatabaseUrl(databaseUrl) ||
        supabaseUrlFromProjectRef(projectRef) ||
        explicitUrl ||
        deriveSupabaseUrlFromLegacyJwt(anonKey)
      : explicitUrl ||
        deriveSupabaseUrlFromDatabaseUrl(databaseUrl) ||
        supabaseUrlFromProjectRef(projectRef) ||
        deriveSupabaseUrlFromLegacyJwt(anonKey)
  )?.replace(/\/$/, "");

  if (!url) {
    throw new Error(
      "Supabase project URL is unavailable for the Interior render storage bridge",
    );
  }
  return url;
}

function getCredentials(): SupabaseCredentials {
  const isProduction = isProductionStorageEnvironment(process.env);

  const databaseUrl = isProduction
    ? process.env["SUPABASE_PROD_DATABASE_URL"] || process.env["SUPABASE_DATABASE_URL"]
    : process.env["SUPABASE_DEV_DATABASE_URL"] || process.env["SUPABASE_DATABASE_URL_DEV"];

  const serviceKey = isProduction
    ? process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
      process.env["SUPABASE_PROD_SERVICE_ROLE_KEY"] ||
      process.env["SUPABASE_SECRET_KEY"] ||
      process.env["SUPABASE_PROD_SECRET_KEY"]
    : process.env["SUPABASE_SERVICE_ROLE_KEY_DEV"] ||
      process.env["SUPABASE_DEV_SERVICE_ROLE_KEY"] ||
      process.env["SUPABASE_SECRET_KEY_DEV"] ||
      process.env["SUPABASE_DEV_SECRET_KEY"];

  const anonKey = isProduction
    ? process.env["SUPABASE_ANON_KEY"] || process.env["VITE_SUPABASE_ANON_KEY"]
    : process.env["SUPABASE_ANON_KEY_DEV"] || process.env["VITE_SUPABASE_ANON_KEY_DEV"];

  const explicitUrl = isProduction
    ? process.env["SUPABASE_URL"] ||
      process.env["SUPABASE_PROD_URL"] ||
      process.env["VITE_SUPABASE_URL"] ||
      process.env["NEXT_PUBLIC_SUPABASE_URL"]
    : process.env["SUPABASE_URL_DEV"] ||
      process.env["SUPABASE_DEV_URL"] ||
      process.env["VITE_SUPABASE_URL_DEV"];

  const projectRef = isProduction
    ? process.env["SUPABASE_PROD_PROJECT_REF"] || process.env["SUPABASE_PROJECT_REF"]
    : process.env["SUPABASE_DEV_PROJECT_REF"] || process.env["SUPABASE_PROJECT_REF"];

  const databaseDerivedUrl = deriveSupabaseUrlFromDatabaseUrl(databaseUrl);
  const serviceKeyDerivedUrl = deriveSupabaseUrlFromLegacyJwt(serviceKey);
  const anonKeyDerivedUrl = deriveSupabaseUrlFromLegacyJwt(anonKey);
  const projectRefUrl = supabaseUrlFromProjectRef(projectRef);

  // Production prefers server-authenticated sources over frontend metadata.
  // This also recovers Hostinger deployments that have the DB + service-role
  // credentials but omit a separate SUPABASE_URL variable.
  const url = (
    isProduction
      ? databaseDerivedUrl ||
        serviceKeyDerivedUrl ||
        projectRefUrl ||
        explicitUrl ||
        anonKeyDerivedUrl
      : explicitUrl ||
        databaseDerivedUrl ||
        serviceKeyDerivedUrl ||
        projectRefUrl ||
        anonKeyDerivedUrl
  )?.replace(/\/$/, "");

  if (!url || !serviceKey) {
    const missing = [
      !url ? "Supabase project URL" : null,
      !serviceKey ? "service-role key" : null,
    ].filter(Boolean).join(" and ");
    throw new Error(
      `Supabase Storage credentials incomplete: missing ${missing}. ` +
      "The project URL may be set explicitly or derived from the database connection string.",
    );
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

  // Every supported image entering ai-assets passes through the compression
  // gate before upload. Non-image payloads are left byte-for-byte unchanged.
  const prepared = await compressImageForStorage(buffer, contentType);

  // Remove leading slash if any
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;

  const uploadUrl = `${url}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${cleanPath}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      ...authHeaders(serviceKey),
      "Content-Type": prepared.contentType,
      "x-upsert": "true", // overwrite if exists
      "cache-control": "31536000",
    },
    body: prepared.buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Storage upload failed (${res.status}): ${text}`);
  }

  if (COMPRESSIBLE_IMAGE_MIME_TYPES.has(prepared.contentType)) {
    logger.info(
      {
        path: cleanPath,
        contentType: prepared.contentType,
        originalBytes: prepared.originalBytes,
        storedBytes: prepared.storedBytes,
        savingsBytes: Math.max(0, prepared.originalBytes - prepared.storedBytes),
      },
      "[supabaseStorage] Image compression gate passed before upload",
    );
  }

  return getSupabasePublicUrl(path);
}

/**
 * Upload a public Interior Design render through the production Supabase Edge
 * Function when the web runtime intentionally has no Supabase admin key.
 *
 * The Edge Function validates the token against the token-owned project and
 * writes only to a deterministic project/variant path. Only compressed WebP
 * bytes leave this API host.
 */
export async function uploadPublicInteriorRenderViaEdge(
  input: PublicInteriorStorageProxyInput,
): Promise<PublicInteriorStorageProxyResult> {
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
    throw new Error("Invalid public Interior Design project id");
  }
  if (!Number.isInteger(input.variantIndex) || input.variantIndex < 0 || input.variantIndex > 3) {
    throw new Error("Invalid public Interior Design variant index");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.accessToken)) {
    throw new Error("Invalid public Interior Design access token");
  }

  const prepared = await compressInteriorRenderForStorage(input.buffer);
  const projectUrl = getSupabaseBridgeProjectUrl(process.env);
  const response = await fetch(
    `${projectUrl}/functions/v1/interior-render-storage`,
    {
      method: "POST",
      headers: {
        "Content-Type": prepared.contentType,
        "x-interior-project-id": String(input.projectId),
        "x-interior-access-token": input.accessToken,
        "x-interior-variant-index": String(input.variantIndex),
      },
      body: prepared.buffer,
      signal: AbortSignal.timeout(30_000),
    },
  );

  const responseText = await response.text();
  let result: {
    publicUrl?: string;
    path?: string;
    storedBytes?: number;
    error?: string;
  } = {};
  try {
    result = responseText ? JSON.parse(responseText) as typeof result : {};
  } catch {
    // Keep parse failures generic and never include request auth headers.
  }

  if (!response.ok || !result.publicUrl || !result.path) {
    throw new Error(
      `Supabase Interior render storage bridge failed (HTTP ${response.status}): ${result.error ?? "unknown"}`,
    );
  }

  return {
    publicUrl: result.publicUrl,
    storagePath: result.path,
    storedBytes:
      typeof result.storedBytes === "number" && result.storedBytes >= 0
        ? result.storedBytes
        : prepared.storedBytes,
  };
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
 * Check whether a storage object exists in Supabase without downloading it.
 * Uses a HEAD request — no data transfer.
 * Returns false for network errors (treated as "not found" to prevent false positives).
 */
export async function storageObjectExists(path: string): Promise<boolean> {
  try {
    const { url, serviceKey } = getCredentials();
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;

    const res = await fetch(
      `${url}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${cleanPath}`,
      {
        method: "HEAD",
        headers: authHeaders(serviceKey),
      }
    );

    return res.ok; // 200 = exists; 404/403/etc = does not exist
  } catch (err) {
    logger.warn({ err, path }, "[supabaseStorage] storageObjectExists check failed — treating as missing");
    return false;
  }
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
  try {
    getCredentials();
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload a base64-encoded payment proof image to Supabase Storage.
 * @deprecated Use uploadPrivatePaymentProof instead — this writes to the public bucket.
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

// ── Private payment proof storage ─────────────────────────────────────────────

export const PAYMENT_PROOF_PRIVATE_BUCKET = "payment-proofs";

/** MIME types accepted for payment proofs (server-side allowlist). */
export const PAYMENT_PROOF_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/** Max proof file size in bytes (5 MB). */
export const PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Ensure the private `payment-proofs` bucket exists.
 * Public = false so files are NOT accessible via public CDN URL.
 */
export async function ensurePrivatePaymentBucket(): Promise<void> {
  const { url, serviceKey } = getCredentials();

  const listRes = await fetch(`${url}/storage/v1/bucket`, {
    headers: authHeaders(serviceKey),
  });
  if (!listRes.ok) {
    logger.warn({ status: listRes.status }, "[supabaseStorage] Could not list buckets for private payment check");
    return;
  }
  const buckets = (await listRes.json()) as Array<{ id: string; name: string }>;
  if (buckets.some((b) => b.name === PAYMENT_PROOF_PRIVATE_BUCKET)) return;

  const createRes = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
    body: JSON.stringify({
      id: PAYMENT_PROOF_PRIVATE_BUCKET,
      name: PAYMENT_PROOF_PRIVATE_BUCKET,
      public: false, // PRIVATE — no public CDN access
      file_size_limit: PAYMENT_PROOF_MAX_BYTES * 2,
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    logger.warn({ status: createRes.status, body: text }, "[supabaseStorage] Could not create private payment-proofs bucket — may already exist");
  } else {
    logger.info("[supabaseStorage] Created private bucket: payment-proofs");
  }
}

/**
 * Upload a payment proof to the private `payment-proofs` bucket.
 * Path: payment-proofs/{projectUuid}/{scheduleId}/{uuid}.{ext}
 * Returns the STORAGE PATH (not a URL). Use getPaymentProofSignedUrl() to serve it.
 */
export async function uploadPrivatePaymentProof(
  base64Data: string,
  mimeType: string,
  projectUuid: string,
  scheduleId: string | number,
): Promise<string> {
  if (!PAYMENT_PROOF_ALLOWED_MIME.has(mimeType)) {
    throw new Error(`Tipe file tidak diizinkan: ${mimeType}`);
  }

  const raw = base64Data.includes(",") ? base64Data.split(",")[1]! : base64Data;
  const buffer = Buffer.from(raw, "base64");

  if (buffer.byteLength > PAYMENT_PROOF_MAX_BYTES) {
    throw new Error(`Ukuran file melebihi batas ${PAYMENT_PROOF_MAX_BYTES / 1024 / 1024}MB`);
  }

  const ext = mimeType.includes("png") ? "png"
    : mimeType.includes("webp") ? "webp"
    : mimeType.includes("pdf") ? "pdf"
    : "jpg";

  // UUID-named file to prevent enumeration/overwrite
  const uuid = crypto.randomUUID();
  const storagePath = `${projectUuid}/${scheduleId}/${uuid}.${ext}`;

  const { url, serviceKey } = getCredentials();
  const cleanPath = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;
  const uploadUrl = `${url}/storage/v1/object/${PAYMENT_PROOF_PRIVATE_BUCKET}/${cleanPath}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      ...authHeaders(serviceKey),
      "Content-Type": mimeType,
      "x-upsert": "false", // never silently overwrite
    },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Private storage upload failed (${res.status}): ${text}`);
  }

  return storagePath; // caller stores this path in DB
}

/**
 * Generate a short-lived signed URL for a private payment proof.
 * @param storagePath   The path stored in the DB (e.g. "uuid/123/file.jpg")
 * @param expiresIn     Seconds until expiry (default 3600 = 1 hour)
 */
export async function getPaymentProofSignedUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string> {
  const { url, serviceKey } = getCredentials();
  const cleanPath = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;

  const res = await fetch(
    `${url}/storage/v1/object/sign/${PAYMENT_PROOF_PRIVATE_BUCKET}/${cleanPath}`,
    {
      method: "POST",
      headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to generate signed URL (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const signedUrl = data.signedURL ?? data.signedUrl;
  if (!signedUrl) throw new Error("Supabase did not return a signedURL");

  // signedUrl is a relative path — prefix with Supabase base URL
  return signedUrl.startsWith("http") ? signedUrl : `${url}${signedUrl}`;
}

/**
 * Delete a file from the private payment-proofs bucket.
 * Used for orphan cleanup when a DB write fails after upload.
 */
export async function deletePrivatePaymentProof(storagePath: string): Promise<void> {
  const { url, serviceKey } = getCredentials();
  const cleanPath = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;

  const res = await fetch(
    `${url}/storage/v1/object/${PAYMENT_PROOF_PRIVATE_BUCKET}/${cleanPath}`,
    { method: "DELETE", headers: authHeaders(serviceKey) },
  );

  if (!res.ok) {
    logger.warn({ status: res.status, path: storagePath }, "[supabaseStorage] Failed to delete orphan payment proof");
  }
}

/**
 * True if the given proof URL/path is a legacy public URL
 * (stored before private-bucket migration).
 */
export function isLegacyPublicProofUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}
