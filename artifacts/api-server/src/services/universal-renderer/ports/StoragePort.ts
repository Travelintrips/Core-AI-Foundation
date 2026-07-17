/**
 * StoragePort — Universal Renderer Team 14
 *
 * Contract for uploading, verifying, and addressing objects in backing storage.
 *
 * Security contract:
 *   - redact() MUST strip any credential/token from a storage path/URL before
 *     it appears in an audit log, error message, or JSON response body.
 *   - upload() MUST verify the object after write (size round-trip check).
 *   - Implementations MUST NOT log signed URLs or service-role tokens.
 */

export interface UploadInput {
  buffer: Buffer;
  storagePath: string; // e.g. "universal-renders/2025/abc.pdf"
  contentType: string;
  /** SHA-256 hex checksum for post-upload verification. */
  checksum?: string;
}

export interface UploadResult {
  storagePath: string;
  publicUrl: string;
  fileSizeBytes: number;
  /** True when a size round-trip verify confirmed the object is live. */
  verified: boolean;
}

export interface StoragePort {
  upload(input: UploadInput): Promise<UploadResult>;
  objectExists(storagePath: string): Promise<boolean>;
  getPublicUrl(storagePath: string): string;
  /**
   * Return a safe, audit-log-friendly representation of the path —
   * no signed tokens, no service-role keys.
   */
  redact(storagePathOrUrl: string): string;
}
