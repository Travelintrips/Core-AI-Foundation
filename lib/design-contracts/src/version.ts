/**
 * version.ts — Contract versioning constants for the Universal Design Platform.
 *
 * Integer versioning strategy:
 *   - DESIGN_CONTRACT_VERSION: current version emitted by this package.
 *   - MINIMUM_SUPPORTED_CONTRACT_VERSION: oldest version consumers may send.
 *   - Bump DESIGN_CONTRACT_VERSION on any breaking (major) change.
 *   - Bump MINIMUM_SUPPORTED_CONTRACT_VERSION only when old versions are
 *     formally retired (with advance notice to all teams).
 *
 * Minor (additive) changes do NOT require a version bump:
 *   - Adding optional fields to any contract.
 *   - Adding new enum members to extension registries.
 *   - Adding new capability IDs.
 */

/** The version this package emits on all envelopes. */
export const DESIGN_CONTRACT_VERSION = 1 as const;

/** Oldest version this package will accept from upstream consumers. */
export const MINIMUM_SUPPORTED_CONTRACT_VERSION = 1 as const;

/** Semantic label used in documentation and error messages. */
export const DESIGN_CONTRACT_VERSION_LABEL = "v1.0" as const;
