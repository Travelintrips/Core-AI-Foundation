/**
 * Blueprint Validator (Team 7)
 *
 * Validates a Blueprint object against structural and domain rules.
 * Returns a ValidationResult with typed issues (error | warning | info).
 *
 * Checks performed:
 *  1. Required top-level fields
 *  2. Dimension bounds
 *  3. Slot IDs are unique
 *  4. Zone slotRefs point to existing slot IDs
 *  5. Zone bounds are within canvas dimensions (when unit matches)
 *  6. Required slots declared by required zones exist
 *  7. Blueprint constraints (maxZones, maxSlots, mutuallyExclusiveSlots)
 *  8. Component version range format (semver-like)
 *  9. Required data field keys are unique and valid identifiers
 * 10. Output capabilities list at least one format
 * 11. Industry/style tags are non-empty strings
 * 12. Semver-like version string
 * 13. Malformed constraints (negative values, impossible ranges)
 */

import type {
  Blueprint,
  ValidationResult,
  ValidationIssue,
  BlueprintZone,
  BlueprintSlot,
  SlotConstraints,
} from "./types.js";
import { BLUEPRINT_DOMAINS, BLUEPRINT_STATUSES, DIMENSION_UNITS, SLOT_TYPES, DATA_FIELD_TYPES, OUTPUT_FORMATS } from "./types.js";

// ── Semver-like pattern ────────────────────────────────────────────────────────
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SEMVER_RANGE_RE = /^[><=^~*]?[><=^~]?\s*\d[\d.*x-]*(\s+<\s*\d[\d.*x-]*)?$/;
const SAFE_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const UUID_OR_SHORT_RE = /^[a-zA-Z0-9_-]{1,100}$/;

function issue(
  severity: ValidationIssue["severity"],
  code: string,
  path: string,
  message: string
): ValidationIssue {
  return { severity, code, path, message };
}

// ── Dimension validation ──────────────────────────────────────────────────────

function validateDimensions(bp: Blueprint, issues: ValidationIssue[]): void {
  const d = bp.dimensions;
  if (!DIMENSION_UNITS.includes(d.unit as any)) {
    issues.push(issue("error", "INVALID_DIMENSION_UNIT", "dimensions.unit", `Unknown unit "${d.unit}". Allowed: ${DIMENSION_UNITS.join(", ")}`));
  }
  if (d.width <= 0) issues.push(issue("error", "DIMENSION_NON_POSITIVE", "dimensions.width", "Width must be > 0"));
  if (d.height <= 0) issues.push(issue("error", "DIMENSION_NON_POSITIVE", "dimensions.height", "Height must be > 0"));
  if (d.dpi !== undefined && (d.dpi < 72 || d.dpi > 2400)) {
    issues.push(issue("error", "DPI_OUT_OF_RANGE", "dimensions.dpi", `DPI ${d.dpi} is outside the allowed range 72–2400`));
  }
}

// ── Slot validation ───────────────────────────────────────────────────────────

function validateSlots(bp: Blueprint, issues: ValidationIssue[]): Set<string> {
  const seenIds = new Set<string>();
  const validSlotIds = new Set<string>();

  for (let i = 0; i < (bp.slots ?? []).length; i++) {
    const slot = (bp.slots ?? [])[i]!;
    const path = `slots[${i}]`;

    if (!slot.id || !UUID_OR_SHORT_RE.test(slot.id)) {
      issues.push(issue("error", "INVALID_SLOT_ID", `${path}.id`, `Slot id "${slot.id}" is missing or malformed`));
    }
    if (!slot.name || slot.name.trim().length === 0) {
      issues.push(issue("error", "MISSING_SLOT_NAME", `${path}.name`, "Slot name is required"));
    }
    if (!SLOT_TYPES.includes(slot.type as any)) {
      issues.push(issue("error", "INVALID_SLOT_TYPE", `${path}.type`, `Unknown slot type "${slot.type}". Allowed: ${SLOT_TYPES.join(", ")}`));
    }
    if (slot.id && seenIds.has(slot.id)) {
      issues.push(issue("error", "DUPLICATE_SLOT_ID", `${path}.id`, `Slot id "${slot.id}" is duplicated`));
    }

    validateSlotConstraints(slot.constraints, `${path}.constraints`, issues, slot.type);

    seenIds.add(slot.id);
    validSlotIds.add(slot.id);
  }

  return validSlotIds;
}

