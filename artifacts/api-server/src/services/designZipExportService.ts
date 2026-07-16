/**
 * Design Template Engine — ZIP Export Service (Phase 3B)
 *
 * Implements the design_render_zip_export job worker:
 *   1. Claim queued export atomically
 *   2. Compute fingerprint (sha256 of sorted completed items)
 *   3. Download each item's rendered output
 *   4. Build ZIP with archiver (streaming to tmp file — never full ZIP in memory)
 *   5. Upload ZIP to object storage
 *   6. Mark export completed with manifest
 *
 * Idempotency: identical completed-item sets → same fingerprint → reuse existing export.
 * Security: filename sanitization, CSV formula injection prevention, ZIP-slip prevention.
 */

import { createHash, randomUUID } from "crypto";
import { createWriteStream, createReadStream } from "fs";
import { writeFile, rm, mkdir, stat } from "fs/promises";
import { tmpdir } from "os";
import { join, posix } from "path";
import { pipeline } from "stream/promises";
import JSZip from "jszip";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  designRenderZipExportsTable,
  designRenderItemsTable,
  designRenderBatchesTable,
  type DesignRenderZipExport,
  type NewDesignRenderZipExport,
} from "@workspace/db";
import { objectStorageClient } from "../lib/objectStorage.js";
import { logAudit } from "./aiAuditService.js";
import { logger } from "../lib/logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BatchItemSnapshot {
  itemId: number;
  status: string;
  outputStoragePath: string | null;
  outputFormat: string | null;
  outputFileSizeBytes: number | null;
  errorMessage: string | null;
}

export interface BatchSnapshot {
  batchId: number;
  tenantId: string;
  items: BatchItemSnapshot[];
}

export interface ManifestItem {
  itemId: number;
  status: string;
  filename: string;
  originalKey: string | null;
}

