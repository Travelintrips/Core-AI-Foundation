/**
 * Export Workspace Routes — Team 17
 *
 * All routes are protected by the global adminAuthWithExceptions middleware
 * applied at app.ts level (/api prefix).
 *
 * Route prefix: /ai/export-workspace
 *
 * GET    /ai/export-workspace/formats               — list registered formats
 * GET    /ai/export-workspace/formats/:formatId     — format detail + capability
 * GET    /ai/export-workspace/presets               — list registered presets
 * POST   /ai/export-workspace/estimate              — estimate cost + time (no side effects)
 * POST   /ai/export-workspace/submit                — submit export job
 * GET    /ai/export-workspace/jobs/:jobId           — job status summary
 * POST   /ai/export-workspace/jobs/:jobId/cancel    — cancel in-progress job
 * POST   /ai/export-workspace/jobs/:jobId/retry     — retry failed/cancelled job
 * GET    /ai/export-workspace/jobs/:jobId/result    — get signed download URL
 */

import { Router } from "express";
import {
  exportFormatRegistry,
  type ExportRequest,
} from "../../services/export-workspace/exportFormatRegistry.js";
import {
  validateExportRequest,
  estimateExport,
  submitExport,
  getExportJobSummary,
  cancelExport,
  retryExport,
  getExportResult,
} from "../../services/export-workspace/exportWorkspaceService.js";
import { DEFAULT_TENANT_ID } from "../../security/tenantResolution.js";

const router = Router();

// ── Tenant resolution ─────────────────────────────────────────────────────────
// Server-resolved tenantId only — never trust client-supplied tenantId.

function resolveTenantId(req: Parameters<typeof router.use>[0] extends (req: infer R, ...args: unknown[]) => unknown ? R : never): string {
  // In a multi-tenant deployment the tenantId is resolved from the authenticated
  // session/JWT. Fall back to DEFAULT_TENANT_ID in single-tenant mode.
  const ctx = (req as Record<string, unknown>)["requestContext"] as
    | { tenantId?: string }
    | undefined;
  return ctx?.tenantId ?? DEFAULT_TENANT_ID;
}

// ── Format list ───────────────────────────────────────────────────────────────

