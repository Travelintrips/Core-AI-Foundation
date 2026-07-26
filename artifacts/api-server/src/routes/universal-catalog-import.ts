/**
 * Universal Catalog Import Engine — Phase 4A
 * Admin-only routes for catalog ingestion preview.
 *
 * All routes require admin authentication.
 * No route triggers a write to canonical materials.
 * All results are dry-run staging previews only.
 *
 * Routes:
 *   GET  /universal-catalog/adapters          — list available adapters + capabilities
 *   POST /universal-catalog/preview           — run import pipeline (file upload or URL)
 *   GET  /universal-catalog/jobs/:jobId       — get job status
 *   GET  /universal-catalog/jobs/:jobId/items — get staged items for a job
 */

import { Router } from "express";
import multer from "multer";
import { adminAuth } from "../middleware/adminAuth.js";
import { runImportPipeline } from "../domains/universal-catalog-import/catalogImportPipeline.js";
import { getJob, getStagingItems } from "../domains/universal-catalog-import/stagingService.js";
import { csvAdapter } from "../domains/universal-catalog-import/adapters/csvAdapter.js";
import { excelAdapter } from "../domains/universal-catalog-import/adapters/excelAdapter.js";
import { jsonAdapter } from "../domains/universal-catalog-import/adapters/jsonAdapter.js";
import { xmlAdapter } from "../domains/universal-catalog-import/adapters/xmlAdapter.js";
import { pdfAdapter } from "../domains/universal-catalog-import/adapters/pdfAdapter.js";
import { websiteAdapter } from "../domains/universal-catalog-import/adapters/websiteAdapter.js";
import { apiAdapter } from "../domains/universal-catalog-import/adapters/apiAdapter.js";
import type { AdapterSourceType } from "../domains/universal-catalog-import/types.js";
import { logger } from "../lib/logger.js";

const router = Router();

