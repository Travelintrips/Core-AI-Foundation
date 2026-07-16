import { z } from "zod";

export const compositionSpecSchema = z.object({
  focalPoint: z.object({
    sectionId: z.string().min(1),
    reason: z.string().min(1),
  }),
  eyeFlow: z.array(z.string()).min(1),
  balance: z.enum(["symmetrical", "asymmetrical", "radial"]),
  visualWeight: z
    .array(
      z.object({
        sectionId: z.string().min(1),
        weight: z.number().min(0).max(100),
      }),
    )
    .min(1),
  spacingScale: z.array(z.number().positive()).min(1),
  relationships: z.array(
    z.object({
      fromSectionId: z.string().min(1),
      toSectionId: z.string().min(1),
      relationship: z.string().min(1),
    }),
  ),
  densityMap: z
    .array(
      z.object({
        sectionId: z.string().min(1),
        density: z.enum(["low", "medium", "high"]),
      }),
    )
    .min(1),
});

export type CompositionSpecSchema = z.infer<typeof compositionSpecSchema>;
