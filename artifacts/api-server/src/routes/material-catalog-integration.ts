/**
 * Material Catalog Integration — Phase 4 Preview Route
 *
 * Routes (mounted at /api via routes/index.ts):
 *   GET  /material-catalog/providers        — admin: provider registry status
 *   POST /material-catalog/import-preview   — admin: dry-run import preview
 *
 * Invariants:
 *   - Both routes require admin authorization (adminAuth middleware)
 *   - import-preview NEVER writes to the database
 *   - import-preview ALWAYS enforces dryRun: true
 *   - import-preview ALWAYS enforces MAX_RECORDS_PER_PREVIEW <= 500
 *   - import-preview ALWAYS enforces MAX_PAYLOAD_SIZE_BYTES <= 10 MB
 *   - Feature flag (MATERIAL_CATALOG_INTEGRATION_ENABLED) is checked on every call
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { adminAuth } from "../middleware/adminAuth.js";
import { isMaterialCatalogEnabled } from "../domains/material-catalog-integration/featureFlag.js";
import {
  getProvider,
  listProviders,
} from "../domains/material-catalog-integration/providerRegistry.js";
import { runImportPreview } from "../domains/material-catalog-integration/catalogImportPreview.js";
import {
  buildImportReport,
  buildRejectedReport,
} from "../domains/material-catalog-integration/catalogImportReport.js";
import { getNiroGraniteServerConfig } from "../domains/material-catalog-integration/providers/niroGranite/niroGraniteConfig.js";
import { NIRO_GRANITE_PROVIDER_ID } from "../domains/material-catalog-integration/providers/niroGranite/niroGraniteSchemas.js";
import {
  MAX_PAYLOAD_SIZE_BYTES,
  MAX_RECORDS_PER_PREVIEW,
} from "../domains/material-catalog-integration/schemas.js";
import {
  CatalogPayloadTooLargeError,
  CatalogProductionImportRejectedError,
  CatalogProviderNotFoundError,
  CatalogResponseTooLargeError,
} from "../domains/material-catalog-integration/errors.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── GET /material-catalog/providers ──────────────────────────────────────────
// Admin-only. Returns feature flag states and registered provider list.
// No DB access. No network calls.
router.get("/material-catalog/providers", adminAuth, (_req, res) => {
  const catalogEnabled = isMaterialCatalogEnabled();
  const niroEnabled =
    process.env["MATERIAL_NIRO_GRANITE_PROVIDER_ENABLED"] === "true";

  const providers = listProviders().map((p) => ({
    providerId: p.providerId,
    displayName: p.displayName,
    sourceType: p.sourceType,
    capabilities: p.getCapabilities(),
  }));

  res.json({
    catalogEnabled,
    niroGraniteEnabled: niroEnabled,
    registeredProviders: providers,
    totalRegistered: providers.length,
  });
});

// ── POST /material-catalog/import-preview ─────────────────────────────────────
// Admin-only. Always dryRun: true. Never writes to DB or canonical materials.
router.post("/material-catalog/import-preview", adminAuth, async (req, res) => {
  const startedAt = new Date();
  const runId = randomUUID();

  // ── Feature flag gate ──────────────────────────────────────────────────────
  if (!isMaterialCatalogEnabled()) {
    res.status(403).json({
      error: "Material catalog integration is disabled",
      flag: "MATERIAL_CATALOG_INTEGRATION_ENABLED",
      hint: "Set MATERIAL_CATALOG_INTEGRATION_ENABLED=true to enable",
    });
    return;
  }

  // ── Request body size enforcement ──────────────────────────────────────────
  const bodySizeBytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8");
  if (bodySizeBytes > MAX_PAYLOAD_SIZE_BYTES) {
    res.status(413).json({
      error: "Request payload too large",
      maxBytes: MAX_PAYLOAD_SIZE_BYTES,
      receivedBytes: bodySizeBytes,
    });
    return;
  }

  // ── Input validation ───────────────────────────────────────────────────────
  const body = (req.body ?? {}) as Record<string, unknown>;
  const options = (body["options"] ?? {}) as Record<string, unknown>;

  // dryRun MUST be exactly true — never allow writes
  if (options["dryRun"] !== true) {
    res.status(400).json({
      error: "options.dryRun must be exactly true — production writes are not permitted",
    });
    return;
  }

  const providerId = typeof body["providerId"] === "string" ? body["providerId"].trim() : "";
  if (!providerId) {
    res.status(400).json({ error: "providerId is required" });
    return;
  }

  // maxRecords validation
  const maxRecordsRaw = options["maxRecords"];
  if (maxRecordsRaw !== undefined) {
    if (
      typeof maxRecordsRaw !== "number" ||
      !Number.isInteger(maxRecordsRaw) ||
      maxRecordsRaw < 1 ||
      maxRecordsRaw > MAX_RECORDS_PER_PREVIEW
    ) {
      res.status(400).json({
        error: `options.maxRecords must be a positive integer <= ${MAX_RECORDS_PER_PREVIEW}`,
        max: MAX_RECORDS_PER_PREVIEW,
      });
      return;
    }
  }

  // ── Provider lookup ────────────────────────────────────────────────────────
  let provider;
  try {
    provider = getProvider(providerId);
  } catch (err) {
    if (err instanceof CatalogProviderNotFoundError) {
      res.status(404).json({
        error: `Provider '${providerId}' is not registered`,
        hint: "Ensure provider feature flag is enabled and the provider was registered at startup",
      });
      return;
    }
    throw err;
  }

  // ── Server-side provider config ────────────────────────────────────────────
  // Never accepted from the request body — injected server-side only.
  let providerConfig: unknown = null;
  if (providerId === NIRO_GRANITE_PROVIDER_ID) {
    providerConfig = getNiroGraniteServerConfig();
  }

  // ── AbortSignal (client disconnect) ───────────────────────────────────────
  const abortController = new AbortController();
  req.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  // ── Build typed options ────────────────────────────────────────────────────
  const importOptions = {
    dryRun: true as const,
    maxRecords:
      typeof maxRecordsRaw === "number" ? maxRecordsRaw : MAX_RECORDS_PER_PREVIEW,
    cursor:
      typeof options["cursor"] === "string" ? options["cursor"] : undefined,
    brand:
      typeof options["brand"] === "string" ? options["brand"] : undefined,
    country:
      typeof options["country"] === "string" ? options["country"] : undefined,
  };

  logger.info(
    { runId, providerId, maxRecords: importOptions.maxRecords },
    "[material-catalog-route] Starting import preview",
  );

  try {
    const previewResult = await runImportPreview({
      provider,
      providerConfig,
      options: importOptions,
      abortSignal: abortController.signal,
    });

    const completedAt = new Date();
    const report = buildImportReport({
      runId,
      providerId,
      startedAt,
      completedAt,
      previewResult,
      sourceMetadata: previewResult.sourceMetadata,
    });

    res.json({ report });
  } catch (err) {
    const completedAt = new Date();

    if (err instanceof CatalogProductionImportRejectedError) {
      const report = buildRejectedReport({
        runId,
        providerId,
        startedAt,
        reason: "dryRun must be true — production import rejected",
      });
      res.status(400).json({ report, error: "Production import rejected" });
      return;
    }

    if (
      err instanceof CatalogPayloadTooLargeError ||
      err instanceof CatalogResponseTooLargeError
    ) {
      const message = err instanceof Error ? err.message : String(err);
      const report = buildRejectedReport({ runId, providerId, startedAt, reason: message });
      res.status(413).json({ report, error: message });
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { runId, providerId, error: message },
      "[material-catalog-route] Preview failed",
    );
    const report = buildRejectedReport({ runId, providerId, startedAt, reason: message });
    res.status(422).json({ report, error: message });
  }
});

export default router;
