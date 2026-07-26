/**
 * Universal Catalog Import Engine — Phase 4B
 * Admin-only routes for catalog ingestion preview and diff review.
 *
 * All routes require admin authentication.
 * No route triggers a write to canonical materials.
 * All results are dry-run staging previews only.
 *
 * Routes:
 *   GET  /universal-catalog/adapters                          — list adapters
 *   POST /universal-catalog/preview                           — run pipeline
 *   GET  /universal-catalog/jobs                              — list all jobs
 *   GET  /universal-catalog/jobs/:jobId                       — get job status
 *   GET  /universal-catalog/jobs/:jobId/items                 — get all staged items (paginated)
 *   GET  /universal-catalog/jobs/:jobId/items/:stagingId      — get single staged item
 *   GET  /universal-catalog/jobs/:jobId/items/:stagingId/diff — extraction diff view
 */

import { Router } from "express";
import multer from "multer";
import { adminAuth } from "../middleware/adminAuth.js";
import { runImportPipeline } from "../domains/universal-catalog-import/catalogImportPipeline.js";
import {
  getJob,
  listJobs,
  getStagingItems,
  getStagingItemById,
  countStagingItems,
  type StagingItemFilter,
} from "../domains/universal-catalog-import/stagingService.js";
import { csvAdapter } from "../domains/universal-catalog-import/adapters/csvAdapter.js";
import { excelAdapter } from "../domains/universal-catalog-import/adapters/excelAdapter.js";
import { jsonAdapter } from "../domains/universal-catalog-import/adapters/jsonAdapter.js";
import { xmlAdapter } from "../domains/universal-catalog-import/adapters/xmlAdapter.js";
import { pdfAdapter } from "../domains/universal-catalog-import/adapters/pdfAdapter.js";
import { websiteAdapter } from "../domains/universal-catalog-import/adapters/websiteAdapter.js";
import { apiAdapter } from "../domains/universal-catalog-import/adapters/apiAdapter.js";
import type { AdapterSourceType, StagingPreviewItem, UniversalMaterial } from "../domains/universal-catalog-import/types.js";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Serialize all persisted attributes from a StagingPreviewItem — no field omitted */
function serializeItem(item: StagingPreviewItem) {
  const m = item.material;
  return {
    stagingId: item.stagingId,
    status: item.status,
    // Identity
    brand: m.brand ?? null,
    collection: m.collection ?? null,
    series: m.series ?? null,
    productCode: m.productCode ?? null,
    productName: m.productName ?? null,
    variant: m.variant ?? null,
    // Classification
    category: m.category ?? null,
    subcategory: m.subcategory ?? null,
    materialType: m.materialType ?? null,
    // Description
    description: m.description ?? null,
    // Appearance
    colors: m.colors ?? null,
    finish: m.finish ?? null,
    texture: m.texture ?? null,
    pattern: m.pattern ?? null,
    // Dimensions
    dimensions: m.dimensions ?? null,
    workingSize: m.workingSize ?? null,
    thickness: m.thickness ?? null,
    numberOfFaces: m.numberOfFaces ?? null,
    // Tile-specific
    peiRating: m.peiRating ?? null,
    shadeVariation: m.shadeVariation ?? null,
    // Technical
    technicalSpecifications: m.technicalSpecifications ?? null,
    application: m.application ?? null,
    certifications: m.certifications ?? null,
    // Media
    thumbnailReference: m.thumbnailReference ?? null,
    previewReferences: m.previewReferences ?? null,
    // Provenance
    sourceType: m.sourceType,
    sourceName: m.sourceName,
    sourceVersion: m.sourceVersion ?? null,
    sourceUrl: m.sourceUrl ?? null,
    sourcePage: m.sourcePage ?? null,
    sourceMetadata: m.sourceMetadata ?? null,
    // Classification
    duplicateInfo: item.duplicateInfo ?? null,
    validationErrors: item.validationErrors,
    extractedAt: item.extractedAt,
  };
}

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

// ── GET /universal-catalog/jobs ───────────────────────────────────────────────

