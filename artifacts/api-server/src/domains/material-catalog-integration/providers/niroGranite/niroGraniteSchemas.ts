import { z } from "zod";

export const NIRO_GRANITE_PROVIDER_ID = "niro-granite-official";
export const NIRO_GRANITE_SUPPORTED_LOCALES = ["id-ID", "en-ID"] as const;
export const NIRO_GRANITE_SUPPORTED_COUNTRIES = ["ID"] as const;

export const NiroGraniteProviderConfigSchema = z
  .object({
    mode: z.enum(["fixture", "feed"]).default("fixture"),
    feedUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
    locale: z.enum(NIRO_GRANITE_SUPPORTED_LOCALES).default("id-ID"),
    country: z.enum(NIRO_GRANITE_SUPPORTED_COUNTRIES).default("ID"),
    timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
    /**
     * Server-only guard. It is never accepted from the admin request body.
     * Live fetching remains off until an approved source is configured.
     */
    liveFetchEnabled: z.boolean().default(false),
  })
  .strict();

export type NiroGraniteProviderConfig = z.infer<typeof NiroGraniteProviderConfigSchema>;

export const NiroGraniteExportRecordSchema = z
  .object({
    externalId: z.string().optional(),
    productCode: z.string().optional(),
    productName: z.string().optional(),
    brand: z.string().optional(),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    materialType: z.string().optional(),
    description: z.string().optional(),
    color: z.array(z.string()).optional(),
    finish: z.array(z.string()).optional(),
    texture: z.string().optional(),
    pattern: z.string().optional(),
    priceTier: z.string().optional(),
    unit: z.string().optional(),
    dimensions: z.record(z.unknown()).optional(),
    technicalData: z.record(z.unknown()).optional(),
    certifications: z.array(z.string()).optional(),
    sourceUrl: z.string().optional(),
    thumbnailReference: z.unknown().optional(),
    previewReferences: z.array(z.unknown()).optional(),
    country: z.string().optional(),
    locale: z.string().optional(),
    sourceUpdatedAt: z.string().optional(),
    sourceMetadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type NiroGraniteExportRecord = z.infer<typeof NiroGraniteExportRecordSchema>;

export const NiroGraniteFeedEnvelopeSchema = z.object({
  items: z.array(z.unknown()),
  nextCursor: z.string().optional(),
  totalAvailable: z.number().int().nonnegative().optional(),
});