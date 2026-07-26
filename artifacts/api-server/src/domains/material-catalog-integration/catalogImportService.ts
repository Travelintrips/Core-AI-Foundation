/**
 * Material Catalog Integration — Phase 3 Foundation
 * Main orchestrator — ties together preview + report.
 *
 * Phase 3: only dry-run preview is supported.
 * Production imports are explicitly rejected.
 */

import type { ImportOptions, ImportReport } from "./types.js";
import { runImportPreview } from "./catalogImportPreview.js";
import { buildImportReport, buildRejectedReport } from "./catalogImportReport.js";
import { getProvider } from "./providerRegistry.js";
import { isMaterialCatalogEnabled } from "./featureFlag.js";
import { CatalogFeatureDisabledError, CatalogProductionImportRejectedError, redactProviderConfig } from "./errors.js";
import { logger } from "../../lib/logger.js";

let _runIdCounter = 0;

function generateRunId(providerId: string): string {
  _runIdCounter++;
  return `mci-preview-${providerId}-${Date.now()}-${_runIdCounter}`;
}

export interface CatalogImportServiceParams {
  providerId: string;
  providerConfig: unknown;
  options: ImportOptions;
}

/**
 * Run a catalog import preview and return a structured report.
 *
 * @throws {CatalogFeatureDisabledError} when feature flag is off.
 * @throws {CatalogProductionImportRejectedError} when dryRun is not true.
 * @throws {CatalogProviderNotFoundError} when the provider is not registered.
 */
export async function runCatalogImportPreview(
  params: CatalogImportServiceParams,
): Promise<ImportReport> {
  const { providerId, providerConfig, options } = params;

  if (!isMaterialCatalogEnabled()) {
    throw new CatalogFeatureDisabledError();
  }

  // Hard gate against production writes — enforced here AND in the preview layer
  if ((options as { dryRun: unknown }).dryRun !== true) {
    throw new CatalogProductionImportRejectedError();
  }

  const runId = generateRunId(providerId);
  const startedAt = new Date();

  logger.info(
    {
      runId,
      providerId,
      // Never log raw config — redact secrets
      configSummary: redactProviderConfig(providerConfig),
    },
    "[material-catalog] Starting import preview",
  );

  const provider = getProvider(providerId); // throws CatalogProviderNotFoundError if missing

  try {
    const previewResult = await runImportPreview({ provider, providerConfig, options });
    const completedAt = new Date();

    const report = buildImportReport({
      runId,
      providerId,
      startedAt,
      completedAt,
      previewResult,
      sourceMetadata: undefined,
    });

    logger.info(
      { runId, providerId, status: report.status, counts: report.counts },
      "[material-catalog] Import preview report built",
    );

    return report;
  } catch (err) {
    const completedAt = new Date();
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof CatalogProductionImportRejectedError) {
      return buildRejectedReport({ runId, providerId, startedAt, reason: message });
    }

    logger.warn(
      { runId, providerId, error: message },
      "[material-catalog] Import preview failed",
    );

    return buildImportReport({
      runId,
      providerId,
      startedAt,
      completedAt,
      previewResult: {
        totalReceived: 0,
        validCount: 0,
        invalidCount: 0,
        newCount: 0,
        exactDuplicateCount: 0,
        possibleDuplicateCount: 0,
        warnings: [],
        errors: [message],
        items: [],
        sourceMetadata: undefined,
        executionDurationMs: completedAt.getTime() - startedAt.getTime(),
      },
      providerErrors: [message],
    });
  }
}
