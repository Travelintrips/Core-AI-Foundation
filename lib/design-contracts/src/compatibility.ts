/**
 * compatibility.ts — Contract version compatibility utilities.
 *
 * Versioning policy:
 *   - A version is compatible if it falls within
 *     [MINIMUM_SUPPORTED_CONTRACT_VERSION, DESIGN_CONTRACT_VERSION].
 *   - Incompatible versions throw ArchitectureCompatibilityError — never silent
 *     fallback.
 *   - Minor additive extensions (new optional fields) do NOT require a version
 *     bump; they are always compatible within the same major version.
 */

import {
  DESIGN_CONTRACT_VERSION,
  MINIMUM_SUPPORTED_CONTRACT_VERSION,
} from "./version.js";

// ── Error ─────────────────────────────────────────────────────────────────────

export class ArchitectureCompatibilityError extends Error {
  readonly code = "CONTRACT_VERSION_UNSUPPORTED" as const;
  readonly received: number;
  readonly supported: { min: number; max: number };

  constructor(received: number) {
    super(
      `Unsupported design contract version ${received}. ` +
        `Supported range: ${MINIMUM_SUPPORTED_CONTRACT_VERSION}–${DESIGN_CONTRACT_VERSION}.`,
    );
    this.name = "ArchitectureCompatibilityError";
    this.received = received;
    this.supported = {
      min: MINIMUM_SUPPORTED_CONTRACT_VERSION,
      max: DESIGN_CONTRACT_VERSION,
    };
  }
}

// ── Guards ────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given version is within the supported range.
 * Use this for conditional handling; use assertCompatibleVersion for hard gates.
 */
export function isCompatibleVersion(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= MINIMUM_SUPPORTED_CONTRACT_VERSION &&
    version <= DESIGN_CONTRACT_VERSION
  );
}

/**
 * Asserts that a received version is compatible.
 * Throws ArchitectureCompatibilityError if not.
 * Use this at every integration boundary (plugin load, event deserialize, etc).
 */
export function assertCompatibleVersion(version: number): void {
  if (!isCompatibleVersion(version)) {
    throw new ArchitectureCompatibilityError(version);
  }
}

/**
 * Checks compatibility and returns a typed result instead of throwing.
 * Useful when you cannot throw (e.g. in a validation pipeline).
 */
export function checkCompatibility(
  version: number,
): { compatible: true } | { compatible: false; reason: string } {
  if (!Number.isInteger(version)) {
    return { compatible: false, reason: `version must be an integer, got: ${version}` };
  }
  if (version < MINIMUM_SUPPORTED_CONTRACT_VERSION) {
    return {
      compatible: false,
      reason: `version ${version} is below minimum supported version ${MINIMUM_SUPPORTED_CONTRACT_VERSION}`,
    };
  }
  if (version > DESIGN_CONTRACT_VERSION) {
    return {
      compatible: false,
      reason: `version ${version} is newer than current contract version ${DESIGN_CONTRACT_VERSION}`,
    };
  }
  return { compatible: true };
}
