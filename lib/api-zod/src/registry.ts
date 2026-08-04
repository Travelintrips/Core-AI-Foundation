/**
 * Provider health-history schemas — manual (not generated).
 * These were previously assumed to be in generated/api.ts but never made it there.
 */

import * as zod from "zod";

export const GetProviderHealthHistoryParams = zod.object({
  id: zod.coerce.number().int(),
});

export const GetProviderHealthHistoryQueryParams = zod.object({
  limit: zod.coerce.number().int().min(1).max(200).optional(),
});

const HealthLogEntry = zod.object({
  id:         zod.number(),
  providerId: zod.number(),
  isActive:   zod.boolean(),
  httpStatus: zod.number().nullable(),
  error:      zod.string().nullable(),
  checkedAt:  zod.coerce.date(),
});

export const GetProviderHealthHistoryResponse = zod.array(HealthLogEntry);
