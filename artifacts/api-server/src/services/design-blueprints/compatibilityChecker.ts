/**
 * Blueprint Compatibility Checker (Team 7)
 *
 * Checks whether a given combination of schema version, component types,
 * and filled slot types is compatible with a blueprint.
 *
 * Checks:
 *  1. Schema version compatibility
 *  2. Required components are present in the request
 *  3. Component types are declared as supported by the blueprint
 *  4. Slot types filled by the caller are valid for this blueprint
 *  5. Required slots are at least minimally addressed
 *  6. Blueprint status (deprecated blueprints emit warnings)
 */

import type {
  Blueprint,
  CompatibilityRequest,
  CompatibilityResult,
  CompatibilityIssue,
  SlotType,
} from "./types.js";
import { BLUEPRINT_SCHEMA_VERSION } from "./types.js";

// ── Semver helpers ────────────────────────────────────────────────────────────

/** Parse a simple "MAJOR.MINOR.PATCH" version into a numeric triple. */
function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

/**
 * Very lightweight range checker.
 * Supports: ">=X.Y.Z", ">=X.Y.Z <A.B.C", "^X.Y.Z", "~X.Y.Z", "*"
 * Returns true if the version satisfies the range.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const r = range.trim();
  if (r === "*") return true;

  const parsed = parseSemver(version);
  if (!parsed) return false;
  const [major, minor, patch] = parsed;

  // >=X.Y.Z <A.B.C
  const dualMatch = /^>=\s*(\d+\.\d+\.\d+)\s+<\s*(\d+\.\d+\.\d+)$/.exec(r);
  if (dualMatch) {
    const lo = parseSemver(dualMatch[1]!);
    const hi = parseSemver(dualMatch[2]!);
    if (!lo || !hi) return false;
    const gte = major > lo[0] || (major === lo[0] && minor > lo[1]) || (major === lo[0] && minor === lo[1] && patch >= lo[2]);
    const lt  = major < hi[0] || (major === hi[0] && minor < hi[1]) || (major === hi[0] && minor === hi[1] && patch <  hi[2]);
    return gte && lt;
  }

  // ^X.Y.Z — compatible with major
  const caretMatch = /^\^(\d+\.\d+\.\d+)$/.exec(r);
  if (caretMatch) {
    const base = parseSemver(caretMatch[1]!);
    if (!base) return false;
    return major === base[0] && (minor > base[1] || (minor === base[1] && patch >= base[2]));
  }

  // ~X.Y.Z — compatible with minor
  const tildeMatch = /^~(\d+\.\d+\.\d+)$/.exec(r);
  if (tildeMatch) {
    const base = parseSemver(tildeMatch[1]!);
    if (!base) return false;
    return major === base[0] && minor === base[1] && patch >= base[2];
  }

  // >=X.Y.Z
  const gteMatch = /^>=\s*(\d+\.\d+\.\d+)$/.exec(r);
  if (gteMatch) {
    const base = parseSemver(gteMatch[1]!);
    if (!base) return false;
    return major > base[0] || (major === base[0] && minor > base[1]) || (major === base[0] && minor === base[1] && patch >= base[2]);
  }

  // >X.Y.Z
  const gtMatch = /^>\s*(\d+\.\d+\.\d+)$/.exec(r);
  if (gtMatch) {
    const base = parseSemver(gtMatch[1]!);
    if (!base) return false;
    return major > base[0] || (major === base[0] && minor > base[1]) || (major === base[0] && minor === base[1] && patch > base[2]);
  }

  // <=X.Y.Z
  const lteMatch = /^<=\s*(\d+\.\d+\.\d+)$/.exec(r);
  if (lteMatch) {
    const base = parseSemver(lteMatch[1]!);
    if (!base) return false;
    return major < base[0] || (major === base[0] && minor < base[1]) || (major === base[0] && minor === base[1] && patch <= base[2]);
  }

  // X.Y.Z (exact)
  const exactMatch = /^(\d+\.\d+\.\d+)$/.exec(r);
  if (exactMatch) {
    const base = parseSemver(exactMatch[1]!);
    if (!base) return false;
    return major === base[0] && minor === base[1] && patch === base[2];
  }

  return false;
}

// ── Schema version compatibility ──────────────────────────────────────────────

/** Extract the major version number from a version string like "1", "1.0", or "1.0.0". */
function extractMajor(v: string): number | null {
  const part = v.trim().split(".")[0];
  const n = parseInt(part ?? "", 10);
  return isNaN(n) ? null : n;
}

