/**
 * Universal Creative Component Library — Blueprint Compatibility Service (Team 8)
 *
 * Checks whether a component instance (or a component type) is compatible
 * with a given blueprint context (domain, required slots, layout constraints).
 * Pure logic — no DB, no I/O.
 */

import type {
  ComponentType,
  ComponentDomain,
  BlueprintCompatibilityResult,
  ComponentDefinition,
} from "./types.js";
import {
  getComponentDefinition,
  listComponentsByDomain,
  isValidComponentType,
  isValidDomain,
} from "./componentRegistry.js";

// ── Blueprint context types ────────────────────────────────────────────────────

/**
 * A lightweight description of a blueprint's requirements.
 * Passed in by callers — this service does not read blueprints from the DB.
 */
export interface BlueprintContext {
  /** The primary creative domain for this blueprint */
  domain: ComponentDomain;
  /** Component types the blueprint explicitly requires */
  requiredComponentTypes?: ComponentType[];
  /** Component types the blueprint explicitly forbids */
  forbiddenComponentTypes?: ComponentType[];
  /** Maximum number of each component type (null = unlimited) */
  maxInstancesPerType?: Partial<Record<ComponentType, number>>;
  /** If true, only component types whose primary domain matches are allowed */
  strictDomainMatch?: boolean;
}

// ── Core compatibility check ──────────────────────────────────────────────────

export function checkComponentCompatibility(
  type: ComponentType,
  context: BlueprintContext,
): BlueprintCompatibilityResult {
  const reasons: string[] = [];
  const missingFields: string[] = [];
  const unsupportedConstraints: string[] = [];

  const def = getComponentDefinition(type);
  if (!def) {
    return {
      compatible: false,
      reasons: [`Unknown component type: "${type}".`],
      missingFields: [],
      unsupportedConstraints: [],
    };
  }

  // 1. Domain support
  if (!def.supportedDomains.includes(context.domain)) {
    reasons.push(
      `Component "${def.name}" does not support domain "${context.domain}". ` +
        `Supported domains: ${def.supportedDomains.join(", ")}.`,
    );
  }

  // 2. Strict domain match (primary domain must match)
  if (context.strictDomainMatch && def.domain !== context.domain) {
    reasons.push(
      `Strict domain match required: component primary domain is "${def.domain}", ` +
        `blueprint domain is "${context.domain}".`,
    );
  }

  // 3. Forbidden types
  if (context.forbiddenComponentTypes?.includes(type)) {
    reasons.push(`Component type "${type}" is explicitly forbidden in this blueprint.`);
  }

  return {
    compatible: reasons.length === 0,
    reasons,
    missingFields,
    unsupportedConstraints,
  };
}

/**
 * Check whether all required component types in the blueprint are satisfied
 * by the provided set of component types.
 */
export function checkBlueprintCoverage(
  context: BlueprintContext,
  presentTypes: ComponentType[],
): BlueprintCompatibilityResult {
  const reasons: string[] = [];
  const missingFields: string[] = [];
  const unsupportedConstraints: string[] = [];

  const required = context.requiredComponentTypes ?? [];
  const presentSet = new Set(presentTypes);

  for (const req of required) {
    if (!presentSet.has(req)) {
      const def = getComponentDefinition(req);
      missingFields.push(req);
      reasons.push(
        `Required component type "${def?.name ?? req}" is not present in this blueprint.`,
      );
    }
  }

  return {
    compatible: reasons.length === 0,
    reasons,
    missingFields,
    unsupportedConstraints,
  };
}

/**
 * List all component definitions that are compatible with a given blueprint context.
 */
export function listCompatibleComponents(
  context: BlueprintContext,
): ComponentDefinition[] {
  const candidates = context.strictDomainMatch
    ? // Only primary-domain components
      listComponentsByDomain(context.domain).filter((c) => c.domain === context.domain)
    : // All components that support the domain
      listComponentsByDomain(context.domain);

  return candidates.filter((def) => {
    const result = checkComponentCompatibility(def.type, context);
    return result.compatible;
  });
}

/**
 * Validate the full set of components in a blueprint composition:
 * - each component is domain-compatible
 * - required types are covered
 * - forbidden types are absent
 * - per-type instance limits are respected
 */
export interface BlueprintCompositionInput {
  context: BlueprintContext;
  components: Array<{ type: ComponentType; instanceId?: string }>;
}

export interface BlueprintCompositionResult {
  valid: boolean;
  componentResults: Array<{
    type: ComponentType;
    instanceId?: string;
    compatible: boolean;
    reasons: string[];
  }>;
  coverageResult: BlueprintCompatibilityResult;
  instanceLimitViolations: string[];
}

export function validateBlueprintComposition(
  input: BlueprintCompositionInput,
): BlueprintCompositionResult {
  const { context, components } = input;

  const componentResults: BlueprintCompositionResult["componentResults"] = [];
  const instanceLimitViolations: string[] = [];

  // Per-type instance counts
  const typeCounts = new Map<ComponentType, number>();
  for (const comp of components) {
    typeCounts.set(comp.type, (typeCounts.get(comp.type) ?? 0) + 1);
  }

  // Check each component
  for (const comp of components) {
    const result = checkComponentCompatibility(comp.type, context);
    componentResults.push({
      type: comp.type,
      instanceId: comp.instanceId,
      compatible: result.compatible,
      reasons: result.reasons,
    });
  }

  // Instance limit checks
  if (context.maxInstancesPerType) {
    for (const [type, count] of typeCounts.entries()) {
      const limit = context.maxInstancesPerType[type];
      if (limit !== undefined && limit !== null && count > limit) {
        instanceLimitViolations.push(
          `Component type "${type}" appears ${count} time(s) but limit is ${limit}.`,
        );
      }
    }
  }

  // Coverage check
  const presentTypes = components.map((c) => c.type);
  const coverageResult = checkBlueprintCoverage(context, presentTypes);

  const allComponentsCompatible = componentResults.every((r) => r.compatible);
  const valid =
    allComponentsCompatible &&
    coverageResult.compatible &&
    instanceLimitViolations.length === 0;

  return {
    valid,
    componentResults,
    coverageResult,
    instanceLimitViolations,
  };
}

/**
 * Quick guard — returns true only when both the type and domain strings are valid
 * and the component supports that domain.
 */
export function isTypeCompatibleWithDomain(
  type: string,
  domain: string,
): boolean {
  if (!isValidComponentType(type) || !isValidDomain(domain)) return false;
  const def = getComponentDefinition(type);
  return def?.supportedDomains.includes(domain as ComponentDomain) ?? false;
}
