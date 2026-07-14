/**
 * imageBatchExportService.ts — Phase 5 Creative Asset Batch Engine
 *
 * Builds a ZIP archive for a completed image batch using jszip (already a
 * project dependency — no new package needed). Strict content rules:
 *   - only image bytes + a customer-safe manifest.json go in the archive
 *   - no internal storage paths, cost, QC notes, or provider URLs
 *   - per-batch-type folder structure via definition.zipFolderFor()
 */

import JSZip from "jszip";
import type { GeneratedImageBatchItem, ImageBatchDefinition } from "./imageBatchTypes.js";

function extensionFromContentType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "png";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "jpg";
  return "webp";
}

/** Sanitize a folder/file segment: lowercase, alnum + dash only, no traversal. */
function sanitizeSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "asset";
}

export interface BatchZipInput {
  projectNumber: string;
  batchType: string;
  items: Array<{ item: GeneratedImageBatchItem; buffer: Buffer }>;
}

export async function buildBatchZip(
  definition: ImageBatchDefinition,
  input: BatchZipInput,
): Promise<Buffer> {
  const zip = new JSZip();
  const manifestItems: Array<{ group: string; label: string; filename: string }> = [];

  for (const { item, buffer } of input.items) {
    const folder = input.items.length > 0
      ? definition.zipFolderFor(item).split("/").map(sanitizeSegment).join("/")
      : sanitizeSegment(item.group);
    const ext = extensionFromContentType(item.imageUrl ?? "");
    const filename = `${sanitizeSegment(item.itemKey)}.${ext}`;
    zip.file(`${folder}/${filename}`, buffer);
    manifestItems.push({ group: item.group, label: item.groupLabel, filename: `${folder}/${filename}` });
  }

  // Customer-safe manifest only — no storage paths, cost, QC notes, or provider URLs.
  const manifest = {
    project: input.projectNumber,
    batchType: input.batchType,
    generatedAt: new Date().toISOString(),
    items: manifestItems,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
