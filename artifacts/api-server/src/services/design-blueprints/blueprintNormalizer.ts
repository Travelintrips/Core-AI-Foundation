/**
 * Blueprint Normalizer (Team 7)
 *
 * Applies deterministic normalization to a Blueprint object.
 * Normalization is idempotent — running it twice yields the same result.
 *
 * Operations performed:
 *  1. Trim whitespace from all string fields
 *  2. Lowercase and deduplicate tags
 *  3. Sort zones by zIndex asc, then id asc (deterministic layer order)
 *  4. Sort slots by id asc
 *  5. Sort slotRefs within each zone
 *  6. Sort requiredData by key asc
 *  7. Sort outputCapabilities by format asc
 *  8. Sort supportedComponents by type asc
 *  9. Remove duplicate tags
 * 10. Coerce undefined optional arrays to []
 * 11. Clamp dpi to valid range [72, 2400] if provided
 * 12. Ensure schemaVersion is set to current version
 * 13. Set updatedAt to provided timestamp (or leave as-is for built-ins)
 */

import type { Blueprint, NormalizationResult } from "./types.js";
import { BLUEPRINT_SCHEMA_VERSION } from "./types.js";

function trimString(s: string): string {
  return typeof s === "string" ? s.trim() : s;
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

function uniqueSorted(arr: string[]): string[] {
  return [...new Set(arr.map(normalizeTag).filter((t) => t.length > 0))].sort();
}

/**
 * Deep-clone + normalize a Blueprint.
 * Never mutates the input — always returns a new object.
 */
export function normalizeBlueprint(input: Blueprint, updatedAt?: string): NormalizationResult {
  const changes: string[] = [];
  // Deep clone to avoid mutation
  const bp: Blueprint = JSON.parse(JSON.stringify(input)) as Blueprint;

  // 1. schemaVersion
  if (bp.schemaVersion !== BLUEPRINT_SCHEMA_VERSION) {
    changes.push(`schemaVersion set to "${BLUEPRINT_SCHEMA_VERSION}" (was "${bp.schemaVersion}")`);
    bp.schemaVersion = BLUEPRINT_SCHEMA_VERSION;
  }

  // 2. Trim top-level strings
  const trimFields: (keyof Blueprint)[] = ["name", "description", "slug", "version"];
  for (const field of trimFields) {
    const orig = bp[field] as string;
    const trimmed = trimString(orig);
    if (orig !== trimmed) {
      changes.push(`Trimmed whitespace from "${field}"`);
      (bp as any)[field] = trimmed;
    }
  }

  // 3. Normalize slug to kebab-case lowercase
  const origSlug = bp.slug;
  bp.slug = bp.slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (bp.slug !== origSlug) {
    changes.push(`Normalized slug from "${origSlug}" to "${bp.slug}"`);
  }

  // 4. Tags — lowercase, deduplicate, sort
  const origIndustry = [...bp.industryTags];
  const origStyle = [...bp.styleTags];
  bp.industryTags = uniqueSorted(bp.industryTags);
  bp.styleTags = uniqueSorted(bp.styleTags);
  if (JSON.stringify(origIndustry) !== JSON.stringify(bp.industryTags)) {
    changes.push("Normalized industryTags (deduplicated + sorted)");
  }
  if (JSON.stringify(origStyle) !== JSON.stringify(bp.styleTags)) {
    changes.push("Normalized styleTags (deduplicated + sorted)");
  }

  // 5. DPI clamp
  if (bp.dimensions.dpi !== undefined) {
    const clamped = Math.min(2400, Math.max(72, bp.dimensions.dpi));
    if (clamped !== bp.dimensions.dpi) {
      changes.push(`Clamped dimensions.dpi from ${bp.dimensions.dpi} to ${clamped}`);
      bp.dimensions.dpi = clamped;
    }
  }

  // 6. Sort zones: zIndex asc, then id asc
  const origZoneOrder = bp.zones.map((z) => z.id).join(",");
  bp.zones = [...bp.zones].sort((a, b) => {
    const zi = (a.zIndex ?? 0) - (b.zIndex ?? 0);
    return zi !== 0 ? zi : a.id.localeCompare(b.id);
  });
  // Normalize zone fields
  for (const zone of bp.zones) {
    zone.name = trimString(zone.name);
    if (zone.description) zone.description = trimString(zone.description);
    zone.slotRefs = [...new Set(zone.slotRefs)].sort();
  }
  if (origZoneOrder !== bp.zones.map((z) => z.id).join(",")) {
    changes.push("Sorted zones by zIndex then id");
  }

  // 7. Sort slots by id asc
  const origSlotOrder = bp.slots.map((s) => s.id).join(",");
  bp.slots = [...bp.slots].sort((a, b) => a.id.localeCompare(b.id));
  for (const slot of bp.slots) {
    slot.name = trimString(slot.name);
    if (slot.description) slot.description = trimString(slot.description);
    if (slot.defaultValue !== undefined) slot.defaultValue = trimString(slot.defaultValue);
    // Sort allowedFormats if present
    if (slot.constraints.allowedFormats) {
      slot.constraints.allowedFormats = [...slot.constraints.allowedFormats].sort();
    }
  }
  if (origSlotOrder !== bp.slots.map((s) => s.id).join(",")) {
    changes.push("Sorted slots by id");
  }

  // 8. Sort requiredData by key asc
  const origDataOrder = bp.requiredData.map((d) => d.key).join(",");
  bp.requiredData = [...bp.requiredData].sort((a, b) => a.key.localeCompare(b.key));
  for (const field of bp.requiredData) {
    field.key = trimString(field.key);
    field.label = trimString(field.label);
    if (field.description) field.description = trimString(field.description);
    if (field.allowedValues) field.allowedValues = [...field.allowedValues].sort();
  }
  if (origDataOrder !== bp.requiredData.map((d) => d.key).join(",")) {
    changes.push("Sorted requiredData by key");
  }

  // 9. Sort outputCapabilities by format asc
  const origOutputOrder = bp.outputCapabilities.map((o) => o.format).join(",");
  bp.outputCapabilities = [...bp.outputCapabilities].sort((a, b) => a.format.localeCompare(b.format));
  if (origOutputOrder !== bp.outputCapabilities.map((o) => o.format).join(",")) {
    changes.push("Sorted outputCapabilities by format");
  }

  // 10. Sort supportedComponents by type asc
  const origCompOrder = bp.supportedComponents.map((c) => c.type).join(",");
  bp.supportedComponents = [...bp.supportedComponents].sort((a, b) => a.type.localeCompare(b.type));
  for (const comp of bp.supportedComponents) {
    comp.type = trimString(comp.type);
    comp.versionRange = trimString(comp.versionRange);
    comp.fillsSlotTypes = [...new Set(comp.fillsSlotTypes)].sort() as typeof comp.fillsSlotTypes;
  }
  if (origCompOrder !== bp.supportedComponents.map((c) => c.type).join(",")) {
    changes.push("Sorted supportedComponents by type");
  }

  // 11. Coerce undefined arrays
  if (!Array.isArray(bp.constraints.requiredZoneIds)) {
    bp.constraints.requiredZoneIds = [];
  }
  if (!Array.isArray(bp.constraints.mutuallyExclusiveSlots)) {
    bp.constraints.mutuallyExclusiveSlots = [];
  }

  // 12. updatedAt
  if (updatedAt) {
    bp.updatedAt = updatedAt;
    changes.push(`Set updatedAt to "${updatedAt}"`);
  }

  return { blueprint: bp, changes };
}
