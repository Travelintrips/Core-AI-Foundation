/**
 * Provider health-history schemas (manual, not generated).
 * These are not generated from the OpenAPI spec — defined here instead.
 */
import { z } from "zod";

export const GetProviderHealthHistoryParams = z.object({
  id: z.coerce.number(),
});

export const GetProviderHealthHistoryQueryParams = z.object({
  limit: z.coerce.number().optional(),
});

export const GetProviderHealthHistoryResponse = z.array(
  z.object({
    id: z.number(),
    providerId: z.number(),
    isActive: z.boolean(),
    httpStatus: z.number().nullable(),
    error: z.string().nullable(),
    checkedAt: z.coerce.date(),
  })
);