function validateSlotConstraints(c: SlotConstraints, path: string, issues: ValidationIssue[], slotType: string): void {
  if (c.minWidth !== undefined && c.maxWidth !== undefined && c.minWidth > c.maxWidth) {
    issues.push(issue("error", "IMPOSSIBLE_WIDTH_RANGE", path, `minWidth (${c.minWidth}) > maxWidth (${c.maxWidth})`));
  }
  if (c.minHeight !== undefined && c.maxHeight !== undefined && c.minHeight > c.maxHeight) {
    issues.push(issue("error", "IMPOSSIBLE_HEIGHT_RANGE", path, `minHeight (${c.minHeight}) > maxHeight (${c.maxHeight})`));
  }
  if (c.minFontSize !== undefined && c.maxFontSize !== undefined && c.minFontSize > c.maxFontSize) {
    issues.push(issue("error", "IMPOSSIBLE_FONT_SIZE_RANGE", path, `minFontSize (${c.minFontSize}) > maxFontSize (${c.maxFontSize})`));
  }
  if (c.minChars !== undefined && c.maxChars !== undefined && c.minChars > c.maxChars) {
    issues.push(issue("error", "IMPOSSIBLE_CHAR_RANGE", path, `minChars (${c.minChars}) > maxChars (${c.maxChars})`));
  }
  if ((c.minWidth !== undefined && c.minWidth < 0) || (c.maxWidth !== undefined && c.maxWidth < 0)) {
    issues.push(issue("error", "NEGATIVE_CONSTRAINT", path, "Width constraints must be non-negative"));
  }
  if (c.maxFileSizeMb !== undefined && c.maxFileSizeMb <= 0) {
    issues.push(issue("error", "INVALID_FILE_SIZE", path, "maxFileSizeMb must be > 0"));
  }
  if (c.maxRows !== undefined && c.maxColumns !== undefined) {
    if (c.maxRows <= 0) issues.push(issue("error", "INVALID_TABLE_ROWS", path, "maxRows must be > 0"));
    if (c.maxColumns <= 0) issues.push(issue("error", "INVALID_TABLE_COLS", path, "maxColumns must be > 0"));
  }
  // Slot type vs constraint coherence warnings
  if (slotType === "text" && c.allowedFormats !== undefined) {
    issues.push(issue("warning", "IRRELEVANT_CONSTRAINT", path, "allowedFormats is not applicable to text slots"));
  }
  if (slotType === "image" && c.maxChars !== undefined) {
    issues.push(issue("warning", "IRRELEVANT_CONSTRAINT", path, "maxChars is not applicable to image slots"));
  }
}

// ── Zone validation ───────────────────────────────────────────────────────────

function validateZones(bp: Blueprint, validSlotIds: Set<string>, issues: ValidationIssue[]): void {
  const seenIds = new Set<string>();
  const pixelUnits = new Set(["px"]);
  const canvasW = bp.dimensions?.width ?? 0;
  const canvasH = bp.dimensions?.height ?? 0;
  const checkBounds = bp.dimensions ? pixelUnits.has(bp.dimensions.unit) : false;

  for (let i = 0; i < (bp.zones ?? []).length; i++) {
    const zone: BlueprintZone = (bp.zones ?? [])[i]!;
    const path = `zones[${i}]`;

    if (!zone.id || !UUID_OR_SHORT_RE.test(zone.id)) {
      issues.push(issue("error", "INVALID_ZONE_ID", `${path}.id`, `Zone id "${zone.id}" is missing or malformed`));
    }
    if (!zone.name || zone.name.trim().length === 0) {
      issues.push(issue("error", "MISSING_ZONE_NAME", `${path}.name`, "Zone name is required"));
    }
    if (zone.id && seenIds.has(zone.id)) {
      issues.push(issue("error", "DUPLICATE_ZONE_ID", `${path}.id`, `Zone id "${zone.id}" is duplicated`));
    }
    if (zone.width <= 0) issues.push(issue("error", "ZONE_NON_POSITIVE", `${path}.width`, "Zone width must be > 0"));
    if (zone.height <= 0) issues.push(issue("error", "ZONE_NON_POSITIVE", `${path}.height`, "Zone height must be > 0"));

    if (checkBounds) {
      if (zone.x < 0 || zone.y < 0) {
        issues.push(issue("warning", "ZONE_NEGATIVE_ORIGIN", path, `Zone "${zone.id}" has negative origin (x=${zone.x}, y=${zone.y})`));
      }
      if (zone.x + zone.width > canvasW || zone.y + zone.height > canvasH) {
        issues.push(issue("warning", "ZONE_EXCEEDS_CANVAS", path, `Zone "${zone.id}" extends beyond canvas bounds (${canvasW}x${canvasH})`));
      }
    }

    // Validate slotRefs
    for (const ref of zone.slotRefs) {
      if (!validSlotIds.has(ref)) {
        issues.push(issue("error", "DANGLING_SLOT_REF", `${path}.slotRefs`, `slotRef "${ref}" does not match any slot id`));
      }
    }

    seenIds.add(zone.id);
  }

  // Zone overlap check (px only, if disallowed)
  if (!bp.constraints?.allowZoneOverlap && checkBounds) {
    checkZoneOverlaps(bp.zones ?? [], issues);
  }
}

