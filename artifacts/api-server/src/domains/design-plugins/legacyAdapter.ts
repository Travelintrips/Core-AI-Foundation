/**
 * Domain Plugin Framework — Legacy Service Alias Adapter (Team 07)
 *
 * Maps existing service-catalog slugs to plugin IDs without modifying
 * the production service catalog schema.
 *
 * Rule: use this registry/alias map as the single source of truth.
 * Do NOT scatter slug→plugin mappings in switch statements elsewhere.
 *
 * Adding a new mapping: append to LEGACY_SERVICE_ALIAS_MAP below.
 * Removing a mapping requires a compatibility plan — never silently
 * break an existing service slug.
 */

/** Maps legacy service_type / slug → plugin ID */
export const LEGACY_SERVICE_ALIAS_MAP: Record<string, string> = {
  // Core design domains
  fashion_design: "fashion",
  interior_design: "interior",
  packaging_design: "packaging",
  brand_identity: "branding",
  graphic_design: "graphic",
  product_design: "product",
  presentation_document: "presentation",

  // Alternative slug spellings found in the codebase
  "fashion-design": "fashion",
  "interior-design": "interior",
  "packaging-design": "packaging",
  "brand-identity": "branding",
  "graphic-design": "graphic",
  "product-design": "product",
  "presentation-document": "presentation",

  // Future / planned domains (register early so teams can reference them)
  furniture_design: "furniture",
  architecture_design: "architecture",
  "furniture-design": "furniture",
  "architecture-design": "architecture",
};

/**
 * Resolve a legacy service slug to a plugin ID.
 * Returns undefined when no mapping exists (caller should treat the
 * slug as its own identity or as an unregistered domain).
 */
export function resolveAlias(serviceSlug: string): string | undefined {
  return LEGACY_SERVICE_ALIAS_MAP[serviceSlug];
}

/**
 * Reverse lookup: given a plugin ID, return all known legacy slugs
 * that map to it.  Useful for migration tooling.
 */
export function getSlugsForPluginId(pluginId: string): string[] {
  return Object.entries(LEGACY_SERVICE_ALIAS_MAP)
    .filter(([, id]) => id === pluginId)
    .map(([slug]) => slug);
}