// Multer: in-memory storage, 50 MB limit, single file field "file"
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "text/csv",
      "text/plain",
      "application/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/json",
      "text/json",
      "application/xml",
      "text/xml",
      "application/octet-stream",
    ];
    // Allow if MIME is known or extension suggests a valid type
    const ext = (file.originalname ?? "").split(".").pop()?.toLowerCase() ?? "";
    const validExts = ["pdf", "csv", "xlsx", "xls", "json", "xml", "txt"];
    if (allowed.includes(file.mimetype) || validExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

const ADAPTERS = [csvAdapter, excelAdapter, jsonAdapter, xmlAdapter, pdfAdapter, websiteAdapter, apiAdapter];

// ── GET /universal-catalog/adapters ──────────────────────────────────────────

router.get("/universal-catalog/adapters", adminAuth, (_req, res) => {
  res.json({
    adapters: ADAPTERS.map((a) => ({
      sourceType: a.sourceType,
      displayName: a.displayName,
      supportedMimeTypes: a.supportedMimeTypes,
      requiresFile: ["pdf", "csv", "excel", "json", "xml"].includes(a.sourceType),
      requiresUrl: a.sourceType === "website",
      isStub: a.sourceType === "api",
    })),
  });
});

// ── POST /universal-catalog/preview ──────────────────────────────────────────

router.post(
  "/universal-catalog/preview",
  adminAuth,
  upload.single("file"),
  async (req, res) => {
    const domain = "universal-catalog-import";

    try {
      // Determine source type
      const rawSourceType = (req.body?.["sourceType"] as string) ?? "";
      const validTypes: AdapterSourceType[] = ["pdf", "website", "csv", "excel", "json", "xml", "api"];
      if (!validTypes.includes(rawSourceType as AdapterSourceType)) {
        res.status(400).json({
          error: "Invalid sourceType",
          valid: validTypes,
        });
        return;
      }
      const sourceType = rawSourceType as AdapterSourceType;

      // Determine input source
      const file = req.file;
      const url = req.body?.["url"] as string | undefined;

      if (!file && !url) {
        res.status(400).json({ error: "Either a file upload ('file' field) or 'url' is required" });
        return;
      }

      if (sourceType === "website" && !url) {
        res.status(400).json({ error: "sourceType=website requires a 'url' field" });
        return;
      }

      // Validate URL (website only) — HTTPS enforced
      if (url) {
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== "https:") {
            res.status(400).json({ error: "Only HTTPS URLs are permitted" });
            return;
          }
        } catch {
          res.status(400).json({ error: "Invalid URL" });
          return;
        }
      }

      // Parse options
      let opts: Record<string, unknown> = {};
      if (req.body?.["options"]) {
        try {
          opts = typeof req.body["options"] === "string"
            ? JSON.parse(req.body["options"] as string)
            : req.body["options"] as Record<string, unknown>;
        } catch {
          // Ignore malformed options
        }
      }

      const maxItems = Math.min(parseInt(String(opts["maxItems"] ?? "100"), 10) || 100, 500);
      const skipAI = String(opts["skipAI"]) === "true";
      const brandHint = typeof opts["brandHint"] === "string" ? opts["brandHint"] : undefined;
      const categoryHint = typeof opts["categoryHint"] === "string" ? opts["categoryHint"] : undefined;
      const idempotencyKey = typeof opts["idempotencyKey"] === "string" ? opts["idempotencyKey"] : undefined;

      logger.info({ domain, sourceType, filename: file?.originalname, url, maxItems }, "[preview] Starting pipeline");

      const result = await runImportPipeline(
        {
          type: sourceType,
          buffer: file?.buffer,
          filename: file?.originalname,
          url,
        },
        { maxItems, skipAI, brandHint, categoryHint, idempotencyKey },
      );

      // Return preview-safe response (no import/save trigger)
      res.json({
        jobId: result.job.id,
        status: result.job.status,
        sourceType: result.job.sourceType,
        sourceName: result.job.sourceName,
        counts: {
          totalRaw: result.job.totalRaw,
          totalNormalized: result.job.totalNormalized,
          new: result.counts.new,
          exact_duplicate: result.counts.exact_duplicate,
          possible_duplicate: result.counts.possible_duplicate,
          conflicting_identity: result.counts.conflicting_identity,
          invalid: result.counts.invalid,
          needs_review: result.counts.needs_review,
        },
        items: result.items.map((item) => ({
          stagingId: item.stagingId,
          status: item.status,
          productName: item.material.productName,
          brand: item.material.brand,
          productCode: item.material.productCode,
          category: item.material.category,
          subcategory: item.material.subcategory,
          materialType: item.material.materialType,
          colors: item.material.colors,
          finish: item.material.finish,
          sourceType: item.material.sourceType,
          sourceName: item.material.sourceName,
          sourcePage: item.material.sourcePage,
          duplicateInfo: item.duplicateInfo,
          validationErrors: item.validationErrors,
        })),
        warnings: result.job.warnings,
        errors: result.job.errors,
        processedAt: new Date().toISOString(),
        // Explicit: this is a preview only
        _previewOnly: true,
        _noCanonicalWrite: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ domain, err }, "[preview] Pipeline error");
      res.status(500).json({ error: "Import pipeline failed", detail: msg });
    }
  },
);

// ── GET /universal-catalog/jobs/:jobId ───────────────────────────────────────

router.get("/universal-catalog/jobs/:jobId", adminAuth, async (req, res) => {
  const jobId = String(req.params["jobId"] ?? "");
  if (!jobId) { res.status(400).json({ error: "jobId required" }); return; }

  const job = await getJob(jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  res.json({ job });
});

// ── GET /universal-catalog/jobs/:jobId/items ──────────────────────────────────

router.get("/universal-catalog/jobs/:jobId/items", adminAuth, async (req, res) => {
  const jobId = String(req.params["jobId"] ?? "");
  if (!jobId) { res.status(400).json({ error: "jobId required" }); return; }

  const limit = Math.min(parseInt(String(req.query["limit"] ?? "500"), 10) || 500, 500);
  const items = await getStagingItems(jobId, limit);

  res.json({
    jobId,
    totalItems: items.length,
    items: items.map((item) => ({
      stagingId: item.stagingId,
      status: item.status,
      productName: item.material.productName,
      brand: item.material.brand,
      productCode: item.material.productCode,
      category: item.material.category,
      subcategory: item.material.subcategory,
      materialType: item.material.materialType,
      colors: item.material.colors,
      finish: item.material.finish,
      sourceType: item.material.sourceType,
      sourceName: item.material.sourceName,
      sourcePage: item.material.sourcePage,
      duplicateInfo: item.duplicateInfo,
      validationErrors: item.validationErrors,
    })),
    _previewOnly: true,
    _noCanonicalWrite: true,
  });
});

export default router;
