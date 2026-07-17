/**
 * Universal Template Matching — Route Handlers (Team 11)
 *
 * LOCAL routes only. NOT registered in routes/index.ts.
 * Team 24 (Integration Lead) will wire these into the router registry.
 *
 * Base path (when mounted): /api/ai/template-matching
 *
 * Routes:
 *   POST /match           — Run full template matching
 *   POST /score/:id       — Score a single blueprint against input
 *   GET  /health          — Liveness check for this domain (no auth required)
 *
 * Security:
 *   All routes except /health are protected by router-level adminAuth.
 *   The global adminAuthWithExceptions in app.ts also covers these routes,
 *   but explicit router-level auth is required by the remediation protocol.
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { adminAuth } from "../../middleware/adminAuth.js";
import { getDefaultMatcher } from "../../services/universal-template-matching/index.js";
import type { MatchInput } from "../../services/universal-template-matching/index.js";

const router = Router();

// ── Router-level auth ─────────────────────────────────────────────────────────
// /health is exempt (liveness probe, no sensitive data).
// All other routes require valid admin credentials.
router.use((req: Request, res: Response, next: NextFunction): void => {
  if (req.path === "/health" || req.path === "/health/") {
    next();
    return;
  }
  void adminAuth(req, res, next);
});

// ── POST /match ──────────────────────────────────────────────────────────────

/**
 * Run universal template matching.
 *
 * Body (all optional, but at least one of serviceType/domain/category recommended):
 * {
 *   serviceType?: string,
 *   domain?: string,
 *   category?: string,
 *   brief?: string,
 *   brandDna?: { personalities?, voice?, writingStyle?, primaryColorHex?, ... },
 *   industry?: string,
 *   audience?: string[],
 *   output?: string[],
 *   package?: string,
 *   style?: string[],
 *   constraints?: string[],
 *   limit?: number (1–20, default 5)
 * }
 *
 * Response 200:
 * {
 *   topRecommendation: MatchRecommendation | null,
 *   alternatives: MatchRecommendation[],
 *   rejected: RejectedBlueprint[],
 *   confidence: number,
 *   explanation: string,
 *   candidatesEvaluated: number,
 *   signalsUsed: string[],
 *   signalsMissing: string[]
 * }
 */
router.post("/match", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = parseMatchInput(req.body);
    const validationError = validateMatchInput(input);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const matcher = getDefaultMatcher();
    const result = await matcher.match(input);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// ── POST /score/:id ───────────────────────────────────────────────────────────

/**
 * Score a single blueprint by ID against provided input.
 * Useful for explaining why a particular blueprint was/wasn't recommended.
 *
 * Params: id — blueprint ID (numeric string)
 * Body:   same as /match
 *
 * Response 200: MatchResult (with only that blueprint evaluated)
 * Response 404: { error: "Blueprint not found" }
 */
router.post("/score/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawId = req.params["id"];
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id || !/^\d+$/.test(id)) {
      return res.status(400).json({ error: "Blueprint id must be a numeric string." });
    }

    const input = parseMatchInput(req.body);
    const matcher = getDefaultMatcher();
    const result = await matcher.scoreSingle(id, input);

    if (!result) {
      return res.status(404).json({ error: "Blueprint not found or not published." });
    }
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// ── GET /health ───────────────────────────────────────────────────────────────

router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", domain: "universal-template-matching", team: "11" });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseMatchInput(body: unknown): MatchInput {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;

  return {
    serviceType:  typeof b.serviceType === "string"  ? b.serviceType.trim()  : undefined,
    domain:       typeof b.domain === "string"       ? b.domain.trim()       : undefined,
    category:     typeof b.category === "string"     ? b.category.trim()     : undefined,
    brief:        typeof b.brief === "string"        ? b.brief.trim()        : undefined,
    industry:     typeof b.industry === "string"     ? b.industry.trim()     : undefined,
    package:      typeof b.package === "string"      ? b.package.trim()      : undefined,
    audience:     arrayOfStrings(b.audience),
    output:       arrayOfStrings(b.output),
    style:        arrayOfStrings(b.style),
    constraints:  arrayOfStrings(b.constraints),
    limit:        typeof b.limit === "number" && b.limit > 0 ? Math.min(b.limit, 20) : undefined,
    brandDna:     parseBrandDna(b.brandDna),
  };
}

function parseBrandDna(raw: unknown): MatchInput["brandDna"] {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  return {
    personalities:   arrayOfStrings(d.personalities),
    voice:           typeof d.voice === "string"           ? d.voice.trim()           : undefined,
    writingStyle:    typeof d.writingStyle === "string"    ? d.writingStyle.trim()    : undefined,
    primaryColorHex: typeof d.primaryColorHex === "string" ? d.primaryColorHex.trim() : undefined,
    headingFont:     typeof d.headingFont === "string"     ? d.headingFont.trim()     : undefined,
    bodyFont:        typeof d.bodyFont === "string"        ? d.bodyFont.trim()        : undefined,
    typographyStyle: typeof d.typographyStyle === "string" ? d.typographyStyle.trim() : undefined,
    colorPsychology: arrayOfStrings(d.colorPsychology),
  };
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value.filter((v) => typeof v === "string").map((v) => (v as string).trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

// ── Input size limits (DoS prevention) ───────────────────────────────────────
const MAX_BRIEF_LENGTH      = 2_000;  // characters
const MAX_CONSTRAINTS_COUNT = 20;     // array items
const MAX_ARRAY_ITEMS       = 50;     // generic array cap (audience, output, style)

function validateMatchInput(input: MatchInput): string | null {
  const hasAnySignal = [
    input.serviceType,
    input.domain,
    input.category,
    input.industry,
    input.brief,
    input.brandDna,
    input.audience?.length,
    input.output?.length,
    input.style?.length,
  ].some(Boolean);

  if (!hasAnySignal) {
    return "At least one matching signal must be provided (serviceType, domain, category, industry, brief, brandDna, audience, output, or style).";
  }

  // Size guards
  if (input.brief && input.brief.length > MAX_BRIEF_LENGTH) {
    return `brief must not exceed ${MAX_BRIEF_LENGTH} characters.`;
  }
  if (input.constraints && input.constraints.length > MAX_CONSTRAINTS_COUNT) {
    return `constraints array must not exceed ${MAX_CONSTRAINTS_COUNT} items.`;
  }
  if (input.audience && input.audience.length > MAX_ARRAY_ITEMS) {
    return `audience array must not exceed ${MAX_ARRAY_ITEMS} items.`;
  }
  if (input.output && input.output.length > MAX_ARRAY_ITEMS) {
    return `output array must not exceed ${MAX_ARRAY_ITEMS} items.`;
  }
  if (input.style && input.style.length > MAX_ARRAY_ITEMS) {
    return `style array must not exceed ${MAX_ARRAY_ITEMS} items.`;
  }

  return null;
}

export default router;
