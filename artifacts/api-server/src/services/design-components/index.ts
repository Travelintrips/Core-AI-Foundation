/**
 * Universal Creative Component Library — Service Index (Team 8)
 *
 * Public exports for the design-components domain.
 * Team 24 will wire this into the application via routes/index.ts and app.ts.
 */

// Core types
export type {
  ComponentDomain,
  ComponentType,
  GraphicComponentType,
  InteriorComponentType,
  FashionComponentType,
  PackagingComponentType,
  FieldDefinition,
  FieldType,
  Constraint,
  ConstraintRule,
  ComponentDefinition,
  ComponentInstanceInput,
  ValidationError,
  ValidationResult,
  BlueprintCompatibilityResult,
} from "./types.js";

export { ALL_DOMAINS, COMPONENT_SCHEMA_VERSION } from "./types.js";

// Registry
export {
  getComponentDefinition,
  getComponentBySlug,
  listComponentsByDomain,
  listAllComponents,
  listComponentTypes,
  isValidComponentType,
  isValidDomain,
  getStats,
} from "./componentRegistry.js";

// Validation
export {
  validateComponentInstance,
  validatePartialComponentInstance,
  applyDefaults,
} from "./componentValidationService.js";

// Blueprint compatibility
export type {
  BlueprintContext,
  BlueprintCompositionInput,
  BlueprintCompositionResult,
} from "./blueprintCompatibilityService.js";

export {
  checkComponentCompatibility,
  checkBlueprintCoverage,
  listCompatibleComponents,
  validateBlueprintComposition,
  isTypeCompatibleWithDomain,
} from "./blueprintCompatibilityService.js";

// CRUD service
export {
  createDesignComponent,
  getDesignComponent,
  listDesignComponents,
  updateDesignComponent,
  softDeleteDesignComponent,
  duplicateDesignComponent,
  getComponentSchema,
  ComponentValidationError,
  ComponentNotFoundError,
  ComponentTenantError,
  ComponentSlugConflictError,
} from "./designComponentService.js";

export type { ListDesignComponentsOptions, UpdateDesignComponentInput } from "./designComponentService.js";
