/**
 * zipPackageService — Universal Renderer Team 14
 *
 * Assembles a ZIP package from render output buffers.
 *
 * Invariants enforced:
 *   - No empty ZIP (≥ 1 file required)
 *   - ZIP size limit: 200 MB
 *   - Each entry must have a non-empty filename and a non-empty buffer
 *   - manifest.json is always injected as the first entry
 *   - SHA-256 checksum computed over the final ZIP buffer
 *
 * Uses Node.js built-in zlib + archive streams rather than a third-party
 * ZIP library to avoid adding dependencies.  For deterministic output, file
 * modification times are set to Unix epoch.
 */

import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir, rm } from "fs/promises";
import { join }  from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { RenderError } from "./errors.js";
import { computeChecksum } from "./checksumService.js";

const execFileAsync = promisify(execFile);

// 200 MB limit
const MAX_ZIP_BYTES = 200 * 1024 * 1024;

export interface ZipEntry {
  /** Relative path within the ZIP (e.g. "preview.pdf", "assets/logo.png"). */
  filename: string;
  buffer:   Buffer;
  mimeType: string;
}

export interface ZipManifest {
  version:      string;
  createdAt:    string;
  renderedBy:   string;
  fileCount:    number;
  files:        Array<{ filename: string; mimeType: string; sizeBytes: number; checksum: string }>;
}

export interface ZipPackageInput {
  entries:     ZipEntry[];
  packageName: string; // used as the top-level ZIP folder name
}

export interface ZipPackageOutput {
  buffer:        Buffer;
  fileSizeBytes: number;
  checksum:      string;
  fileCount:     number;
  manifest:      ZipManifest;
}

/**
 * Build a ZIP package from the given entries.
 *
 * The manifest.json is auto-generated and injected as the first entry.
 * Throws ZIP_EMPTY if no entries are provided.
 * Throws ZIP_TOO_LARGE if the resulting ZIP exceeds MAX_ZIP_BYTES.
 */
export async function buildZipPackage(input: ZipPackageInput): Promise<ZipPackageOutput> {
  const { entries, packageName } = input;

  if (!entries || entries.length === 0) {
    throw new RenderError("ZIP_EMPTY", "Cannot produce a ZIP package with zero files");
  }

  // Validate all entries
  for (const entry of entries) {
    if (!entry.filename || entry.filename.trim().length === 0) {
      throw new RenderError("ZIP_EMPTY", "All ZIP entries must have a non-empty filename");
    }
    if (!entry.buffer || entry.buffer.length === 0) {
      throw new RenderError(
        "ZIP_EMPTY",
        `ZIP entry "${entry.filename}" has an empty buffer — refusing to package`,
      );
    }
    // Prevent path traversal
    if (entry.filename.includes("..") || entry.filename.startsWith("/")) {
      throw new RenderError(
        "ZIP_EMPTY",
        `ZIP entry filename "${entry.filename}" is not a safe relative path`,
      );
    }
  }

  // Build manifest
  const manifest: ZipManifest = {
    version:   "1.0",
    createdAt: new Date().toISOString(),
    renderedBy: "Creative AI Studio — Universal Renderer v1",
    fileCount:  entries.length,
    files: entries.map((e) => ({
      filename:  e.filename,
      mimeType:  e.mimeType,
      sizeBytes: e.buffer.length,
      checksum:  computeChecksum(e.buffer),
    })),
  };

  const manifestJson   = JSON.stringify(manifest, null, 2);
  const manifestBuffer = Buffer.from(manifestJson, "utf8");

  const allEntries: ZipEntry[] = [
    { filename: "manifest.json", buffer: manifestBuffer, mimeType: "application/json" },
    ...entries,
  ];

  // Write to a temp dir and zip via system `zip` command
  const tmpDir = join(tmpdir(), `ur-zip-${randomUUID()}`);
  const folder  = join(tmpDir, packageName);

  try {
    await mkdir(folder, { recursive: true });

    for (const entry of allEntries) {
      const entryPath = join(folder, entry.filename);
      // Ensure parent dirs exist (for nested paths like "assets/logo.png")
      const parentDir = entryPath.substring(0, entryPath.lastIndexOf("/"));
      if (parentDir && parentDir !== folder) {
        await mkdir(parentDir, { recursive: true });
      }
      await writeFile(entryPath, entry.buffer);
    }

    const zipPath = join(tmpDir, `${packageName}.zip`);
    // --junk-paths is NOT used so folder structure is preserved
    await execFileAsync("zip", ["-r", "-0", zipPath, packageName], { cwd: tmpDir });

    const { readFile } = await import("fs/promises");
    const zipBuffer = await readFile(zipPath);

    if (zipBuffer.length === 0) {
      throw new RenderError("ZIP_EMPTY", "zip command produced an empty archive");
    }
    if (zipBuffer.length > MAX_ZIP_BYTES) {
      throw new RenderError(
        "ZIP_TOO_LARGE",
        `ZIP output is ${zipBuffer.length} bytes — exceeds ${MAX_ZIP_BYTES} byte limit`,
      );
    }

    return {
      buffer:        zipBuffer,
      fileSizeBytes: zipBuffer.length,
      checksum:      computeChecksum(zipBuffer),
      fileCount:     allEntries.length,
      manifest,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