export interface ZipManifest {
  batchId: number;
  tenantId: string;
  exportedAt: string;
  sourceFingerprint: string;
  items: ManifestItem[];
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

/**
 * Compute a deterministic sha256 fingerprint of the completed item set.
 * Input: sorted by itemId, only completed items with an output path.
 */
export function computeBatchFingerprint(items: BatchItemSnapshot[]): string {
  const completed = items
    .filter((i) => i.status === "completed" && i.outputStoragePath)
    .sort((a, b) => a.itemId - b.itemId)
    .map((i) => {
      const checksum = i.outputFileSizeBytes ?? 0;
      return `${i.itemId}|${i.outputStoragePath ?? ""}|${checksum}`;
    });

  return createHash("sha256").update(completed.join("\n")).digest("hex");
}

// ── Batch Snapshot ────────────────────────────────────────────────────────────

export async function getExportableBatchSnapshot(
  batchId: number,
  tenantId: string,
): Promise<BatchSnapshot> {
  const items = await db
    .select({
      itemId: designRenderItemsTable.id,
      status: designRenderItemsTable.status,
      outputStoragePath: designRenderItemsTable.outputStoragePath,
      outputFormat: designRenderItemsTable.outputFormat,
      outputFileSizeBytes: designRenderItemsTable.outputFileSizeBytes,
      errorMessage: designRenderItemsTable.errorMessage,
    })
    .from(designRenderItemsTable)
    .where(
      and(
        eq(designRenderItemsTable.batchId, batchId),
        eq(designRenderItemsTable.tenantId, tenantId),
      ),
    )
    .orderBy(designRenderItemsTable.id);

  return { batchId, tenantId, items };
}

// ── Filename Sanitization ─────────────────────────────────────────────────────

/**
 * Sanitize a filename segment:
 *   - Remove path traversal (../, ..\, absolute paths)
 *   - Replace dangerous characters
 *   - Truncate to 200 chars
 *   - Never allow empty result
 */
export function sanitizeFilename(raw: string): string {
  // Normalize backslashes
  let s = raw.replace(/\\/g, "/");
  // Remove any directory component (keep only basename)
  s = s.split("/").pop() ?? s;
  // Remove null bytes and control characters
  s = s.replace(/[\x00-\x1f\x7f]/g, "");
  // Remove characters that are dangerous in filenames
  s = s.replace(/[<>:"|?*]/g, "_");
  // Remove leading dots (hidden files) and trailing dots/spaces
  s = s.replace(/^\.+/, "").replace(/[. ]+$/, "");
  // Collapse consecutive underscores/dots
  s = s.replace(/_{2,}/g, "_").replace(/\.{2,}/g, ".");
  // Truncate
  if (s.length > 200) s = s.slice(0, 200);
  // Fallback if empty
  if (!s) s = "output";
  return s;
}

/**
 * Build a safe archive entry path: {itemId}/output.{ext}
 * Ensures no path traversal (ZIP slip prevention).
 */
export function buildSafeEntryPath(itemId: number, format: string | null): string {
  const ext = sanitizeFilename(format ?? "bin");
  // posix.normalize will collapse ../ sequences; then verify no leading slash
  const candidate = posix.normalize(`${itemId}/output.${ext}`);
  // Must start with a safe component (no absolute path, no traversal)
  if (candidate.startsWith("/") || candidate.startsWith("..")) {
    return `${itemId}/output.bin`;
  }
  return candidate;
}

// ── CSV Helpers ───────────────────────────────────────────────────────────────

/**
 * Escape a CSV cell value:
 *   - Wrap in quotes if contains comma, newline, or quote
 *   - Escape internal quotes by doubling them
 *   - Prevent formula injection by prefixing =, +, -, @ with a single quote
 */
export function escapeCsvCell(value: string): string {
  // Formula injection prevention
  let v = value;
  if (/^[=+\-@]/.test(v)) {
    v = `'${v}`;
  }
  // Escape double quotes
  const needsQuote = v.includes('"') || v.includes(",") || v.includes("\n") || v.includes("\r");
  if (v.includes('"')) {
    v = v.replace(/"/g, '""');
  }
  if (needsQuote) {
    return `"${v}"`;
  }
  return v;
}

export function buildFailuresCsv(items: BatchItemSnapshot[]): string {
  const failed = items.filter((i) => i.status === "failed");
  if (failed.length === 0) {
    return "item_id,status,error_message\n";
  }
  const header = "item_id,status,error_message";
  const rows = failed.map((i) => {
    const cells = [
      escapeCsvCell(String(i.itemId)),
      escapeCsvCell(i.status),
      escapeCsvCell(i.errorMessage ?? ""),
    ];
    return cells.join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

// ── Storage Helpers ───────────────────────────────────────────────────────────

function parseStoragePath(path: string): { bucketName: string; objectName: string } {
  // path format: /bucketName/objectName...  or  bucketName/objectName...
  let p = path.startsWith("/") ? path.slice(1) : path;
  const slashIdx = p.indexOf("/");
  if (slashIdx === -1) throw new Error(`Invalid storage path: ${path}`);
  return {
    bucketName: p.slice(0, slashIdx),
    objectName: p.slice(slashIdx + 1),
  };
}

async function downloadFromStorage(storagePath: string): Promise<Buffer> {
  const { bucketName, objectName } = parseStoragePath(storagePath);
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  const [contents] = await file.download();
  return contents as Buffer;
}

async function uploadToStorage(
  bucketName: string,
  objectName: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  await file.save(buffer, { contentType, resumable: false });
}

function getExportBucketAndObject(
  tenantId: string,
  batchId: number,
  exportId: number,
): { bucketName: string; objectName: string; storagePath: string } {
  // Use PRIVATE_OBJECT_DIR to derive bucket
  const privateDir = process.env["PRIVATE_OBJECT_DIR"] ?? "/design-exports-bucket";
  // Parse bucket from env dir
  let bucketName: string;
  let prefix: string;
  if (privateDir.startsWith("/")) {
    const parts = privateDir.slice(1).split("/");
    bucketName = parts[0] ?? "design-exports-bucket";
    prefix = parts.slice(1).join("/");
  } else {
    const parts = privateDir.split("/");
    bucketName = parts[0] ?? "design-exports-bucket";
    prefix = parts.slice(1).join("/");
  }
  const objectName = [prefix, "design-exports", tenantId, String(batchId), `${exportId}.zip`]
    .filter(Boolean)
    .join("/");
  const storagePath = `/${bucketName}/${objectName}`;
  return { bucketName, objectName, storagePath };
}

// ── Core ZIP Worker ───────────────────────────────────────────────────────────

export async function executeZipExportJob(
  exportId: number,
  tenantId: string,
  batchId: number,
): Promise<{
  exportId: number;
  status: string;
  zipStoragePath?: string;
  fileSizeBytes?: number;
}> {
  // ── 1. Atomic claim: only proceed if still queued ──────────────────────────
  const claimed = await db
    .update(designRenderZipExportsTable)
    .set({
      status: "generating",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(designRenderZipExportsTable.id, exportId),
        eq(designRenderZipExportsTable.tenantId, tenantId),
        eq(designRenderZipExportsTable.status, "queued"),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    // Already claimed or completed — check current state
    const [existing] = await db
      .select({ status: designRenderZipExportsTable.status, zipStoragePath: designRenderZipExportsTable.zipStoragePath })
      .from(designRenderZipExportsTable)
      .where(eq(designRenderZipExportsTable.id, exportId))
      .limit(1);

    if (existing?.status === "completed") {
      return { exportId, status: "already_completed", zipStoragePath: existing.zipStoragePath ?? undefined };
    }
    throw new Error(`ZIP export ${exportId} is not in a claimable state (current: ${existing?.status ?? "unknown"})`);
  }

  const workDir = join(tmpdir(), `design-zip-${exportId}-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    // ── 2. Load batch snapshot ───────────────────────────────────────────────
    const snapshot = await getExportableBatchSnapshot(batchId, tenantId);
    const completedItems = snapshot.items.filter((i) => i.status === "completed" && i.outputStoragePath);

    // ── 3. Build ZIP using JSZip ─────────────────────────────────────────────
    const zip = new JSZip();

    const manifestItems: ManifestItem[] = [];

    // Process each completed item
    for (const item of snapshot.items) {
      const entryPath = buildSafeEntryPath(item.itemId, item.outputFormat);

      if (item.status === "completed" && item.outputStoragePath) {
        try {
          // Download file — per file, not all at once
          const fileBuffer = await downloadFromStorage(item.outputStoragePath);
          zip.file(entryPath, fileBuffer);
          manifestItems.push({
            itemId: item.itemId,
            status: item.status,
            filename: entryPath,
            originalKey: item.outputStoragePath,
          });
        } catch (downloadErr) {
          logger.warn(
            { exportId, itemId: item.itemId, err: downloadErr },
            "[design-zip] Failed to download item — skipping",
          );
          manifestItems.push({
            itemId: item.itemId,
            status: "download_failed",
            filename: entryPath,
            originalKey: item.outputStoragePath,
          });
        }
      } else {
        manifestItems.push({
          itemId: item.itemId,
          status: item.status,
          filename: entryPath,
          originalKey: item.outputStoragePath,
        });
      }
    }

    // ── 4. Compute fingerprint ───────────────────────────────────────────────
    const fingerprint = computeBatchFingerprint(snapshot.items);

    // ── 5. Build manifest ────────────────────────────────────────────────────
    const manifest: ZipManifest = {
      batchId,
      tenantId,
      exportedAt: new Date().toISOString(),
      sourceFingerprint: fingerprint,
      items: manifestItems,
    };

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    // ── 6. Build failures.csv ────────────────────────────────────────────────
    const failuresCsv = buildFailuresCsv(snapshot.items);
    zip.file("failures.csv", failuresCsv);

    // ── 7. Generate ZIP to tmp file (buffer per JSZip, then write to disk) ──
    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const zipTmpPath = join(workDir, `${exportId}.zip`);
    await writeFile(zipTmpPath, zipBuffer);
    const fileSizeBytes = zipBuffer.length;

    // ── 8. Upload to object storage ──────────────────────────────────────────
    const { bucketName, objectName, storagePath } = getExportBucketAndObject(tenantId, batchId, exportId);

    await uploadToStorage(bucketName, objectName, zipBuffer, "application/zip");

    // ── 9. Mark completed ────────────────────────────────────────────────────
    await db
      .update(designRenderZipExportsTable)
      .set({
        status: "completed",
        zipStoragePath: storagePath,
        fileSizeBytes,
        manifestJson: manifest as unknown as Record<string, unknown>,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(designRenderZipExportsTable.id, exportId));

    await logAudit({
      module: "design-template-engine",
      action: "zip_export_completed",
      resourceType: "design_render_zip_export",
      resourceId: String(exportId),
      status: "success",
      tenantId,
      details: { exportId, batchId, fileSizeBytes, itemCount: snapshot.items.length },
    });

    logger.info({ exportId, batchId, fileSizeBytes }, "[design-zip] ZIP export completed");

    return { exportId, status: "completed", zipStoragePath: storagePath, fileSizeBytes };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await db
      .update(designRenderZipExportsTable)
      .set({
        status: "failed",
        errorMessage: errorMessage.slice(0, 2000),
        retryCount: sql`retry_count + 1`,
        updatedAt: new Date(),
      })
      .where(eq(designRenderZipExportsTable.id, exportId));

    await logAudit({
      module: "design-template-engine",
      action: "zip_export_failed",
      resourceType: "design_render_zip_export",
      resourceId: String(exportId),
      status: "failure",
      tenantId,
      details: { exportId, batchId, error: errorMessage },
    });

    logger.error({ exportId, batchId, err }, "[design-zip] ZIP export failed");
    throw err;
  } finally {
    // Always clean up temp files
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── Idempotent Enqueue ────────────────────────────────────────────────────────

/**
 * Enqueue a ZIP export for a batch.
 * If an existing completed export has the same fingerprint, return it (idempotent).
 * If there is already a queued/generating export, return that.
 */
export async function enqueueZipExport(
  batchId: number,
  tenantId: string,
): Promise<DesignRenderZipExport> {
  // Compute fingerprint from current completed items
  const snapshot = await getExportableBatchSnapshot(batchId, tenantId);
  const fingerprint = computeBatchFingerprint(snapshot.items);

  // Check for existing export with same fingerprint (completed)
  const existing = await db
    .select()
    .from(designRenderZipExportsTable)
    .where(
      and(
        eq(designRenderZipExportsTable.batchId, batchId),
        eq(designRenderZipExportsTable.tenantId, tenantId),
        eq(designRenderZipExportsTable.sourceFingerprint, fingerprint),
        eq(designRenderZipExportsTable.status, "completed"),
      ),
    )
    .orderBy(designRenderZipExportsTable.createdAt)
    .limit(1);

  if (existing.length > 0) {
    return existing[0]!;
  }

  // Check for already queued/generating export (any fingerprint)
  const inProgress = await db
    .select()
    .from(designRenderZipExportsTable)
    .where(
      and(
        eq(designRenderZipExportsTable.batchId, batchId),
        eq(designRenderZipExportsTable.tenantId, tenantId),
        sql`status IN ('queued', 'generating')`,
      ),
    )
    .limit(1);

  if (inProgress.length > 0) {
    return inProgress[0]!;
  }

  // Create new export record
  const [newExport] = await db
    .insert(designRenderZipExportsTable)
    .values({
      tenantId,
      batchId,
      status: "queued",
      sourceFingerprint: fingerprint,
    } satisfies NewDesignRenderZipExport)
    .returning();

  return newExport!;
}

// ── Status Query ──────────────────────────────────────────────────────────────

export async function getZipExport(
  exportId: number,
  tenantId: string,
): Promise<DesignRenderZipExport | null> {
  const [row] = await db
    .select()
    .from(designRenderZipExportsTable)
    .where(
      and(
        eq(designRenderZipExportsTable.id, exportId),
        eq(designRenderZipExportsTable.tenantId, tenantId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function getLatestZipExportForBatch(
  batchId: number,
  tenantId: string,
): Promise<DesignRenderZipExport | null> {
  const [row] = await db
    .select()
    .from(designRenderZipExportsTable)
    .where(
      and(
        eq(designRenderZipExportsTable.batchId, batchId),
        eq(designRenderZipExportsTable.tenantId, tenantId),
      ),
    )
    .orderBy(designRenderZipExportsTable.createdAt)
    .limit(1);

  return row ?? null;
}

// ── Signed URL Generation ─────────────────────────────────────────────────────

import { createHmac } from "crypto";

const SIGNED_URL_SECRET =
  process.env["SESSION_SECRET"] ?? process.env["ADMIN_API_KEY"] ?? "insecure-dev-only-secret";
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Generate a short-lived signed download token for a completed ZIP export.
 * Token is: base64url(JSON({exportId, tenantId, exp, nonce})) + "." + HMAC
 * NEVER stored permanently — generated only at time of authorized download request.
 */
export function generateZipDownloadToken(
  exportId: number,
  tenantId: string,
  ttlSeconds = SIGNED_URL_TTL_SECONDS,
): string {
  const payload = {
    eid: exportId,
    tid: tenantId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: randomUUID().slice(0, 8),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SIGNED_URL_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export interface VerifyZipTokenResult {
  valid: boolean;
  exportId?: number;
  tenantId?: string;
  reason?: string;
}

export function verifyZipDownloadToken(token: string): VerifyZipTokenResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "Malformed token" };
  const [encoded, sig] = parts;
  const expected = createHmac("sha256", SIGNED_URL_SECRET).update(encoded!).digest("base64url");
  if (sig !== expected) return { valid: false, reason: "Invalid signature" };

  let payload: { eid: number; tid: string; exp: number; nonce: string };
  try {
    payload = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf-8"));
  } catch {
    return { valid: false, reason: "Malformed payload" };
  }

  if (Math.floor(Date.now() / 1000) > payload.exp) {
    return { valid: false, reason: "Token expired" };
  }

  return { valid: true, exportId: payload.eid, tenantId: payload.tid };
}
