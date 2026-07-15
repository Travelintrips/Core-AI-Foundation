/**
 * Design Renderer — Image Resolver with SSRF Protection
 *
 * Resolves AssetReference objects to validated image buffers.
 * All remote fetches are guarded against SSRF and content-type abuse.
 */

import { createHash } from "crypto";
import { validateExternalUrl } from "../../middleware/ssrfGuard.js";
import { uploadToSupabase, SUPABASE_STORAGE_BUCKET } from "../../lib/supabaseStorage.js";
import { RenderError } from "./errors.js";
import { AssetCache } from "./assetCache.js";
import { renderConfig } from "./config.js";
import type { AssetReference } from "../../types/designTemplate.js";
import { logger } from "../../lib/logger.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

// Magic bytes for MIME validation
function detectMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "image/webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  const head = buf.slice(0, 256).toString("utf8");
  if (head.includes("<svg") || head.includes("<?xml")) return "image/svg+xml";
  return null;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemoteImage(
  url: string,
  cache: AssetCache,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  // Check SSRF
  const ssrfResult = validateExternalUrl(url);
  if (!ssrfResult.valid) {
    throw new RenderError("SSRF_BLOCKED", `Remote image URL blocked: ${ssrfResult.reason}`);
  }

  // Check cache
  const cached = cache.get(url);
  if (cached) return { buffer: cached.buffer, mimeType: cached.mimeType };

  let response: Response;
  try {
    response = await fetchWithTimeout(url, timeoutMs);
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (isAbort) throw new RenderError("ASSET_FETCH_TIMEOUT", `Image fetch timed out: ${url}`);
    throw new RenderError("ASSET_FETCH_FAILED", `Image fetch failed: ${url}`);
  }

  if (!response.ok) {
    throw new RenderError("ASSET_FETCH_FAILED", `Image fetch returned ${response.status}: ${url}`);
  }

  // Validate redirect target (fetch follows redirects, but we re-check final URL)
  const finalUrl = response.url;
  if (finalUrl !== url) {
    const redirectCheck = validateExternalUrl(finalUrl);
    if (!redirectCheck.valid) {
      throw new RenderError("SSRF_BLOCKED", `Image redirect to blocked URL: ${redirectCheck.reason}`);
    }
  }

  // Limit response size
  const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
  if (contentLength > maxBytes) {
    throw new RenderError("ASSET_TOO_LARGE", `Image exceeds size limit (${contentLength} > ${maxBytes})`);
  }

  const arrayBuf = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  if (buffer.length > maxBytes) {
    throw new RenderError("ASSET_TOO_LARGE", `Image body exceeds size limit (${buffer.length} > ${maxBytes})`);
  }

  // Validate MIME from magic bytes
  const detectedMime = detectMime(buffer);
  if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
    throw new RenderError("ASSET_TYPE_INVALID", `Image MIME not allowed: ${detectedMime ?? "unknown"}`);
  }

  if (buffer.length === 0) {
    throw new RenderError("ASSET_CORRUPTED", `Empty image body from ${url}`);
  }

  cache.set(url, buffer, detectedMime);
  return { buffer, mimeType: detectedMime };
}

async function fetchStorageImage(
  storagePath: string,
  cache: AssetCache,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const cacheKey = `storage:${storagePath}`;
  const cached = cache.get(cacheKey);
  if (cached) return { buffer: cached.buffer, mimeType: cached.mimeType };

  // Build Supabase public URL from storage path
  const isDev = process.env["NODE_ENV"] !== "production";
  const supabaseUrl = isDev ? process.env["SUPABASE_URL_DEV"] : process.env["SUPABASE_URL"];
  if (!supabaseUrl) throw new RenderError("ASSET_FETCH_FAILED", "Supabase URL not configured");

  const cleanPath = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${cleanPath}`;

  // No SSRF check needed — this is our own Supabase instance
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(publicUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (isAbort) throw new RenderError("ASSET_FETCH_TIMEOUT", `Storage fetch timed out: ${storagePath}`);
    throw new RenderError("ASSET_FETCH_FAILED", `Storage fetch failed: ${storagePath}`);
  }

  if (!response.ok) {
    throw new RenderError("ASSET_NOT_FOUND", `Storage asset not found: ${storagePath} (${response.status})`);
  }

  const arrayBuf = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  if (buffer.length > maxBytes) {
    throw new RenderError("ASSET_TOO_LARGE", `Storage asset exceeds size limit`);
  }

  const detectedMime = detectMime(buffer) ?? "image/png";
  cache.set(cacheKey, buffer, detectedMime);
  return { buffer, mimeType: detectedMime };
}

export type ResolvedImage = {
  buffer: Buffer;
  mimeType: string;
  dataUri: string;
};

function toDataUri(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Resolve an AssetReference to a validated image buffer + data URI.
 * Uses cache to avoid duplicate fetches within the same batch.
 */
export async function resolveAssetReference(
  ref: AssetReference,
  cache: AssetCache,
  opts?: { maxBytes?: number; timeoutMs?: number },
): Promise<ResolvedImage> {
  const maxBytes  = opts?.maxBytes  ?? renderConfig.maxRemoteAssetBytes;
  const timeoutMs = opts?.timeoutMs ?? renderConfig.assetFetchTimeoutMs;

  if (ref.type === "storage") {
    const { buffer, mimeType } = await fetchStorageImage(ref.storagePath, cache, maxBytes, timeoutMs);
    return { buffer, mimeType, dataUri: toDataUri(buffer, mimeType) };
  }

  if (ref.type === "url") {
    const { buffer, mimeType } = await fetchRemoteImage(ref.url, cache, maxBytes, timeoutMs);
    return { buffer, mimeType, dataUri: toDataUri(buffer, mimeType) };
  }

  if (ref.type === "upload") {
    // upload references should have been resolved to storage paths at save time
    throw new RenderError("ASSET_NOT_FOUND", `Unresolved upload reference: ${ref.uploadId}`);
  }

  throw new RenderError("ASSET_NOT_FOUND", "Unknown asset reference type");
}

/** Build a stable cache key for an asset reference. */
export function assetRefKey(ref: AssetReference): string {
  if (ref.type === "storage") return `storage:${ref.storagePath}`;
  if (ref.type === "url")     return `url:${ref.url}`;
  if (ref.type === "upload")  return `upload:${ref.uploadId}`;
  return "unknown";
}
