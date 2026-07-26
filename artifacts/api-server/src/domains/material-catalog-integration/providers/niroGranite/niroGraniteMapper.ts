import type { ExternalCatalogItem } from "../../types.js";
import { redactProviderConfig } from "../../errors.js";
import { resolveMediaReference, validateSourceUrl } from "../../catalogMediaResolver.js";
import {
  NiroGraniteExportRecordSchema,
  NIRO_GRANITE_PROVIDER_ID,
  type NiroGraniteExportRecord,
} from "./niroGraniteSchemas.js";

function safeMediaReference(raw: unknown) {
  try {
    return raw === undefined ? undefined : resolveMediaReference(raw);
  } catch {
    return { kind: "unresolved" as const, rawValue: "rejected unsafe media reference" };
  }
}

function safeDate(raw: unknown): Date | undefined {
  if (typeof raw !== "string") return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function mapNiroGraniteRecord(raw: unknown): ExternalCatalogItem {
  const parsed = NiroGraniteExportRecordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      externalId: "",
      providerId: NIRO_GRANITE_PROVIDER_ID,
      productName: "",
      sourceMetadata: {
        invalidRecord: true,
        validationErrors: parsed.error.issues.map((issue) => issue.message),
      },
    };
  }

  const record: NiroGraniteExportRecord = parsed.data;
  let sourceUrl: string | undefined;
  if (record.sourceUrl) {
    try {
      sourceUrl = validateSourceUrl(record.sourceUrl).toString();
    } catch {
      sourceUrl = undefined;
    }
  }

  return {
    externalId: record.externalId?.trim() ?? "",
    providerId: NIRO_GRANITE_PROVIDER_ID,
    sourceUrl,
    brand: record.brand,
    productCode: record.productCode,
    productName: record.productName?.trim() ?? "",
    category: record.category,
    subcategory: record.subcategory,
    materialType: record.materialType,
    description: record.description,
    color: record.color,
    finish: record.finish,
    texture: record.texture,
    pattern: record.pattern,
    priceTier: record.priceTier,
    unit: record.unit,
    dimensions: record.dimensions,
    technicalData: record.technicalData,
    certifications: record.certifications,
    thumbnailReference: safeMediaReference(record.thumbnailReference),
    previewReferences: record.previewReferences?.map(safeMediaReference).filter(Boolean),
    country: record.country,
    locale: record.locale,
    sourceUpdatedAt: safeDate(record.sourceUpdatedAt),
    sourceMetadata: redactProviderConfig(record.sourceMetadata) as Record<string, unknown> | undefined,
  };
}