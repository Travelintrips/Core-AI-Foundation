/**
 * plugin.ts — DesignPluginManifest
 *
 * Every domain plugin (Fashion, Interior, Packaging, Branding, …) declares
 * itself via a DesignPluginManifest. The core engine reads the manifest at
 * plugin registration time. Plugins MUST NOT be imported by the core engine
 * at build time — they are loaded dynamically via the plugin registry.
 *
 * Invariants:
 *   - pluginId is globally unique and stable (rename = breaking change).
 *   - compatibleContractVersion must be within the supported range at load time.
 *   - supportedServices maps plugin capabilities to platform service codes.
 *   - The manifest is the ONLY place plugin identity lives; no domain detail
 *     leaks into the core engine.
 */

import { z } from "zod";

// ── Plugin capability declaration ─────────────────────────────────────────────

export const PluginCapabilityFlagSchema = z.object({
  /** Matches a DesignCapabilityContract.capabilityId. */
  capabilityId: z.string().min(1).max(150),
  /** Whether this capability requires a paid AI model. */
  requiresAi: z.boolean().default(false),
  /** Whether this capability produces a client-visible deliverable. */
  producesDeliverable: z.boolean().default(true),
  /** Feature flag key that gates this capability (optional). */
  featureFlagKey: z.string().max(100).optional(),
});

export type PluginCapabilityFlag = z.infer<typeof PluginCapabilityFlagSchema>;

// ── Plugin feature flags ──────────────────────────────────────────────────────

export const PluginFeatureFlagSchema = z.object({
  key: z.string().min(1).max(100),
  /** Default value when the flag is not explicitly set. */
  defaultEnabled: z.boolean(),
  /** Human-readable description of what this flag controls. */
  description: z.string().max(300).optional(),
});

export type PluginFeatureFlag = z.infer<typeof PluginFeatureFlagSchema>;

// ── DesignPluginManifest ──────────────────────────────────────────────────────

export const DesignPluginManifestSchema = z.object({
  // ── Identity ──────────────────────────────────────────────────────────────

  /** Stable, globally unique plugin identifier. */
  pluginId: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_-]*$/, {
    message: "pluginId must be lowercase alphanumeric with hyphens/underscores",
  }),
  /** Plugin display name (not used as an identifier). */
  displayName: z.string().min(1).max(200),
  /**
   * Semantic version of this plugin manifest (e.g. "1.0.0").
   * Bump on any change to stages, capabilities, or brief schema.
   */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, {
    message: "version must be semver: MAJOR.MINOR.PATCH",
  }),
  /**
   * The design-contracts package version this plugin was built against.
   * The core engine rejects plugins whose compatibleContractVersion is outside
   * the supported range.
   */
  compatibleContractVersion: z.number().int().positive(),

  // ── Service coverage ──────────────────────────────────────────────────────

  /**
   * Platform service codes this plugin handles.
   * Maps 1:1 to DesignProjectContext.serviceType values.
   * The core engine uses this list to route projects to the correct plugin.
   */
  supportedServices: z.array(z.string().min(1).max(100)).min(1),

  // ── Schema references (opaque strings — the core doesn't parse them) ──────

  /**
   * Identifier or import path for the brief schema this plugin expects.
   * Resolved by the plugin registry; opaque to the core engine.
   */
  briefSchemaRef: z.string().min(1).max(300),
  /**
   * Identifier or import path for the workflow definition this plugin provides.
   * The plugin registry resolves this to a list of DesignStageDefinitions.
   */
  workflowRef: z.string().min(1).max(300),

  // ── Capabilities & flags ──────────────────────────────────────────────────

  /** All capabilities this plugin may invoke. */
  capabilities: z.array(PluginCapabilityFlagSchema).default([]),
  /** Feature flags scoped to this plugin. */
  featureFlags: z.array(PluginFeatureFlagSchema).default([]),

  // ── Compatibility metadata ────────────────────────────────────────────────

  /** Plugin author / owning team (for support routing). */
  maintainer: z.string().max(100).optional(),
  /** ISO-8601 date this manifest was published. */
  publishedAt: z.string().datetime().optional(),
  /** Arbitrary plugin-specific metadata (opaque to core). */
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type DesignPluginManifest = z.infer<typeof DesignPluginManifestSchema>;
