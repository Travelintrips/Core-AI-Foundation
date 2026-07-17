/**
 * patternSearchService.ts — Team 09
 *
 * Full-text + faceted search for the design pattern library.
 * Uses PostgreSQL tsvector index (defined in team-09.sql migration).
 *
 * Public search is always locked to PUBLIC_STATUSES and license-safe patterns.
 * Admin search (publicOnly=false) may pass any status.
 */

import { pool } from "@workspace/db";
import type { DesignPattern } from "./patternService.js";
import { PATTERN_DOMAINS, PATTERN_CATEGORIES, REPEAT_BEHAVIORS, SCALE_VALUES, MAX_PATTERN_LIMIT } from "./patternService.js";
import { PUBLIC_STATUSES } from "./patternAdapter.js";
import { z } from "zod/v4";

// ── Query schema ──────────────────────────────────────────────────────────────

export const PatternSearchQuerySchema = z.object({
  q:               z.string().max(200).optional(),
  domain:          z.enum(PATTERN_DOMAINS).optional(),
  category:        z.enum(PATTERN_CATEGORIES).optional(),
  style:           z.string().max(80).optional(),
  repeat_behavior: z.enum(REPEAT_BEHAVIORS).optional(),
  scale:           z.enum(SCALE_VALUES).optional(),
  colorizable:     z.string().optional(),   // "true" | "false" — converted in query builder
  source_type:     z.string().optional(),
  context:         z.string().max(80).optional(),   // filter by compat context
  tags:            z.string().optional(),            // comma-separated
  // status is intentionally NOT exposed in the public schema.
  // Route layer injects publicOnly=true for public callers.
  limit:           z.coerce.number().int().min(1).max(MAX_PATTERN_LIMIT).default(24),
  offset:          z.coerce.number().int().min(0).default(0),
  sort:            z.enum(["name", "created_at", "updated_at", "domain"]).default("name"),
  order:           z.enum(["asc", "desc"]).default("asc"),
});

export type PatternSearchQuery = z.infer<typeof PatternSearchQuerySchema>;