function checkZoneOverlaps(zones: BlueprintZone[], issues: ValidationIssue[]): void {
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i]!;
      const b = zones[j]!;
      const overlaps =
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
      if (overlaps) {
        issues.push(issue("error", "ZONE_OVERLAP", `zones`, `Zones "${a.id}" and "${b.id}" overlap, but allowZoneOverlap is false`));
      }
    }
  }
}

// ── Blueprint constraints validation ──────────────────────────────────────────

function validateConstraints(bp: Blueprint, issues: ValidationIssue[]): void {
  const c = bp.constraints;
  if (!c || typeof c !== "object") return; // malformed payload guard
  if (c.maxZones !== undefined && c.maxZones < (bp.zones ?? []).length) {
    issues.push(issue("error", "MAX_ZONES_EXCEEDED", "constraints.maxZones", `Blueprint has ${bp.zones.length} zones but maxZones is ${c.maxZones}`));
  }
  if (c.maxSlots !== undefined && c.maxSlots < (bp.slots ?? []).length) {
    issues.push(issue("error", "MAX_SLOTS_EXCEEDED", "constraints.maxSlots", `Blueprint has ${bp.slots.length} slots but maxSlots is ${c.maxSlots}`));
  }
  const zoneIds = new Set((bp.zones ?? []).map((z) => z.id));
  for (const reqZoneId of (c.requiredZoneIds ?? [])) {
    if (!zoneIds.has(reqZoneId)) {
      issues.push(issue("error", "MISSING_REQUIRED_ZONE", "constraints.requiredZoneIds", `Required zone "${reqZoneId}" is not defined in zones`));
    }
  }
  if (c.minContentCoverage !== undefined && (c.minContentCoverage < 0 || c.minContentCoverage > 1)) {
    issues.push(issue("error", "INVALID_COVERAGE", "constraints.minContentCoverage", "minContentCoverage must be between 0 and 1"));
  }
  if (c.maxContentCoverage !== undefined && (c.maxContentCoverage < 0 || c.maxContentCoverage > 1)) {
    issues.push(issue("error", "INVALID_COVERAGE", "constraints.maxContentCoverage", "maxContentCoverage must be between 0 and 1"));
  }
  if (
    c.minContentCoverage !== undefined &&
    c.maxContentCoverage !== undefined &&
    c.minContentCoverage > c.maxContentCoverage
  ) {
    issues.push(issue("error", "IMPOSSIBLE_COVERAGE_RANGE", "constraints", `minContentCoverage (${c.minContentCoverage}) > maxContentCoverage (${c.maxContentCoverage})`));
  }
  const slotIds = new Set((bp.slots ?? []).map((s) => s.id));
  for (const group of (c.mutuallyExclusiveSlots ?? [])) {
    for (const sid of group) {
      if (!slotIds.has(sid)) {
        issues.push(issue("error", "DANGLING_EXCLUSIVE_SLOT", "constraints.mutuallyExclusiveSlots", `Slot "${sid}" in mutuallyExclusiveSlots not found`));
      }
    }
  }
}

