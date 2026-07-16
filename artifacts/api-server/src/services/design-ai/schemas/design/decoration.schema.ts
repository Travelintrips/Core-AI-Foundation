import { z } from "zod";

export const decorationSpecSchema = z.object({
  decorations: z.array(
    z.object({
      id: z.string().min(1),
      type: z.enum(["shape", "divider", "frame", "badge", "pattern", "background-accent"]),
      targetSectionId: z.string().optional(),
      geometry: z.record(z.unknown()),
      style: z.record(z.unknown()),
      purpose: z.string().min(1),
      decorativeOnly: z.boolean(),
    }),
  ),
});

export type DecorationSpecSchema = z.infer<typeof decorationSpecSchema>;
