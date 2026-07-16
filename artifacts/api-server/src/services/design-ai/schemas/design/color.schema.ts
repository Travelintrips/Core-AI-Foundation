import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a 6-digit hex color");

export const colorSpecSchema = z.object({
  tokens: z.object({
    background: hexColor,
    surface: hexColor,
    primary: hexColor,
    secondary: hexColor,
    accent: hexColor,
    textPrimary: hexColor,
    textSecondary: hexColor,
    border: hexColor,
    success: hexColor.optional(),
    warning: hexColor.optional(),
    danger: hexColor.optional(),
  }),
  gradients: z.array(
    z.object({
      id: z.string().min(1),
      type: z.enum(["linear", "radial"]),
      colors: z.array(hexColor).min(2),
      stops: z.array(z.number().min(0).max(1)).min(2),
      angle: z.number().min(0).max(360).optional(),
    }),
  ),
  shadows: z.array(
    z.object({
      id: z.string().min(1),
      offsetX: z.number(),
      offsetY: z.number(),
      blur: z.number().nonnegative(),
      opacity: z.number().min(0).max(1),
    }),
  ),
  contrastChecks: z.array(
    z.object({
      foreground: hexColor,
      background: hexColor,
      ratio: z.number().positive(),
      passed: z.boolean(),
    }),
  ),
});

export type ColorSpecSchema = z.infer<typeof colorSpecSchema>;