function checkSchemaVersion(
  requestedVersion: string,
  blueprint: Blueprint,
  issues: CompatibilityIssue[],
  warnings: CompatibilityIssue[]
): void {
  const supported = BLUEPRINT_SCHEMA_VERSION; // "1.0"
  if (requestedVersion === supported) return; // exact match — fully compatible

  const reqMajor = extractMajor(requestedVersion);
  const supMajor = extractMajor(supported);

  if (reqMajor === null) {
    issues.push({
      code: "UNPARSEABLE_SCHEMA_VERSION",
      expected: supported,
      actual: requestedVersion,
      message: `Schema version "${requestedVersion}" could not be parsed`,
    });
    return;
  }

  if (reqMajor !== supMajor) {
    issues.push({
      code: "SCHEMA_MAJOR_MISMATCH",
      expected: supported,
      actual: requestedVersion,
      message: `Schema major version mismatch: blueprint requires "${supported}", got "${requestedVersion}"`,
    });
  } else {
    warnings.push({
      code: "SCHEMA_MINOR_MISMATCH",
      expected: supported,
      actual: requestedVersion,
      message: `Schema minor/patch version mismatch: blueprint uses "${supported}", request has "${requestedVersion}"`,
    });
  }
}

// ── Component compatibility ───────────────────────────────────────────────────

function checkComponents(
  requestedComponents: string[],
  blueprint: Blueprint,
  issues: CompatibilityIssue[],
  warnings: CompatibilityIssue[]
): void {
  const supportedMap = new Map(blueprint.supportedComponents.map((c) => [c.type, c]));

  // Verify requested components are supported and version is in range
  for (const compType of requestedComponents) {
    const supported = supportedMap.get(compType);
    if (!supported) {
      issues.push({
        code: "UNSUPPORTED_COMPONENT",
        component: compType,
        message: `Component "${compType}" is not declared in this blueprint's supportedComponents`,
      });
      continue;
    }
    // We don't have the component version in the request — warn that it should be checked at mount time
    warnings.push({
      code: "COMPONENT_VERSION_UNCHECKED",
      component: compType,
      expected: supported.versionRange,
      message: `Component "${compType}" is supported but version was not provided — ensure it satisfies "${supported.versionRange}" at mount time`,
    });
  }

  // Required components not in request
  for (const comp of blueprint.supportedComponents.filter((c) => c.required)) {
    if (!requestedComponents.includes(comp.type)) {
      issues.push({
        code: "MISSING_REQUIRED_COMPONENT",
        component: comp.type,
        message: `Required component "${comp.type}" is not in the request's componentTypes`,
      });
    }
  }
}

// ── Slot fill compatibility ───────────────────────────────────────────────────

function checkSlotFills(
  slotTypesFilled: Partial<Record<SlotType, number>>,
  blueprint: Blueprint,
  issues: CompatibilityIssue[],
  warnings: CompatibilityIssue[]
): void {
  const slotTypeSet = new Set(blueprint.slots.map((s) => s.type));

  // Every filled slot type must exist in the blueprint
  for (const [slotType, count] of Object.entries(slotTypesFilled) as [SlotType, number][]) {
    if (!slotTypeSet.has(slotType)) {
      issues.push({
        code: "UNSUPPORTED_SLOT_TYPE",
        slotType,
        message: `Slot type "${slotType}" is not declared in this blueprint's slots`,
      });
    } else if (count !== undefined && count <= 0) {
      issues.push({
        code: "INVALID_SLOT_COUNT",
        slotType,
        actual: String(count),
        message: `Slot fill count for "${slotType}" must be > 0`,
      });
    }
  }

  // Required slots must have at least one fill
  const requiredSlots = blueprint.slots.filter((s) => s.required);
  for (const reqSlot of requiredSlots) {
    const count = slotTypesFilled[reqSlot.type];
    if (count === undefined || count === 0) {
      warnings.push({
        code: "REQUIRED_SLOT_UNFILLED",
        slotType: reqSlot.type,
        message: `Required slot "${reqSlot.id}" (type: ${reqSlot.type}) has no fills in slotTypesFilled`,
      });
    }
  }
}

// ── Status check ──────────────────────────────────────────────────────────────

function checkBlueprintStatus(
  blueprint: Blueprint,
  warnings: CompatibilityIssue[]
): void {
  if (blueprint.status === "deprecated") {
    warnings.push({
      code: "BLUEPRINT_DEPRECATED",
      message: `Blueprint "${blueprint.slug}" (v${blueprint.version}) is deprecated. Migrate to a newer version.`,
    });
  }
  if (blueprint.status === "draft") {
    warnings.push({
      code: "BLUEPRINT_DRAFT",
      message: `Blueprint "${blueprint.slug}" is in draft status and may change.`,
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether a compatibility request is compatible with a specific blueprint.
 * Returns errors (hard blockers) and warnings (soft advisories).
 */
export function checkCompatibility(
  request: CompatibilityRequest,
  blueprint: Blueprint
): CompatibilityResult {
  const issues: CompatibilityIssue[] = [];
  const warnings: CompatibilityIssue[] = [];

  checkBlueprintStatus(blueprint, warnings);
  checkSchemaVersion(request.schemaVersion, blueprint, issues, warnings);

  // Always run component check so required-component misses are caught even when caller sends []
  checkComponents(request.componentTypes ?? [], blueprint, issues, warnings);

  if (request.slotTypesFilled && Object.keys(request.slotTypesFilled).length > 0) {
    checkSlotFills(request.slotTypesFilled, blueprint, issues, warnings);
  }

  return {
    compatible: issues.length === 0,
    issues,
    warnings,
  };
}
