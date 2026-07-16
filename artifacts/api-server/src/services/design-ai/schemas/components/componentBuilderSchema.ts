import { z } from "zod";

const SAFE_SEMANTIC_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export const componentRegionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const componentDefinitionSchema = z.object({
  id: z.string().regex(SAFE_SEMANTIC_ID, "Component ID must be semantic alphanumeric with - or _"),
  sectionId: z.string().min(1),
  type: z.enum([
    "logo",
    "image_placeholder",
    "title",
    "subtitle",
    "description",
    "price",
    "cta",
    "qr_code",
    "contact_information",
    "footer",
    "social_icon",
    "badge",
    "divider",
    "background",
    "shape",
  ]),
  role: z.string().min(1),
  required: z.boolean(),
  contentSource: z.enum(["static", "variable", "asset", "generated-placeholder"]),
  bindingKey: z.string().optional(),
  region: componentRegionSchema,
  layerRole: z.enum(["background", "decoration", "content", "foreground"]),
  properties: z.record(z.unknown()),
});

export const componentPlanSchema = z.object({
  components: z.array(componentDefinitionSchema).min(1),
});

export type ComponentPlanAI = z.infer<typeof componentPlanSchema>;
