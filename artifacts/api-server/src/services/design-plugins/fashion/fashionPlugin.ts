/**
 * fashionPlugin.ts — Fashion Design Plugin
 *
 * Plugin loader / assembler.
 * Aggregates all contributions into a single AssembledFashionPlugin object.
 *
 * Usage:
 *   import { loadFashionPlugin } from "./fashionPlugin.js";
 *   const plugin = loadFashionPlugin();
 *   // plugin.manifest, plugin.artifactTypes, plugin.capabilities, etc.
 *
 * This file is the ONLY entry point that should be imported by the
 * execution engine or integration layer. Import individual contribution
 * modules only from tests.
 */

import type { AssembledFashionPlugin, DomainPluginManifest } from "./types/pluginContracts.js";
import { PLUGIN_CONTRACT_VERSION } from "./types/pluginContracts.js";

export { PLUGIN_CONTRACT_VERSION } from "./types/pluginContracts.js";
import { fashionArtifactTypes, FASHION_ARTIFACT_TYPE_IDS } from "./artifacts/fashionArtifactTypes.js";
import { fashionCapabilities, isFashionCapabilitySupported } from "./contributions/capabilities.js";
import { fashionMaterialCategories } from "./contributions/materials.js";
import { fashionComponentCategories } from "./contributions/components.js";
import { fashionPropertySections } from "./contributions/properties.js";
import { fashionRendererMetadata } from "./contributions/rendererMetadata.js";
import { fashionExportPresets } from "./contributions/exportPresets.js";

// ── Manifest ──────────────────────────────────────────────────────────────────

const MANIFEST: DomainPluginManifest = {
  pluginId: "fashion-design",
  displayName: "Fashion Design Domain Plugin",
  version: "1.0.0",
  contractVersion: PLUGIN_CONTRACT_VERSION,
  description:
    "Fashion Design domain plugin for the Universal Design Engine. " +
    "Contributes a full 11-step design workflow, 9 artifact types, 12 AI capabilities, " +
    "8 material categories, 6 garment component categories, 7 property sections, " +
    "3 renderer metadata blocks, and 7 export presets. " +
    "Fashion-specific fields are self-contained; no fashion semantics leak into core.",
  domain: "fashion",
  capabilityIds: fashionCapabilities.map((c) => c.id),
  artifactTypeIds: [...FASHION_ARTIFACT_TYPE_IDS],
  propertySectionIds: fashionPropertySections.map((s) => s.id),
  materialCategoryIds: fashionMaterialCategories.map((m) => m.id),
  componentCategoryIds: fashionComponentCategories.map((c) => c.id),
  rendererMetadataIds: fashionRendererMetadata.map((r) => r.id),
  exportPresetIds: fashionExportPresets.map((p) => p.id),
  dependencies: [
    {
      id: "creative-workflow-v2",
      required: true,
      minVersion: "1.0.0",
    },
    {
      id: "design-engine-contracts",
      required: false,
      minVersion: "1.0.0",
      // NOTE for Team 39: Currently using local adapter in types/pluginContracts.ts.
      // When @workspace/design-engine-contracts (Team 21) is published, mark this
      // required: true and remove the local adapter file.
    },
  ],
  tags: ["fashion", "apparel", "design", "domain-plugin", "garment", "textile"],
  createdAt: "2026-07-22T00:00:00.000Z",
};

// ── Plugin validation ─────────────────────────────────────────────────────────

interface PluginValidationResult {
  valid: boolean;
  errors: string[];
}

function validateManifestIntegrity(plugin: AssembledFashionPlugin): PluginValidationResult {
  const errors: string[] = [];

  // Validate capability IDs match between manifest and contributions
  const contributedCapabilityIds = new Set(plugin.capabilities.map((c) => c.id));
  for (const id of plugin.manifest.capabilityIds) {
    if (!contributedCapabilityIds.has(id)) {
      errors.push(`Manifest declares capability "${id}" but no contribution found.`);
    }
  }

  // Validate artifact type IDs match
  const contributedArtifactIds = new Set(plugin.artifactTypes.map((a) => a.id));
  for (const id of plugin.manifest.artifactTypeIds) {
    if (!contributedArtifactIds.has(id)) {
      errors.push(`Manifest declares artifact type "${id}" but no contribution found.`);
    }
  }

  // Validate property section IDs match
  const contributedSectionIds = new Set(plugin.propertySections.map((s) => s.id));
  for (const id of plugin.manifest.propertySectionIds) {
    if (!contributedSectionIds.has(id)) {
      errors.push(`Manifest declares property section "${id}" but no contribution found.`);
    }
  }

  // Validate material category IDs match
  const contributedMaterialIds = new Set(plugin.materialCategories.map((m) => m.id));
  for (const id of plugin.manifest.materialCategoryIds) {
    if (!contributedMaterialIds.has(id)) {
      errors.push(`Manifest declares material category "${id}" but no contribution found.`);
    }
  }

  // Validate component category IDs match
  const contributedComponentIds = new Set(plugin.componentCategories.map((c) => c.id));
  for (const id of plugin.manifest.componentCategoryIds) {
    if (!contributedComponentIds.has(id)) {
      errors.push(`Manifest declares component category "${id}" but no contribution found.`);
    }
  }

  // Validate export preset IDs match
  const contributedPresetIds = new Set(plugin.exportPresets.map((p) => p.id));
  for (const id of plugin.manifest.exportPresetIds) {
    if (!contributedPresetIds.has(id)) {
      errors.push(`Manifest declares export preset "${id}" but no contribution found.`);
    }
  }

  // Validate contractVersion
  if (plugin.manifest.contractVersion !== PLUGIN_CONTRACT_VERSION) {
    errors.push(
      `Manifest contractVersion "${plugin.manifest.contractVersion}" does not match ` +
        `PLUGIN_CONTRACT_VERSION "${PLUGIN_CONTRACT_VERSION}".`,
    );
  }

  return { valid: errors.length === 0, errors };
}

// ── Loader ────────────────────────────────────────────────────────────────────

let _cachedPlugin: AssembledFashionPlugin | null = null;

/**
 * Load (and cache) the assembled fashion plugin.
 * Validates manifest integrity on first load — throws if the plugin is misconfigured.
 * Subsequent calls return the cached instance without re-validating.
 */
export function loadFashionPlugin(): AssembledFashionPlugin {
  if (_cachedPlugin) return _cachedPlugin;

  const plugin: AssembledFashionPlugin = {
    manifest: MANIFEST,
    artifactTypes: fashionArtifactTypes,
    capabilities: fashionCapabilities,
    materialCategories: fashionMaterialCategories,
    componentCategories: fashionComponentCategories,
    propertySections: fashionPropertySections,
    rendererMetadata: fashionRendererMetadata,
    exportPresets: fashionExportPresets,
  };

  const validation = validateManifestIntegrity(plugin);
  if (!validation.valid) {
    throw new Error(
      `Fashion plugin failed manifest integrity check:\n${validation.errors.join("\n")}`,
    );
  }

  _cachedPlugin = plugin;
  return plugin;
}

/** Returns true when the provided capability ID is supported by this plugin. */
export function fashionPluginSupportsCapability(capabilityId: string): boolean {
  return isFashionCapabilitySupported(capabilityId);
}

/**
 * Reset the plugin cache (for testing only).
 * @internal
 */
export function _resetFashionPluginCache(): void {
  _cachedPlugin = null;
}
