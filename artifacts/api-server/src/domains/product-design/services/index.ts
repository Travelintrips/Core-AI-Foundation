/**
 * product-design — Services barrel export
 *
 * STATUS: BLOCKED_PENDING_FOUNDATION
 *
 * Only pure-logic validators and the manufacturer brief builder are exported.
 * Engine integration (mockupComposer, ports) is deferred until Teams 11 and 12
 * pass audit and are integrated. See integration/manifests/team-20.json.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

export * from "./dimensionsValidator.js";
export * from "./componentPlacer.js";
export * from "./cmfValidator.js";
export * from "./disclaimerService.js";
export * from "./variantConsistencyChecker.js";
export * from "./manufacturerBriefBuilder.js";

// mockupComposer and null ports REMOVED — pending Team 11 (blueprint) and
// Team 12 (composition) integration. See ExistingEngineAdapter in types/contracts.ts.