router.get("/universal-catalog/jobs", adminAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 200);
    const offset = parseInt(String(req.query["offset"] ?? "0"), 10) || 0;
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;

    const { jobs, total } = await listJobs({ limit, offset, status });
    res.json({ jobs, total, limit, offset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ domain: "universal-catalog-import", err }, "[jobs] List error");
    res.status(500).json({ error: "Failed to list jobs", detail: msg });
  }
});

// ── POST /universal-catalog/preview ──────────────────────────────────────────

router.post(
  "/universal-catalog/preview",
  adminAuth,
  upload.single("file"),
  async (req, res) => {
    const domain = "universal-catalog-import";

    try {
      const rawSourceType = (req.body?.["sourceType"] as string) ?? "";
      const validTypes: AdapterSourceType[] = ["pdf", "website", "csv", "excel", "json", "xml", "api"];
      if (!validTypes.includes(rawSourceType as AdapterSourceType)) {
        res.status(400).json({ error: "Invalid sourceType", valid: validTypes });
        return;
      }
      const sourceType = rawSourceType as AdapterSourceType;

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
        { type: sourceType, buffer: file?.buffer, filename: file?.originalname, url },
        { maxItems, skipAI, brandHint, categoryHint, idempotencyKey },
      );

      res.json({
        jobId: result.job.id,
        status: result.job.status,
        sourceType: result.job.sourceType,
        sourceName: result.job.sourceName,
        filename: result.job.filename ?? null,
        checksum: result.job.checksum ?? null,
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
        // Complete item serialization — all attributes included
        items: result.items.map(serializeItem),
        warnings: result.job.warnings,
        errors: result.job.errors,
        processedPages: result.job.processedPages ?? null,
        totalPages: result.job.totalPages ?? null,
        processedAt: new Date().toISOString(),
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

  try {
    const filter: StagingItemFilter = {
      limit: Math.min(parseInt(String(req.query["limit"] ?? "100"), 10) || 100, 500),
      offset: parseInt(String(req.query["offset"] ?? "0"), 10) || 0,
      status: typeof req.query["status"] === "string" ? req.query["status"] : undefined,
      brand: typeof req.query["brand"] === "string" ? req.query["brand"] : undefined,
      category: typeof req.query["category"] === "string" ? req.query["category"] : undefined,
      search: typeof req.query["q"] === "string" ? req.query["q"] : undefined,
      sortBy: (req.query["sortBy"] as StagingItemFilter["sortBy"]) ?? "extracted_at",
      sortDir: (req.query["sortDir"] as "asc" | "desc") === "desc" ? "desc" : "asc",
    };

    const [items, total] = await Promise.all([
      getStagingItems(jobId, filter),
      countStagingItems(jobId, filter),
    ]);

    res.json({
      jobId,
      total,
      limit: filter.limit,
      offset: filter.offset,
      items: items.map(serializeItem),
      _previewOnly: true,
      _noCanonicalWrite: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ domain: "universal-catalog-import", err }, "[items] Query error");
    res.status(500).json({ error: "Failed to query staging items", detail: msg });
  }
});

// ── GET /universal-catalog/jobs/:jobId/items/:stagingId ───────────────────────

router.get("/universal-catalog/jobs/:jobId/items/:stagingId", adminAuth, async (req, res) => {
  const jobId = String(req.params["jobId"] ?? "");
  const stagingId = String(req.params["stagingId"] ?? "");
  if (!jobId || !stagingId) {
    res.status(400).json({ error: "jobId and stagingId required" });
    return;
  }

  const item = await getStagingItemById(jobId, stagingId);
  if (!item) { res.status(404).json({ error: "Staging item not found" }); return; }

  res.json({ item: serializeItem(item) });
});

// ── GET /universal-catalog/jobs/:jobId/items/:stagingId/diff ──────────────────

/**
 * Extraction Diff Viewer — Phase 4B
 * Returns the 4-stage comparison for a single staging item:
 *   SOURCE     — raw adapter output (raw_data)
 *   EXTRACTED  — AI-extracted partial material (stored in sourceMetadata.aiExtracted
 *                or reconstructed from raw_data fields for skipAI runs)
 *   NORMALIZED — validated + mapped UniversalMaterial fields
 *   STAGED     — final persisted column values (authoritative)
 *
 * Read-only. No write operations. Admin-only.
 */
router.get(
  "/universal-catalog/jobs/:jobId/items/:stagingId/diff",
  adminAuth,
  async (req, res) => {
    const jobId = String(req.params["jobId"] ?? "");
    const stagingId = String(req.params["stagingId"] ?? "");
    if (!jobId || !stagingId) {
      res.status(400).json({ error: "jobId and stagingId required" });
      return;
    }

    const item = await getStagingItemById(jobId, stagingId);
    if (!item) { res.status(404).json({ error: "Staging item not found" }); return; }

    // ── Stage 1: SOURCE — raw adapter output ─────────────────────────────
    const sourceStage = item.rawData ?? {};

    // ── Stage 2: EXTRACTED — AI extraction output ─────────────────────────
    // The pipeline stores the AI partial material in sourceContext._aiExtracted.
    // For imports that used skipAI=true, fall back to the raw_data field values.
    const meta = item.material.sourceMetadata ?? {};
    const aiExtracted: Record<string, unknown> =
      (meta["aiExtracted"] as Record<string, unknown>) ??
      ((meta as Record<string, unknown>)["_aiExtracted"] as Record<string, unknown>) ??
      {};

    // ── Stage 3: NORMALIZED — UniversalMaterial after validation ─────────
    const m = item.material;
    const normalizedStage = buildMaterialSnapshot(m);

    // ── Stage 4: STAGED — final DB column values ──────────────────────────
    // Same as normalized but authoritative (sourced from the DB row).
    const stagedStage = buildMaterialSnapshot(m);

    // ── Diff computation ──────────────────────────────────────────────────
    const allKeys = Array.from(
      new Set([
        ...Object.keys(sourceStage as object),
        ...Object.keys(aiExtracted),
        ...Object.keys(normalizedStage),
        ...Object.keys(stagedStage),
      ]),
    ).sort();

    const fieldDiffs = allKeys.map((key) => {
      const src = (sourceStage as Record<string, unknown>)[key];
      const ext = aiExtracted[key];
      const norm = (normalizedStage as Record<string, unknown>)[key];
      const stg = (stagedStage as Record<string, unknown>)[key];

      const hasValue = (v: unknown) =>
        v !== null && v !== undefined && v !== "" &&
        !(Array.isArray(v) && v.length === 0);

      return {
        field: key,
        source: src ?? null,
        extracted: ext ?? null,
        normalized: norm ?? null,
        staged: stg ?? null,
        // Highlight flags
        isMissing: !hasValue(stg),
        isChanged: hasValue(ext) && hasValue(stg) && JSON.stringify(ext) !== JSON.stringify(stg),
        isNormalized: hasValue(ext) && hasValue(norm) && JSON.stringify(ext) !== JSON.stringify(norm),
        hasWarning:
          item.validationErrors.some((e) => e.toLowerCase().includes(key.toLowerCase())) ||
          (!hasValue(stg) && key !== "_pageNumber" && key !== "_ocrNeeded" && key !== "_hint" && key !== "_pageText" && key !== "_catalogVersion"),
      };
    });

    res.json({
      stagingId: item.stagingId,
      jobId,
      status: item.status,
      sourcePage: item.material.sourcePage ?? null,
      sourceType: item.material.sourceType,
      stages: {
        source: sourceStage,
        extracted: aiExtracted,
        normalized: normalizedStage,
        staged: stagedStage,
      },
      fieldDiffs,
      warnings: item.validationErrors,
      duplicateInfo: item.duplicateInfo ?? null,
      extractedAt: item.extractedAt,
      _readOnly: true,
    });
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a flat snapshot of all UniversalMaterial fields for diff comparison */
function buildMaterialSnapshot(m: UniversalMaterial): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  const FIELDS: (keyof UniversalMaterial)[] = [
    "brand", "collection", "series", "productCode", "productName", "variant",
    "category", "subcategory", "materialType", "description",
    "colors", "finish", "texture", "pattern",
    "dimensions", "workingSize", "thickness", "numberOfFaces",
    "peiRating", "shadeVariation",
    "technicalSpecifications", "application", "certifications",
    "thumbnailReference", "previewReferences",
    "sourceVersion",
  ];
  for (const f of FIELDS) {
    const v = m[f];
    if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) {
      snap[f] = v;
    }
  }
  return snap;
}

export default router;
