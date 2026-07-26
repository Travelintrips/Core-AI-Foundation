/**
 * Material Catalog Integration — Phase 3 Foundation
 * Structured import report — in-memory only, no persistence.
 */

import type { ImportPreviewResult, ImportReport, ImportReportStatus } from "./types.js";

/**
 * Build a structured import report from a completed preview run.
 * Returns an in-memory value; nothing is written to the database.
 */
export function buildImportReport(params: {
  runId: string;
  providerId: string;
  startedAt: Date;
  completedAt: Date;
  previewResult: ImportPreviewResult;
  providerErrors?: string[];
  sourceMetadata?: Record<string, unknown>;
}): ImportReport {
  const { runId, providerId, startedAt, completedAt, previewResult, providerErrors, sourceMetadata } = params;

  const { warnings, errors, totalReceived, validCount, invalidCount, newCount, exactDuplicateCount, possibleDuplicateCount } = previewResult;

  let status: ImportReportStatus;
  if (errors.length > 0 || (providerErrors && providerErrors.length > 0)) {
    status = "failed";
  } else if (warnings.length > 0 || invalidCount > 0) {
    status = "completed_with_warnings";
  } else {
    status = "completed";
  }

  const previewSummary =
    `Received ${totalReceived} items: ${newCount} new, ` +
    `${exactDuplicateCount} exact duplicate(s), ` +
    `${possibleDuplicateCount} possible duplicate(s), ` +
    `${invalidCount} invalid. ` +
    `Execution: ${previewResult.executionDurationMs}ms.`;

  return {
    runId,
    providerId,
    startedAt,
    completedAt,
    status,
    counts: {
      totalReceived,
      validCount,
      invalidCount,
      newCount,
      exactDuplicateCount,
      possibleDuplicateCount,
    },
    warnings,
    validationErrors: errors,
    providerErrors: providerErrors ?? [],
    previewSummary,
    sourceMetadata,
  };
}

/**
 * Build a "rejected" report when the request itself is refused
 * (e.g. dryRun: false, feature flag disabled).
 */
export function buildRejectedReport(params: {
  runId: string;
  providerId: string;
  startedAt: Date;
  reason: string;
}): ImportReport {
  const now = new Date();
  return {
    runId: params.runId,
    providerId: params.providerId,
    startedAt: params.startedAt,
    completedAt: now,
    status: "rejected",
    counts: {
      totalReceived: 0,
      validCount: 0,
      invalidCount: 0,
      newCount: 0,
      exactDuplicateCount: 0,
      possibleDuplicateCount: 0,
    },
    warnings: [],
    validationErrors: [],
    providerErrors: [params.reason],
    previewSummary: `Import rejected: ${params.reason}`,
  };
}