// ── Component validation ──────────────────────────────────────────────────────

function validateComponents(bp: Blueprint, issues: ValidationIssue[]): void {
  if (!Array.isArray(bp.supportedComponents)) return;
  const seenTypes = new Set<string>();
  for (let i = 0; i < bp.supportedComponents.length; i++) {
    const comp = bp.supportedComponents[i]!;
    const path = `supportedComponents[${i}]`;
    if (!comp.type || comp.type.trim().length === 0) {
      issues.push(issue("error", "MISSING_COMPONENT_TYPE", `${path}.type`, "Component type is required"));
    }
    if (seenTypes.has(comp.type)) {
      issues.push(issue("warning", "DUPLICATE_COMPONENT_TYPE", `${path}.type`, `Component type "${comp.type}" appears more than once`));
    }
    if (!comp.versionRange || !SEMVER_RANGE_RE.test(comp.versionRange.trim())) {
      issues.push(issue("error", "INVALID_VERSION_RANGE", `${path}.versionRange`, `Version range "${comp.versionRange}" is not a valid semver range`));
    }
    for (const st of comp.fillsSlotTypes) {
      if (!SLOT_TYPES.includes(st as any)) {
        issues.push(issue("error", "INVALID_SLOT_TYPE_REF", `${path}.fillsSlotTypes`, `Unknown slot type "${st}" in fillsSlotTypes`));
      }
    }
    seenTypes.add(comp.type);
  }
}

// ── Required data validation ──────────────────────────────────────────────────

function validateRequiredData(bp: Blueprint, issues: ValidationIssue[]): void {
  if (!Array.isArray(bp.requiredData)) return;
  const seenKeys = new Set<string>();
  for (let i = 0; i < bp.requiredData.length; i++) {
    const field = bp.requiredData[i]!;
    const path = `requiredData[${i}]`;
    if (!field.key || !SAFE_KEY_RE.test(field.key)) {
      issues.push(issue("error", "INVALID_DATA_KEY", `${path}.key`, `Data key "${field.key}" must be a valid identifier`));
    }
    if (seenKeys.has(field.key)) {
      issues.push(issue("error", "DUPLICATE_DATA_KEY", `${path}.key`, `Data key "${field.key}" is duplicated`));
    }
    if (!DATA_FIELD_TYPES.includes(field.type as any)) {
      issues.push(issue("error", "INVALID_DATA_TYPE", `${path}.type`, `Unknown data type "${field.type}"`));
    }
    if (field.type === "enum" && (!field.allowedValues || field.allowedValues.length === 0)) {
      issues.push(issue("error", "ENUM_NO_VALUES", `${path}.allowedValues`, `Enum field "${field.key}" must declare allowedValues`));
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      issues.push(issue("error", "IMPOSSIBLE_RANGE", `${path}`, `min (${field.min}) > max (${field.max}) for field "${field.key}"`));
    }
    seenKeys.add(field.key);
  }
}

// ── Output capabilities ───────────────────────────────────────────────────────

function validateOutputCapabilities(bp: Blueprint, issues: ValidationIssue[]): void {
  if (!Array.isArray(bp.outputCapabilities) || bp.outputCapabilities.length === 0) {
    issues.push(issue("error", "NO_OUTPUT_FORMATS", "outputCapabilities", "Blueprint must declare at least one output format"));
  }
  for (let i = 0; i < (bp.outputCapabilities ?? []).length; i++) {
    const cap = bp.outputCapabilities[i]!;
    const path = `outputCapabilities[${i}]`;
    if (!OUTPUT_FORMATS.includes(cap.format as any)) {
      issues.push(issue("error", "INVALID_OUTPUT_FORMAT", `${path}.format`, `Unknown output format "${cap.format}"`));
    }
    if (cap.maxDpi !== undefined && (cap.maxDpi < 72 || cap.maxDpi > 2400)) {
      issues.push(issue("warning", "DPI_OUT_OF_RANGE", `${path}.maxDpi`, `maxDpi ${cap.maxDpi} is outside the typical range 72–2400`));
    }
    if (cap.bleedMm !== undefined && cap.bleedMm < 0) {
      issues.push(issue("error", "NEGATIVE_BLEED", `${path}.bleedMm`, "bleedMm cannot be negative"));
    }
  }
}

