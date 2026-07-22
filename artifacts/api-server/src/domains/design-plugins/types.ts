/**
 * Domain Plugin Framework — Core Types (Team 07)
 *
 * Defines the DesignPlugin manifest contract, lifecycle status,
 * and contribution shape that all domain plugins must satisfy.
 *
 * SECURITY: These types represent the SERVER-SIDE contract.
 * Never send RegistryEntry or InternalPluginConfig to clients.
 * Use SafePluginManifest (clientProjection.ts) for client responses.
 */

import { z } from "zod";

// ── Contract version ──────────────────────────────────────────────────────────
/** Framework contract version.  Plugins must declare compatibility. */
export const PLUGIN_CONTRACT_VERSION = "1" as const;
export type ContractVersion = typeof PLUGIN_CONTRACT_VERSION;

// ── Lifecycle status ──────────────────────────────────────────────────────────
export const PLUGIN_STATUS = [
  "registered",
  "enabled",
  "disabled",
  "incompatible",
  "unhealthy",
] as const;

export type PluginStatus = (typeof PLUGIN_STATUS)[number];

// ── Contribution schemas (all optional — extend without breaking) ──────────────

export const BriefSchemaContributionSchema = z.object({
  schemaId: z.string(),
  version: z.string(),
  /** JSON-schema-compatible shape describing brief fields */
  shape: z.record(z.unknown()),
});
export type BriefSchemaContribution = z.infer<typeof BriefSchemaContributionSchema>;

export const WorkflowDefinitionSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  steps: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const ArtifactSchemaContributionSchema = z.object({
  artifactType: z.string(),
  version: z.string(),
  shape: z.record(z.unknown()),
});
export type ArtifactSchemaContribution = z.infer<typeof ArtifactSchemaContributionSchema>;

export const MaterialCategorySchema = z.object({
  categoryId: z.string(),
  name: z.string(),
  subCategories: z.array(z.string()).optional(),
});
export type MaterialCategory = z.infer<typeof MaterialCategorySchema>;

export const ComponentCategorySchema = z.object({
  categoryId: z.string(),
  name: z.string(),
  subCategories: z.array(z.string()).optional(),
});
export type ComponentCategory = z.infer<typeof ComponentCategorySchema>;

export const PropertyPanelDefinitionSchema = z.object({
  panelId: z.string(),
  label: z.string(),
  fields: z.array(z.record(z.unknown())),
});
export type PropertyPanelDefinition = z.infer<typeof PropertyPanelDefinitionSchema>;

/**
 * Renderer adapter reference: a string key used to look up the adapter
 * in the server's renderer registry.  Never a module path or URL.
 */
export const RendererAdapterRefSchema = z.object({
  adapterId: z.string(),
  supportedFormats: z.array(z.string()),
});
export type RendererAdapterRef = z.infer<typeof RendererAdapterRefSchema>;

export const ExportProfileSchema = z.object({
  profileId: z.string(),
  name: z.string(),
  format: z.string(),
  options: z.record(z.unknown()).optional(),
});
export type ExportProfile = z.infer<typeof ExportProfileSchema>;

export const LocalizationMetadataSchema = z.object({
  defaultLocale: z.string(),
  supportedLocales: z.array(z.string()),
  namespaces: z.array(z.string()).optional(),
});
export type LocalizationMetadata = z.infer<typeof LocalizationMetadataSchema>;

export const ValidationRuleSchema = z.object({
  ruleId: z.string(),
  description: z.string(),
  /** Opaque rule config — interpreted by the domain's own validation layer */
  config: z.record(z.unknown()).optional(),
});
export type ValidationRule = z.infer<typeof ValidationRuleSchema>;

// ── Tenant / availability policy ──────────────────────────────────────────────
export const TenantPolicySchema = z.object({
  /** If set, plugin is only available for these tenant IDs */
  allowedTenantIds: z.array(z.string()).optional(),
  /** If set, plugin is restricted to these service codes */
  allowedServiceCodes: z.array(z.string()).optional(),
  /** If true, caller must hold platform-level scope */
  requiresPlatformScope: z.boolean().optional(),
});
export type TenantPolicy = z.infer<typeof TenantPolicySchema>;

// ── Plugin contributions ───────────────────────────────────────────────────────
export const PluginContributionsSchema = z.object({
  briefSchemas: z.array(BriefSchemaContributionSchema).optional(),
  workflowDefinitions: z.array(WorkflowDefinitionSchema).optional(),
  capabilityRefs: z.array(z.string()).optional(),
  artifactSchemas: z.array(ArtifactSchemaContributionSchema).optional(),
  materialCategories: z.array(MaterialCategorySchema).optional(),
  componentCategories: z.array(ComponentCategorySchema).optional(),
  propertyPanels: z.array(PropertyPanelDefinitionSchema).optional(),
  rendererAdapters: z.array(RendererAdapterRefSchema).optional(),
  exportProfiles: z.array(ExportProfileSchema).optional(),
  localizationMetadata: LocalizationMetadataSchema.optional(),
  validationRules: z.array(ValidationRuleSchema).optional(),
}).strict();
export type PluginContributions = z.infer<typeof PluginContributionsSchema>;

// ── Main plugin manifest ───────────────────────────────────────────────────────
export const DesignPluginManifestSchema = z.object({
  /** Stable unique identifier — kebab-case, e.g. "fashion", "interior" */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, "Plugin ID must be kebab-case"),
  /** SemVer string */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "version must be semver (X.Y.Z)"),
  /** Human-readable name */
  name: z.string().min(1),
  description: z.string().optional(),
  /** Must equal PLUGIN_CONTRACT_VERSION — checked by loader */
  contractVersion: z.string(),
  contributions: PluginContributionsSchema.optional(),
  tenantPolicy: TenantPolicySchema.optional(),
  /**
   * Optional feature-flag key.  If set, plugin is only enabled when
   * this flag resolves to true via the feature-flag service.
   */
  featureFlag: z.string().optional(),
}).strict();

export type DesignPluginManifest = z.infer<typeof DesignPluginManifestSchema>;

// ── Internal registry entry (server-only) ─────────────────────────────────────
export interface PluginDiagnostics {
  lastCheckedAt: Date;
  healthy: boolean;
  notes: string[];
}

export interface RegistryEntry {
  manifest: DesignPluginManifest;
  status: PluginStatus;
  registeredAt: Date;
  diagnostics: PluginDiagnostics;
}

// ── Safe client projection (no internal implementation details) ───────────────
export interface SafePluginManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  status: PluginStatus;
  contributions: {
    briefSchemas: boolean;
    workflowDefinitions: boolean;
    capabilityRefs: string[];
    materialCategories: string[];
    componentCategories: string[];
    exportProfiles: string[];
    supportedLocales: string[];
  };
  registeredAt: string; // ISO date
}

// ── Registration result ───────────────────────────────────────────────────────
export type RegistrationResult =
  | { ok: true; pluginId: string; status: PluginStatus }
  | { ok: false; pluginId: string; reason: string };
