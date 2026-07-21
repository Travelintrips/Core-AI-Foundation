/**
 * deprecation.ts — DeprecationPolicy & FeatureStability
 *
 * TASK H: DeprecationPolicy
 * ─────────────────────────
 * A canonical contract for declaring when a type, schema, capability, plugin,
 * or platform feature has been deprecated and what replaces it.
 *
 * Attach DeprecationPolicy to any contract object via a `deprecation` field:
 *
 *   myCapability = {
 *     capabilityId: "fashion:legacy_render",
 *     ...
 *     deprecation: {
 *       isDeprecated: true,
 *       deprecatedSince: "1.2.0",
 *       replacement: "fashion:render_technical_drawing",
 *       removeAfterVersion: 3,
 *       reason: "Replaced by unified rendering pipeline.",
 *     },
 *   };
 *
 * TASK I: FeatureStability
 * ─────────────────────────
 * An enum that classifies how stable any feature, plugin, or capability is.
 * Used by the Plugin Framework to display appropriate warnings in developer
 * tooling and to gate certain features behind explicit opt-in.
 *
 * Stability tiers (from least to most stable):
 *   experimental → preview → stable
 *   deprecated and internal are terminal states.
 */

import { z } from "zod";

// ── FeatureStability enum (Task I) ────────────────────────────────────────────

/**
 * Stability tier of a feature, plugin capability, or contract.
 *
 * - experimental — Unstable; API may change without notice. Opt-in required.
 * - preview      — Approaching stable; breaking changes announced in advance.
 * - stable       — Production-ready; breaking changes follow the semver policy.
 * - deprecated   — Scheduled for removal; use the replacement instead.
 * - internal     — Not part of the public contract; may be removed at any time.
 */
export const FEATURE_STABILITIES = [
  "experimental",
  "preview",
  "stable",
  "deprecated",
  "internal",
] as const;

export type FeatureStability = (typeof FEATURE_STABILITIES)[number];

export const FeatureStabilitySchema = z.enum(FEATURE_STABILITIES);

// ── DeprecationPolicy schema (Task H) ────────────────────────────────────────

export const DeprecationPolicySchema = z.object({
  /**
   * Whether the subject (type / capability / plugin) is currently deprecated.
   * When false, all other fields are informational only.
   */
  isDeprecated: z.boolean(),
  /**
   * The semver (e.g. "1.2.0") or date (ISO-8601, e.g. "2026-01-15") at
   * which the subject was declared deprecated.
   */
  deprecatedSince: z.string().max(30).optional(),
  /**
   * The canonical identifier of the type, capability, or plugin that
   * replaces the deprecated subject. Teams should migrate to this target.
   * Examples: "fashion:render_technical_drawing", "@workspace/design-contracts/v2".
   */
  replacement: z.string().max(300).optional(),
  /**
   * The contract integer version after which the deprecated subject WILL be
   * removed. Teams must migrate before DESIGN_CONTRACT_VERSION reaches this.
   *
   * Example: if removeAfterVersion = 3, the subject is removed when the
   * package ships DESIGN_CONTRACT_VERSION = 3.
   */
  removeAfterVersion: z.number().int().positive().optional(),
  /**
   * Human-readable rationale for the deprecation.
   */
  reason: z.string().max(500).optional(),
});

export type DeprecationPolicy = z.infer<typeof DeprecationPolicySchema>;
