import { z } from "zod";

const regionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const sectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().nonnegative(),
  region: regionSchema,
  alignment: z.enum(["left", "center", "right"]),
  priority: z.number().int().min(1).max(10),
});

export const layoutSpecSchema = z.object({
  canvas: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  grid: z.object({
    columns: z.number().int().positive().max(24),
    rows: z.number().int().positive().optional(),
    gutter: z.number().nonnegative(),
    margin: z.object({
      top: z.number().nonnegative(),
      right: z.number().nonnegative(),
      bottom: z.number().nonnegative(),
      left: z.number().nonnegative(),
    }),
  }),
  safeArea: regionSchema,
  sections: z.array(sectionSchema).min(1),
  readingOrder: z.array(z.string()).min(1),
  whitespaceRules: z.array(z.string()),
});

export type LayoutSpecSchema = z.infer<typeof layoutSpecSchema>;
