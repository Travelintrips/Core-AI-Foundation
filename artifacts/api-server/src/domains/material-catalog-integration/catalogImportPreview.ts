/**
 * Material Catalog Integration — Phase 3 Foundation
 * Dry-run import preview service.
 *
 * NEVER writes to the database.
 * ALWAYS enforces dryRun: true.
 * Enforces maximum record limits and safe payload handling.
 */

import type { MaterialCatalogProvider } from "./catalogProvider.js";
import type {
  ClassifiedItem,
  ExternalCatalogItem,
  ImportOptions,
  ImportPreviewResult,
} from "./types.js";
import {
  ExternalCatalogItemSchema,
  MAX_PAYLOAD_SIZE_BYTES,
  MAX_RECORDS_PER_PREVIEW,
} from "./schemas.js";
import { normalizeExternalItem } from "./catalogNormalizer.js";
import {
  classifyBatch,
  createDetectionIndex,
} from "./catalogDuplicateDetector.js";
import {
  CatalogPayloadTooLargeError,
  CatalogResponseTooLargeError,
  CatalogProductionImportRejectedError,
  CatalogProviderError,
} from "./errors.js";
import { logger } from "../../lib/logger.js";

// ── Preview service ───────────────────────────────────────────────────────────

export interface RunImportPreviewParams {
  provider: MaterialCatalogProvider;
  providerConfig: unknown;
  options: ImportOptions;
}

/**
 * Run a dry-run import preview.
 *
 * @throws {CatalogProductionImportRejectedError} if dryRun is not exactly true.
 * @throws {CatalogPayloadTooLargeError} if provider returns more items than the limit.
 * @throws {CatalogProviderError} if the provider itself throws.
 */
export async function runImportPreview(
  params: RunImportPreviewParams,
): Promise<ImportPreviewResult> {
  const { provider, providerConfig, options } = params;

  // Hard gate — reject any attempt to disable the dry-run guard
  if ((options as { dryRun: unknown }).dryRun !== true) {
    throw new CatalogProductionImportRejectedError();
  }

  const startedAt = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];
  const limit = Math.min(
    options.maxRecords ?? MAX_RECORDS_PER_PREVIEW,
    MAX_RECORDS_PER_PREVIEW,
  );

  // Validate provider config
  const configValidation = await provider.validateConfig(providerConfig);
  if (!configValidation.valid) {
    // Log but continue — some providers allow partial config in preview
    warnings.push(
      `Provider config warnings: ${configValidation.errors.join("; ")}`,
    );
  }

  // Fetch catalog from provider
  let fetchResult;
  try {
    fetchResult = await provider.fetchCatalog({
      cursor: options.cursor,
      limit,
      brand: options.brand,
      country: options.country,
      config: providerConfig,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { providerId: provider.providerId, error: message },
      "[material-catalog] Provider fetch error during preview",
    );
    throw new CatalogProviderError(provider.providerId, message);
  }

  const rawItems = fetchResult.items;
  const totalReceived = rawItems.length;

  const payloadSizeBytes =
    fetchResult.payloadSizeBytes ??
    Buffer.byteLength(JSON.stringify({
      items: rawItems,
      nextCursor: fetchResult.nextCursor,
      totalAvailable: fetchResult.totalAvailable,
      sourceMetadata: fetchResult.sourceMetadata,
    }), "utf8");
  if (payloadSizeBytes > MAX_PAYLOAD_SIZE_BYTES) {
    throw new CatalogResponseTooLargeError(payloadSizeBytes, MAX_PAYLOAD_SIZE_BYTES);
  }

  // Safety: reject oversized payloads
  if (totalReceived > MAX_RECORDS_PER_PREVIEW) {
    throw new CatalogPayloadTooLargeError(totalReceived, MAX_RECORDS_PER_PREVIEW);
  }

  // Normalize all items
  const normalizedItems: Array<{ item: ExternalCatalogItem; normWarnings: string[] }> = [];
  let invalidCount = 0;

  for (const raw of rawItems) {
    const { item, warnings: normWarnings } = normalizeExternalItem(raw as unknown);

    // Schema-validate the normalized item
    const parsed = ExternalCatalogItemSchema.safeParse(item);
    if (!parsed.success) {
      invalidCount++;
      const errs = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      errors.push(`Item '${item.externalId || "(unknown)"}': ${errs.join("; ")}`);
      continue;
    }

    normalizedItems.push({ item: parsed.data as ExternalCatalogItem, normWarnings });
    if (normWarnings.length > 0) {
      warnings.push(...normWarnings.map((w) => `[${item.externalId}] ${w}`));
    }
  }

  const validItems = normalizedItems.map((n) => n.item);

  // Classify duplicates (deterministic, in-memory only)
  const index = createDetectionIndex();
  const { results: classResults, counts } = classifyBatch(validItems, index);

  // Build classified output — deterministic ordering preserved from input
  const classifiedItems: ClassifiedItem[] = normalizedItems.map((n, i) => ({
    item: n.item,
    classification: classResults[i]?.classification ?? "new",
    normalizationWarnings: n.normWarnings,
  }));

  const executionDurationMs = Date.now() - startedAt;

  logger.info(
    {
      providerId: provider.providerId,
      totalReceived,
      validCount: validItems.length,
      invalidCount,
      newCount: counts.new,
      exactDuplicateCount: counts.exact_duplicate,
      possibleDuplicateCount: counts.possible_duplicate,
      executionDurationMs,
    },
    "[material-catalog] Import preview complete",
  );

  return {
    totalReceived,
    validCount: validItems.length,
    invalidCount,
    newCount: counts.new,
    exactDuplicateCount: counts.exact_duplicate,
    possibleDuplicateCount: counts.possible_duplicate,
    warnings,
    errors,
    items: classifiedItems,
    nextCursor: fetchResult.nextCursor,
    sourceMetadata: fetchResult.sourceMetadata,
    payloadSizeBytes,
    executionDurationMs,
  };
}
