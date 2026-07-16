import { z } from "zod";

const SAFE_SEMANTIC_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const ASPECT_RATIO_PATTERN = /^\d+:\d+$/;

export const assetDefinitionSchema = z.object({
  id: z.string().regex(SAFE_SEMANTIC_ID, "Asset ID must be semantic alphanumeric with - or _"),
  type: z.enum(["photo", "logo", "icon", "background", "illustration", "qr"]),
  componentId: z.string().min(1),
  purpose: z.string().min(1),
  required: z.boolean(),
  placeholderLabel: z.string().min(1),
  dimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  aspectRatio: z
    .string()
    .regex(ASPECT_RATIO_PATTERN, "aspectRatio must be in W:H format, e.g. 1:1, 16:9"),
  fit: z.enum(["cover", "contain", "fill"]),
  cropFocus: z.enum(["center", "top", "bottom", "left", "right"]).optional(),
  acceptedMimeTypes: z.array(z.string()).optional(),
  visualGuidance: z.array(z.string()).min(1),
});

export const assetPlanSchema = z.object({
  assets: z.array(assetDefinitionSchema),
});

export type AssetPlanAI = z.infer<typeof assetPlanSchema>;