/** GET /api/ai/export-workspace/formats */
router.get("/ai/export-workspace/formats", (req, res) => {
  try {
    const domain = typeof req.query["domain"] === "string" ? req.query["domain"] : undefined;
    const formats = exportFormatRegistry.listFormats({ domain });
    res.json({ formats, total: formats.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

/** GET /api/ai/export-workspace/formats/:formatId */
router.get("/ai/export-workspace/formats/:formatId", (req, res) => {
  const formatId = req.params["formatId"] ?? "";
  const domain = typeof req.query["domain"] === "string" ? req.query["domain"] : undefined;

  const definition = exportFormatRegistry.getFormat(formatId);
  if (!definition) {
    res.status(404).json({ error: `Format "${formatId}" not found.` });
    return;
  }

  const capability = exportFormatRegistry.getCapability(formatId, domain);
  res.json({ definition, capability });
});

// ── Preset list ───────────────────────────────────────────────────────────────

/** GET /api/ai/export-workspace/presets */
router.get("/ai/export-workspace/presets", (req, res) => {
  try {
    const domain = typeof req.query["domain"] === "string" ? req.query["domain"] : undefined;
    const presets = exportFormatRegistry.listPresets({ domain });
    res.json({ presets, total: presets.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

// ── Estimate ──────────────────────────────────────────────────────────────────

/**
 * POST /api/ai/export-workspace/estimate
 * Body: { request: ExportRequest, pageCount?: number }
 * No side effects — safe to call before submitting.
 */
router.post("/ai/export-workspace/estimate", (req, res) => {
  try {
    const request = req.body["request"] as ExportRequest | undefined;
    if (!request) {
      res.status(400).json({ error: "request body field is required." });
      return;
    }

    // Validate first so estimate reflects a real request
    const validation = validateExportRequest(request);
    if (!validation.valid) {
      res.status(400).json({ error: "Invalid export request.", details: validation.errors });
      return;
    }

    const pageCount = typeof req.body["pageCount"] === "number" ? req.body["pageCount"] : undefined;
    const estimate = estimateExport(request, pageCount);
    res.json({ estimate, validation });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

// ── Submit ────────────────────────────────────────────────────────────────────

/**
 * POST /api/ai/export-workspace/submit
 * Body: { request: ExportRequest, idempotencyKey?: string }
 */
router.post("/ai/export-workspace/submit", async (req, res) => {
  try {
    const request = req.body["request"] as ExportRequest | undefined;
    if (!request) {
      res.status(400).json({ error: "request body field is required." });
      return;
    }

    const idempotencyKey = typeof req.body["idempotencyKey"] === "string"
      ? req.body["idempotencyKey"]
      : undefined;

    const tenantId = resolveTenantId(req as Parameters<typeof router.use>[0] extends (req: infer R, ...args: unknown[]) => unknown ? R : never);

    const result = await submitExport({ tenantId, request, idempotencyKey });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    // Validation errors → 400
    if (msg.startsWith("Export validation failed:")) {
      res.status(400).json({ error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ── Job status ────────────────────────────────────────────────────────────────

/** GET /api/ai/export-workspace/jobs/:jobId */
router.get("/ai/export-workspace/jobs/:jobId", async (req, res) => {
  try {
    const jobId = parseInt(req.params["jobId"] ?? "", 10);
    if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId." }); return; }

    const tenantId = resolveTenantId(req as Parameters<typeof router.use>[0] extends (req: infer R, ...args: unknown[]) => unknown ? R : never);
    const summary = await getExportJobSummary(jobId, tenantId);
    if (!summary) { res.status(404).json({ error: "Job not found." }); return; }
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

// ── Cancel ────────────────────────────────────────────────────────────────────

/** POST /api/ai/export-workspace/jobs/:jobId/cancel */
router.post("/ai/export-workspace/jobs/:jobId/cancel", async (req, res) => {
  try {
    const jobId = parseInt(req.params["jobId"] ?? "", 10);
    if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId." }); return; }

    const tenantId = resolveTenantId(req as Parameters<typeof router.use>[0] extends (req: infer R, ...args: unknown[]) => unknown ? R : never);
    const result = await cancelExport(jobId, tenantId);
    if (!result.ok) { res.status(409).json({ error: result.message }); return; }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

// ── Retry ─────────────────────────────────────────────────────────────────────

/** POST /api/ai/export-workspace/jobs/:jobId/retry */
router.post("/ai/export-workspace/jobs/:jobId/retry", async (req, res) => {
  try {
    const jobId = parseInt(req.params["jobId"] ?? "", 10);
    if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId." }); return; }

    const tenantId = resolveTenantId(req as Parameters<typeof router.use>[0] extends (req: infer R, ...args: unknown[]) => unknown ? R : never);
    const result = await retryExport(jobId, tenantId);
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    const status = msg.includes("Cannot retry") ? 409 : 500;
    res.status(status).json({ error: msg });
  }
});

// ── Result / download ─────────────────────────────────────────────────────────

/** GET /api/ai/export-workspace/jobs/:jobId/result */
router.get("/ai/export-workspace/jobs/:jobId/result", async (req, res) => {
  try {
    const jobId = parseInt(req.params["jobId"] ?? "", 10);
    if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId." }); return; }

    const tenantId = resolveTenantId(req as Parameters<typeof router.use>[0] extends (req: infer R, ...args: unknown[]) => unknown ? R : never);
    const result = await getExportResult(jobId, tenantId);

    if (!result) {
      res.status(404).json({ error: "Job not found or not yet completed." });
      return;
    }

    // Never expose raw internal storage paths to the client without a signed token
    const safeResult = { ...result, storagePath: undefined };
    res.json(safeResult);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

export default router;
