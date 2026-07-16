import { z } from "zod/v4";

const score = z.number().min(0).max(100);

export const qaScoresSchema = z.object({
  premiumAppearance:   score,
  visualBalance:       score,
  modernity:           score,
  hierarchy:           score,
  readability:         score,
  ctaVisibility:       score,
  brandConsistency:    score,
  typographyQuality:   score,
  colorHarmony:        score,
  spacingConsistency:  score,
  contentCompleteness: score,
});

export const issueCategorySchema = z.enum([
  "layout", "composition", "typography", "color",
  "decoration", "component", "binding", "engineering", "validation",
]);

export const issueSeveritySchema = z.enum(["blocking", "major", "minor"]);

export const revisionTargetSchema = z.enum([
  "layout-architect", "composition-designer", "typography-designer",
  "color-designer", "decoration-designer", "component-builder",
  "variable-designer", "asset-planner", "json-architect", "optimizer",
]);

export const blockingIssueSchema = z.object({
  code:              z.string().min(1),
  category:          issueCategorySchema,
  severity:          issueSeveritySchema,
  message:           z.string().min(1),
  affectedNodeIds:   z.array(z.string()),
  recommendedAgent:  revisionTargetSchema,
});

export const artDirectorQaReportSchema = z.object({
  overallScore:    score,
  scores:          qaScoresSchema,
  readyToPublish:  z.boolean(),
  blockingIssues:  z.array(blockingIssueSchema),
  warnings:        z.array(z.string()),
  recommendations: z.array(z.string()),
});

export type ArtDirectorQaReportSchema = z.infer<typeof artDirectorQaReportSchema>;
