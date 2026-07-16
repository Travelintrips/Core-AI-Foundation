/**
 * Engineering Team — Template Schema
 *
 * Re-exports canonical types and Zod schemas from the single authoritative
 * source (designTemplateAiSchema.ts). No second schema is defined here —
 * per the audit, one canonical schema already exists.
 */

export {
  aiTemplateDraftSchema,
  aiTemplateProposalSchema,
  designElementSchema,
} from "../../../validators/designTemplateAiSchema.js";

export type {
  AiTemplateProposal,
  AiTemplateAssistRequest,
} from "../../../validators/designTemplateAiSchema.js";

// Re-export domain types used by engineering agents
export type {
  DesignTemplate,
  DesignElement,
  TemplateVariable,
  DesignCanvas,
  TextElement,
  ImageElement,
  ShapeElement,
  QrCodeElement,
  LineElement,
} from "../../../types/designTemplate.js";

export { DESIGN_TEMPLATE_SCHEMA_VERSION, DESIGN_LIMITS } from "../../../types/designTemplate.js";
