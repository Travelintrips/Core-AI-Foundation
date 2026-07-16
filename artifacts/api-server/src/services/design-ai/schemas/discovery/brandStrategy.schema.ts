import { z } from "zod/v4";

export const colorDirectionSchema = z.object({
  primaryMood: z.string().min(1),
  supportingMood: z.array(z.string()),
  avoid: z.array(z.string()),
  useExistingBrandPalette: z.boolean(),
});

export const typographyDirectionSchema = z.object({
  category: z.array(z.string()).min(1),
  personality: z.array(z.string()),
  readabilityPriority: z.enum(["high", "medium", "low"]),
});

export const brandStrategySchema = z.object({
  brandName: z.string().optional(),
  brandPersonality: z.array(z.string()).min(1),
  brandStyle: z.array(z.string()),
  mood: z.array(z.string()).min(1),
  visualKeywords: z.array(z.string()),
  colorDirection: colorDirectionSchema,
  typographyDirection: typographyDirectionSchema,
  imageryDirection: z.array(z.string()),
  logoRules: z.array(z.string()),
  brandingRules: z.array(z.string()),
  forbiddenStyles: z.array(z.string()),
  assumptions: z.array(z.string()),
});

export type BrandStrategySchema = z.infer<typeof brandStrategySchema>;
