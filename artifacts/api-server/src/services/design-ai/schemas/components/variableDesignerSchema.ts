import { z } from "zod";

const SAFE_VARIABLE_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

export const variableDefinitionSchema = z.object({
  key: z.string().regex(SAFE_VARIABLE_KEY, "Variable key must be alphanumeric with _"),
  label: z.string().min(1),
  type: z.enum(["text", "multiline", "number", "currency", "url", "phone", "email", "date"]),
  required: z.boolean(),
  defaultValue: z.union([z.string(), z.number()]).optional(),
  placeholder: z.string().optional(),
  validation: z
    .object({
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().positive().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
  formatting: z
    .object({
      locale: z.string().optional(),
      currency: z.string().optional(),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
    })
    .optional(),
  usedByComponentIds: z.array(z.string()).min(1, "Every variable must be used by at least one component"),
});

export const variablePlanSchema = z.object({
  variables: z.array(variableDefinitionSchema),
});

export type VariablePlanAI = z.infer<typeof variablePlanSchema>;
