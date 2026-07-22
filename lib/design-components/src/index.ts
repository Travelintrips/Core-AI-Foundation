/**
 * @workspace/design-components — Public API
 *
 * Universal Design Component & Object Library (Team 22)
 */

// Types
export type {
  ComponentStatus,
  ComponentSource,
  ComponentCategory,
  ParameterKind,
  TextParameter,
  NumberParameter,
  BooleanParameter,
  ColorParameter,
  EnumParameter,
  DimensionsParameter,
  MaterialReferenceParameter,
  AssetReferenceParameter,
  PluginSchemaReferenceParameter,
  ComponentParameterSchema,
  ComponentAssetReference,
  PlacementContext,
  ComponentPlacementCapability,
  ComponentCompatibility,
  ComponentVariant,
  ComponentDefinition,
  ComponentTransform,
  ComponentInstantiationRequest,
  ValidationIssue,
  InstantiationValidationResult,
  ComponentBrowserFilter,
} from "./types.js";

// Registry
export {
  ComponentRegistry,
  ComponentRegistrationError,
  ComponentResolutionError,
  platformRegistry,
} from "./registry.js";