// ── Tags ──────────────────────────────────────────────────────────────────────

function validateTags(bp: Blueprint, issues: ValidationIssue[]): void {
  for (let i = 0; i < (bp.industryTags ?? []).length; i++) {
    if (!bp.industryTags[i]?.trim()) {
      issues.push(issue("warning", "EMPTY_TAG", `industryTags[${i}]`, "Industry tag is empty"));
    }
  }
  for (let i = 0; i < (bp.styleTags ?? []).length; i++) {
    if (!bp.styleTags[i]?.trim()) {
      issues.push(issue("warning", "EMPTY_TAG", `styleTags[${i}]`, "Style tag is empty"));
    }
  }
}

// ── Top-level fields ──────────────────────────────────────────────────────────

function validateTopLevel(bp: Blueprint, issues: ValidationIssue[]): void {
  if (!bp.id || !UUID_OR_SHORT_RE.test(bp.id)) {
    issues.push(issue("error", "MISSING_ID", "id", "Blueprint id is required"));
  }
  if (!bp.slug || !/^[a-z0-9-]{1,100}$/.test(bp.slug)) {
    issues.push(issue("error", "INVALID_SLUG", "slug", `Slug "${bp.slug}" must be kebab-case (a-z, 0-9, hyphens only)`));
  }
  if (!BLUEPRINT_DOMAINS.includes(bp.domain as any)) {
    issues.push(issue("error", "INVALID_DOMAIN", "domain", `Unknown domain "${bp.domain}". Allowed: ${BLUEPRINT_DOMAINS.join(", ")}`));
  }
  if (!BLUEPRINT_STATUSES.includes(bp.status as any)) {
    issues.push(issue("error", "INVALID_STATUS", "status", `Unknown status "${bp.status}"`));
  }
  if (!bp.name || bp.name.trim().length === 0) {
    issues.push(issue("error", "MISSING_NAME", "name", "Blueprint name is required"));
  }
  if (!SEMVER_RE.test(bp.version ?? "")) {
    issues.push(issue("error", "INVALID_VERSION", "version", `Version "${bp.version}" must be semver (e.g. 1.0.0)`));
  }
  if (!bp.schemaVersion || bp.schemaVersion !== "1.0") {
    issues.push(issue("error", "UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", `schemaVersion "${bp.schemaVersion}" is not supported. Expected "1.0"`));
  }
  if (!bp.zones || (bp.zones as unknown[]).length === 0) {
    issues.push(issue("error", "NO_ZONES", "zones", "Blueprint must declare at least one zone"));
  }
  if (!bp.slots || (bp.slots as unknown[]).length === 0) {
    issues.push(issue("error", "NO_SLOTS", "slots", "Blueprint must declare at least one slot"));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate a Blueprint object. Returns a ValidationResult.
 * Never throws — all errors are captured as issues.
 */
export function validateBlueprint(bp: unknown): ValidationResult {
  if (!bp || typeof bp !== "object") {
    return {
      valid: false,
      issues: [issue("error", "NOT_AN_OBJECT", "", "Blueprint must be a non-null object")],
    };
  }

  const blueprint = bp as Blueprint;
  const issues: ValidationIssue[] = [];

  validateTopLevel(blueprint, issues);
  // Guard: dimensions may be absent on a malformed payload
  if (blueprint.dimensions && typeof blueprint.dimensions === "object") {
    validateDimensions(blueprint, issues);
  } else if (!blueprint.dimensions) {
    issues.push(issue("error", "MISSING_DIMENSIONS", "dimensions", "Blueprint must have a dimensions object"));
  }
  const validSlotIds = validateSlots(blueprint, issues);
  validateZones(blueprint, validSlotIds, issues);
  validateConstraints(blueprint, issues);
  validateComponents(blueprint, issues);
  validateRequiredData(blueprint, issues);
  validateOutputCapabilities(blueprint, issues);
  validateTags(blueprint, issues);

  return {
    valid: issues.filter((i) => i.severity === "error").length === 0,
    issues,
  };
}
