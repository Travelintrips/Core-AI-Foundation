import { z } from "zod";

/**
 * Shared schema for authenticated coding bridge command submissions.
 * Keep the explicit assignedClientId: without it Zod strips the top-level
 * routing target, and no client can claim the persisted command.
 */
export const codingBridgeCommandSchema = z.object({
  externalCommandId: z.string().min(1).max(200),
  instruction: z.string().min(1).max(50000),
  taskId: z.string().uuid().nullish(),
  source: z.string().min(1).max(50).optional(),
  commandType: z.string().min(1).max(50).optional(),
  assignedClientId: z.string().trim().min(1).max(200).optional(),
  authority: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