export interface PatternSearchResult {
  patterns: (DesignPattern & { rank?: number })[];
  total:    number;
  facets:   {
    domains:      Record<string, number>;
    categories:   Record<string, number>;
    styles:       Record<string, number>;
    source_types: Record<string, number>;
  };
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * @param raw    — validated query params (from PatternSearchQuerySchema)
 * @param publicOnly — when true (default), locks to PUBLIC_STATUSES + license-safe only.
 *                     Set false for admin/internal callers who need to see all statuses.
 */
export async function searchPatterns(
  raw: PatternSearchQuery,
  publicOnly = true,
): Promise<PatternSearchResult> {
  const query  = PatternSearchQuerySchema.parse(raw);
  const client = await pool.connect();

  try {
    const conditions: string[] = [];
    const params: unknown[]    = [];
    let   idx = 1;

    // ── Visibility filter (PUBLIC_STATUSES + license-safe) ────────────────────
    if (publicOnly) {
      conditions.push(`p.status = ANY($${idx++}::text[])`);
      params.push(PUBLIC_STATUSES);
      conditions.push(`(p.source_type IN ('original','public-domain') OR p.license IS NOT NULL)`);
    }

    // ── Domain ────────────────────────────────────────────────────────────────
    if (query.domain) {
      conditions.push(`p.domain = $${idx++}`);
      params.push(query.domain);
    }

    // ── Category ──────────────────────────────────────────────────────────────
    if (query.category) {
      conditions.push(`p.category = $${idx++}`);
      params.push(query.category);
    }

    // ── Style ─────────────────────────────────────────────────────────────────
    if (query.style) {
      conditions.push(`p.style ILIKE $${idx++}`);
      params.push(`%${query.style}%`);
    }

    // ── Repeat behavior ───────────────────────────────────────────────────────
    if (query.repeat_behavior) {
      conditions.push(`p.repeat_behavior = $${idx++}`);
      params.push(query.repeat_behavior);
    }

    // ── Scale ─────────────────────────────────────────────────────────────────
    if (query.scale) {
      conditions.push(`p.scale = $${idx++}`);
      params.push(query.scale);
    }

    // ── Colorizable — query string "true"/"false" → boolean ──────────────────
    if (query.colorizable !== undefined) {
      conditions.push(`p.colorizable = $${idx++}`);    // FIX: was missing the `$`
      params.push(query.colorizable === "true");
    }

    // ── Source type ───────────────────────────────────────────────────────────
    if (query.source_type) {
      conditions.push(`p.source_type = $${idx++}`);
      params.push(query.source_type);
    }

    // ── Tags (comma-separated → overlap with array) ───────────────────────────
    if (query.tags) {
      const tagList = query.tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        conditions.push(`p.tags && $${idx++}::text[]`);
        params.push(tagList);
      }
    }

    // ── Compatibility context join ────────────────────────────────────────────
    let compatJoin = "";
    if (query.context) {
      compatJoin = `JOIN ai_platform.design_pattern_compat c ON c.pattern_id = p.id AND c.context = $${idx++}`;
      params.push(query.context);
    }

    // ── Full-text search ──────────────────────────────────────────────────────
    let rankSelect = "";
    if (query.q) {
      conditions.push(
        `to_tsvector('english', COALESCE(p.name,'') || ' ' || COALESCE(p.description,'') || ' ' || COALESCE(array_to_string(p.tags,' '),''))
         @@ plainto_tsquery('english', $${idx++})`,
      );
      params.push(query.q);
      rankSelect = `,ts_rank(to_tsvector('english', COALESCE(p.name,'') || ' ' || COALESCE(p.description,'') || ' ' || COALESCE(array_to_string(p.tags,' '),'')), plainto_tsquery('english', $${idx - 1})) AS rank`;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // ── Sort — whitelisted column map (prevents SQL injection) ────────────────
    const SORT_COL_MAP: Record<string, string> = {
      name: "p.name", created_at: "p.created_at", updated_at: "p.updated_at", domain: "p.domain",
    };
    const sortCol  = SORT_COL_MAP[query.sort] ?? "p.name";
    const orderDir = query.order === "desc" ? "DESC" : "ASC";

    const mainSql = `
      SELECT DISTINCT p.* ${rankSelect}
      FROM ai_platform.design_patterns p
      ${compatJoin}
      ${where}
      ORDER BY ${query.q ? "rank DESC," : ""} ${sortCol} ${orderDir}
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    const countSql = `
      SELECT COUNT(DISTINCT p.id)::text AS total
      FROM ai_platform.design_patterns p
      ${compatJoin}
      ${where}
    `;
    // Facets always use public statuses for consistency
    const facetSql = `
      SELECT domain, category, style, source_type, COUNT(*)::int AS cnt
      FROM ai_platform.design_patterns p
      WHERE status = ANY($1::text[])
        AND (source_type IN ('original','public-domain') OR license IS NOT NULL)
      GROUP BY domain, category, style, source_type
    `;

    const [mainRes, countRes, facetRes] = await Promise.all([
      client.query<DesignPattern & { rank?: number }>(mainSql, [...params, query.limit, query.offset]),
      client.query<{ total: string }>(countSql, params),
      client.query<{ domain: string; category: string; style: string; source_type: string; cnt: number }>(
        facetSql, [PUBLIC_STATUSES],
      ),
    ]);

    // Build facet maps
    const facets: PatternSearchResult["facets"] = {
      domains:      {},
      categories:   {},
      styles:       {},
      source_types: {},
    };
    for (const row of facetRes.rows) {
      facets.domains[row.domain]           = (facets.domains[row.domain]           ?? 0) + row.cnt;
      facets.categories[row.category]      = (facets.categories[row.category]      ?? 0) + row.cnt;
      facets.styles[row.style]             = (facets.styles[row.style]             ?? 0) + row.cnt;
      facets.source_types[row.source_type] = (facets.source_types[row.source_type] ?? 0) + row.cnt;
    }

    return {
      patterns: mainRes.rows,
      total:    parseInt(countRes.rows[0]?.total ?? "0", 10),
      facets,
    };
  } finally {
    client.release();
  }
}

// ── Compatibility check ───────────────────────────────────────────────────────

export interface CompatibilityCheckResult {
  compatible: boolean;
  patternId:  number;
  context:    string;
  notes:      string | null;
  min_dpi:    number | null;
  max_scale:  string | null;
}

/**
 * Check whether a specific pattern is explicitly compatible with a given context.
 * Returns { compatible: false } when no matching compat record exists.
 */
export async function checkCompatibility(
  patternId: number,
  context: string,
): Promise<CompatibilityCheckResult> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ context: string; min_dpi: number | null; max_scale: string | null; notes: string | null }>(
      `SELECT context, min_dpi, max_scale, notes
       FROM ai_platform.design_pattern_compat
       WHERE pattern_id = $1 AND context = $2`,
      [patternId, context],
    );
    if (!rows[0]) {
      return { compatible: false, patternId, context, notes: null, min_dpi: null, max_scale: null };
    }
    return {
      compatible: true,
      patternId,
      context:   rows[0].context,
      notes:     rows[0].notes,
      min_dpi:   rows[0].min_dpi,
      max_scale: rows[0].max_scale,
    };
  } finally {
    client.release();
  }
}
