/**
 * Material Catalog Integration — Phase 3 Foundation
 * Media reference abstraction — typed references only, no file downloads.
 *
 * Allowed URL schemes: https only.
 * Rejects: http, ftp, file, data, and anything else.
 */

import type { MediaReference, MediaReferenceKind } from "./types.js";
import { CatalogUnsupportedUrlSchemeError } from "./errors.js";

const ALLOWED_SCHEMES = ["https:"] as const;

/**
 * Validate a URL string and return its scheme.
 * @throws {CatalogUnsupportedUrlSchemeError} for non-https schemes.
 */
export function validateSourceUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CatalogUnsupportedUrlSchemeError("(invalid URL)");
  }
  if (!(ALLOWED_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    throw new CatalogUnsupportedUrlSchemeError(parsed.protocol.replace(":", ""));
  }
  return parsed;
}

/**
 * Resolve a raw value into a typed MediaReference.
 * Never downloads or proxies the media.
 * Never accesses the local filesystem beyond fixture paths.
 */
export function resolveMediaReference(raw: unknown): MediaReference {
  if (!raw) {
    return { kind: "unresolved", rawValue: String(raw ?? "") };
  }

  // Already a structured reference object
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const kind = obj["kind"] as MediaReferenceKind | undefined;

    if (kind === "remote_url") {
      const url = String(obj["url"] ?? "");
      validateSourceUrl(url); // throws on invalid/disallowed scheme
      return { kind: "remote_url", url };
    }

    if (kind === "provider_asset_id") {
      return { kind: "provider_asset_id", assetId: String(obj["assetId"] ?? "") };
    }

    if (kind === "local_fixture") {
      const fixturePath = String(obj["fixturePath"] ?? "");
      // Reject path traversal attempts
      if (fixturePath.includes("..") || fixturePath.startsWith("/")) {
        return { kind: "unresolved", rawValue: fixturePath };
      }
      return { kind: "local_fixture", fixturePath };
    }

    return { kind: "unresolved", rawValue: JSON.stringify(raw) };
  }

  // Plain string — classify by content
  if (typeof raw === "string") {
    const trimmed = raw.trim();

    if (trimmed.startsWith("https://")) {
      validateSourceUrl(trimmed); // throws on invalid URL
      return { kind: "remote_url", url: trimmed };
    }

    if (trimmed.startsWith("http://") || trimmed.startsWith("ftp://") || trimmed.startsWith("file://") || trimmed.startsWith("data:")) {
      let scheme = "(unknown)";
      try { scheme = new URL(trimmed).protocol.replace(":", ""); } catch { /* ignore */ }
      throw new CatalogUnsupportedUrlSchemeError(scheme);
    }

    // Treat as provider asset ID if it looks like an ID (no slashes, no spaces)
    if (/^[\w\-.:]+$/.test(trimmed) && !trimmed.includes("/")) {
      return { kind: "provider_asset_id", assetId: trimmed };
    }

    return { kind: "unresolved", rawValue: trimmed };
  }

  return { kind: "unresolved", rawValue: String(raw) };
}

/**
 * Resolve an array of raw media references.
 * Items that fail validation are returned as "unresolved" rather than throwing.
 */
export function resolveMediaReferences(raws: unknown[]): MediaReference[] {
  return raws.map((raw) => {
    try {
      return resolveMediaReference(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "unresolved", rawValue: message };
    }
  });
}
