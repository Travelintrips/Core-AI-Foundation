/**
 * Domain Plugin Framework — Public Exports (Team 07)
 *
 * Import from this barrel when consuming the framework from other server
 * modules.  Internal implementation files (registry internals, _reset*
 * test helpers, etc.) are not re-exported here.
 */

// Types
export type {
  DesignPluginManifest,
  PluginContributions,
  PluginStatus,
  RegistryEntry,
  SafePluginManifest,
  RegistrationResult,
  TenantPolicy,
  BriefSchemaContribution,
  WorkflowDefinition,
  ArtifactSchemaContribution,
  MaterialCategory,
  ComponentCategory,
  PropertyPanelDefinition,
  RendererAdapterRef,
  ExportProfile,
  LocalizationMetadata,
  ValidationRule,
} from "./types.js";
export { PLUGIN_CONTRACT_VERSION, DesignPluginManifestSchema } from "./types.js";

// Registry (read-only surface for consumers)
export { resolvePlugin, listPlugins, listPluginsByStatus } from "./registry.js";

// Loader
export { loadPlugins, type LoaderReport } from "./loader.js";

// Compatibility
export { checkCompatibility, type CompatibilityResult } from "./compatibility.js";

// Feature flags
export { isFlagEnabled, setFlagOverride, clearFlagOverrides } from "./featureFlags.js";

// Tenant policy
export {
  evaluateTenantPolicy,
  type TenantContext,
  type PolicyResult,
} from "./tenantPolicy.js";

// Legacy adapter
export {
  resolveAlias,
  getSlugsForPluginId,
  LEGACY_SERVICE_ALIAS_MAP,
} from "./legacyAdapter.js";

// Safe client projection
export { toSafeManifest, toSafeManifestList } from "./clientProjection.js";

// Hooks
export {
  onPluginEvent,
  dispatchPluginEvent,
  type PluginHookEvent,
  type PluginHookHandler,
} from "./hooks.js";

// Router
export { default as designPluginsRouter } from "./router.js";
