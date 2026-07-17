/**
 * StorageAdapter — Universal Renderer Team 14
 *
 * Implements StoragePort by delegating to the existing supabaseStorage lib.
 * Does NOT duplicate storage logic.
 *
 * Security:
 *   - redact() strips the service-role token / signed-URL query params
 *   - upload() verifies the object is live after write
 *   - Audit log callers must use redact() before logging paths/URLs
 */

import {
  uploadToSupabase,
  storageObjectExists,
  getSupabasePublicUrl,
} from "../../../lib/supabaseStorage.js";
import { RenderError } from "../errors.js";
import type { StoragePort, UploadInput, UploadResult } from "../ports/StoragePort.js";

// Strip query string (signed tokens) and service-role key patterns
const TOKEN_QUERY_RE = /[?&]token=[^&]*/gi;
const SERVICE_KEY_RE = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;

export class StorageAdapter implements StoragePort {
  async upload(input: UploadInput): Promise<UploadResult> {
    const { buffer, storagePath, contentType } = input;

    const publicUrl = await uploadToSupabase(storagePath, buffer, contentType);

    // Post-upload existence check (fail-safe, not blocking)
    let verified = false;
    try {
      verified = await storageObjectExists(storagePath);
    } catch {
      // Non-fatal — verified stays false; caller decides how to handle
    }

    if (!verified) {
      throw new RenderError(
        "STORAGE_VERIFY_FAILED",
        `Upload reported success but object not found: ${this.redact(storagePath)}`,
      );
    }

    return {
      storagePath,
      publicUrl,
      fileSizeBytes: buffer.length,
      verified,
    };
  }

  objectExists(storagePath: string): Promise<boolean> {
    return storageObjectExists(storagePath);
  }

  getPublicUrl(storagePath: string): string {
    return getSupabasePublicUrl(storagePath);
  }

  redact(storagePathOrUrl: string): string {
    return storagePathOrUrl
      .replace(TOKEN_QUERY_RE, "?token=[REDACTED]")
      .replace(SERVICE_KEY_RE, "[SERVICE_KEY_REDACTED]");
  }
}
