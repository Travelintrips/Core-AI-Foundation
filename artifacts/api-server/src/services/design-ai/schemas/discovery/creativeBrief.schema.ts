import { z } from "zod/v4";

export const targetAudienceSchema = z.object({
  primary: z.string().min(1),
  secondary: z.string().optional(),
  characteristics: z.array(z.string()),
});

export const creativeBriefSchema = z.object({
  designGoal: z.string().min(1),
  communicationObjective: z.string().min(1),
  campaignName: z.string().optional(),
  campaignContext: z.string().optional(),
  targetAudience: targetAudienceSchema,
  coreMessage: z.string().min(1),
  tone: z.array(z.string()).min(1),
  desiredEmotion: z.array(z.string()),
  visualDirection: z.array(z.string()),
  styleKeywords: z.array(z.string()),
  contentPriority: z.array(z.string()),
  assumptions: z.array(z.string()),
  missingInformation: z.array(z.string()),
});

export type CreativeBriefSchema = z.infer<typeof creativeBriefSchema>;
