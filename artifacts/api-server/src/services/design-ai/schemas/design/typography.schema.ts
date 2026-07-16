import { z } from "zod";

const textStyleSchema = z.object({
  fontFamily: z.string().min(1),
  fontSize: z.number().positive(),
  fontWeight: z.union([z.number().int().positive(), z.string().min(1)]),
  lineHeight: z.number().positive(),
  letterSpacing: z.number(),
  color: z.string().optional(),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
});

export const typographySpecSchema = z.object({
  fontPairing: z.object({
    headingFont: z.string().min(1),
    bodyFont: z.string().min(1),
    accentFont: z.string().optional(),
  }),
  styles: z.object({
    display: textStyleSchema,
    heading: textStyleSchema,
    subheading: textStyleSchema,
    body: textStyleSchema,
    caption: textStyleSchema,
    button: textStyleSchema,
    price: textStyleSchema.optional(),
  }),
  fallbackFonts: z.array(z.string()).min(1),
  readabilityRules: z.array(z.string()).min(1),
});

export type TypographySpecSchema = z.infer<typeof typographySpecSchema>;
