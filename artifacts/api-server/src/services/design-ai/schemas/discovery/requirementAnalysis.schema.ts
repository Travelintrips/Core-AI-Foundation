import { z } from "zod/v4";

export const canvasSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.literal("px"),
  orientation: z.enum(["portrait", "landscape", "square"]),
  preset: z.string().optional(),
});

export const sectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  required: z.boolean(),
  contentPurpose: z.string().min(1),
});

export const ctaSchema = z.object({
  label: z.string().optional(),
  purpose: z.string().min(1),
  priority: z.enum(["primary", "secondary"]),
});

export const conflictSchema = z.object({
  requirementA: z.string().min(1),
  requirementB: z.string().min(1),
  resolution: z.string().optional(),
});

export const requirementAnalysisSchema = z.object({
  platform: z.string().min(1),
  language: z.string().min(1),
  canvas: canvasSchema,
  sections: z.array(sectionSchema),
  callsToAction: z.array(ctaSchema),
  requestedVariables: z.array(z.string()),
  requiredContent: z.array(z.string()),
  optionalContent: z.array(z.string()),
  contentConstraints: z.array(z.string()),
  visualConstraints: z.array(z.string()),
  exportFormats: z.array(z.string()),
  explicitRequirements: z.array(z.string()),
  inferredRequirements: z.array(z.string()),
  conflicts: z.array(conflictSchema),
  missingInformation: z.array(z.string()),
});

export type RequirementAnalysisSchema = z.infer<typeof requirementAnalysisSchema>;
