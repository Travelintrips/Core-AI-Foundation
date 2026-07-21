/**
 * Domain Plugin Framework — Safe Client Projection (Team 07)
 *
 * Transforms a server-side RegistryEntry into a SafePluginManifest
 * that can be serialised and sent to clients.
 *
 * SECURITY: This projection MUST NOT include:
 *   - tenantPolicy (internal auth rules)
 *   - featureFlag keys
 *   - rendererAdapters internal config
 *   - raw contribution schemas (implementation detail)
 *   - registeredAt as a Date object (use ISO string)
 *   - any server module path or internal executor reference
 */

import type { RegistryEntry, SafePluginManifest } from "./types.js";

export function toSafeManifest(entry: RegistryEntry): SafePluginManifest {
  const c = entry.manifest.contributions ?? {};

  return {
    id: entry.manifest.id,
    version: entry.manifest.version,
    name: entry.manifest.name,
    description: entry.manifest.description,
    status: entry.status,
    contributions: {
      briefSchemas: (c.briefSchemas?.length ?? 0) > 0,
      workflowDefinitions: (c.workflowDefinitions?.length ?? 0) > 0,
      capabilityRefs: c.capabilityRefs ?? [],
      materialCategories: (c.materialCategories ?? []).map((m) => m.categoryId),
      componentCategories: (c.componentCategories ?? []).map((m) => m.categoryId),
      exportProfiles: (c.exportProfiles ?? []).map((p) => p.profileId),
      supportedLocales: c.localizationMetadata?.supportedLocales ?? [],
    },
    registeredAt: entry.registeredAt.toISOString(),
  };
}

export function toSafeManifestList(
  entries: RegistryEntry[],
): SafePluginManifest[] {
  return entries.map(toSafeManifest);
}
