/**
 * /ai/design-knowledge — Team 23
 *
 * Routes:
 *   POST /ai/design-knowledge/query    — execute a knowledge query
 *   GET  /ai/design-knowledge/providers — list registered providers
 *
 * Auth: admin API key (via global adminAuthWithExceptions middleware).
 * Scope: tenantId / platformId are extracted from the request body, never
 *        hard-coded. Raw provider payloads are never forwarded to the client.
 */

import { Router, type Request, type Response } from "express";
import { designKnowledgeAdapter } from "../services/design-knowledge/adapter.js";
import type { DesignKnowledgeQuery, KnowledgeScope } from "../services/design-knowledge/types.js";

const router = Router();

// ── POST /ai/design-knowledge/query ──────────────────────────────────────────

router.post("/ai/design-knowledge/query", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  const queryText = typeof body["query"] === "string" ? body["query"].trim() : "";
  if (!queryText) {
    res.status(400).json({ error: "query must be a non-empty string." });
    return;
  }

  // Build scope from request body (never hard-coded)
  const rawScope = (body["scope"] ?? {}) as Record<string, unknown>;
  const scope: KnowledgeScope = {
    tenantId:    typeof rawScope["tenantId"]    === "string" ? rawScope["tenantId"]    : undefined,
    platformId:  typeof rawScope["platformId"]  === "string" ? rawScope["platformId"]  : undefined,
    serviceType: typeof rawScope["serviceType"] === "string" ? rawScope["serviceType"] : undefined,
    domain:      typeof rawScope["domain"]      === "string" ? rawScope["domain"]      : undefined,
  };

  const rawFilter = (body["filter"] ?? {}) as Record<string, unknown>;
  const q: DesignKnowledgeQuery = {
    query:          queryText,
    clientId:       typeof body["clientId"]  === "string" ? body["clientId"]  : undefined,
    projectId:      typeof body["projectId"] === "string" ? body["projectId"] : undefined,
    scope:          Object.values(scope).some(Boolean) ? scope : undefined,
    requestedTypes: Array.isArray(body["requestedTypes"]) ? (body["requestedTypes"] as string[]) as DesignKnowledgeQuery["requestedTypes"] : undefined,
    filter: {
      types:         Array.isArray(rawFilter["types"])
        ? rawFilter["types"] as DesignKnowledgeQuery["requestedTypes"]
        : undefined,
      industry:      typeof rawFilter["industry"]      === "string" ? rawFilter["industry"]      : undefined,
      style:         typeof rawFilter["style"]         === "string" ? rawFilter["style"]         : undefined,
      limit:         typeof rawFilter["limit"]         === "number" ? rawFilter["limit"]         : undefined,
      minConfidence: typeof rawFilter["minConfidence"] === "string"
        ? rawFilter["minConfidence"] as "high" | "medium" | "low"
        : undefined,
    },
  };

  try {
    const result = await designKnowledgeAdapter.query(q);
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    res.status(500).json({ error: message });
  }
});

// ── GET /ai/design-knowledge/providers ───────────────────────────────────────

router.get("/ai/design-knowledge/providers", (_req: Request, res: Response): void => {
  const providers = designKnowledgeAdapter.listProviders();
  res.status(200).json({ providers });
});

export default router;
