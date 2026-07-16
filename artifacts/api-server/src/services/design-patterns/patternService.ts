/**
 * patternService.ts — Team 09: Pattern, Motif, Texture & Decorative Asset Library
 *
 * Core CRUD and lifecycle management for design_patterns, design_pattern_variants,
 * and design_pattern_compat tables (defined in integration/migrations/team-09.sql).
 *
 * Uses raw pool queries — Drizzle schema integration is deferred to Team 24.
 */

import { pool } from "@workspace/db";
import { z } from "zod/v4";

// ── Domain enums ──────────────────────────────────────────────────────────────

export const PATTERN_DOMAINS = [
  "geometric", "corporate", "luxury", "marble", "abstract",
  "wave", "floral", "leaf", "batik-inspired", "textile",
  "interior", "wood", "stone", "metal", "fabric", "packaging",
] as const;

export const PATTERN_CATEGORIES = ["pattern", "motif", "texture", "decoration"] as const;
export const REPEAT_BEHAVIORS   = ["tile", "half-drop", "mirror", "brick", "no-repeat"] as const;
export const SCALE_VALUES       = ["xs", "sm", "md", "lg", "xl", "full-bleed"] as const;
export const SOURCE_TYPES       = ["original", "licensed", "public-domain", "creative-commons"] as const;
export const PATTERN_STATUSES   = ["active", "draft", "archived"] as const;

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const CreatePatternSchema = z.object({
  slug:              z.string().min(1).max(120).regex(/^[a-z0-9-]+$/, "slug must be lowercase kebab-case"),
  name:              z.string().min(1).max(200),
  category:          z.enum(PATTERN_CATEGORIES),
  domain:            z.enum(PATTERN_DOMAINS),
  style:             z.string().min(1).max(80).default("modern"),
  description:       z.string().max(2000).optional(),
  repeat_behavior:   z.enum(REPEAT_BEHAVIORS).default("tile"),
  scale:             z.enum(SCALE_VALUES).default("md"),
  colorizable:       z.boolean().default(true),
  color_palette:     z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "must be hex color")).default([]),
  preview_url:       z.string().url().optional(),
  preview_thumb_url: z.string().url().optional(),
  source_type:       z.enum(SOURCE_TYPES).default("original"),
  license:           z.string().max(200).optional(),
  source_attribution:z.string().max(500).optional(),
  cultural_origin:   z.string().max(200).optional(),
  cultural_notes:    z.string().max(1000).optional(),
  compatibility:     z.array(z.string()).default([]),
  tags:              z.array(z.string().max(60)).default([]),
  version:           z.string().regex(/^\d+\.\d+\.\d+$/, "semver required").default("1.0.0"),
  status:            z.enum(PATTERN_STATUSES).default("active"),
  metadata:          z.record(z.string(), z.unknown()).default({}),
});

export const UpdatePatternSchema = CreatePatternSchema.partial().omit({ slug: true });

export const CreateVariantSchema = z.object({
  slug:              z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  name:              z.string().min(1).max(200),
  color_palette:     z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).default([]),
  scale:             z.enum(SCALE_VALUES).default("md"),
  preview_url:       z.string().url().optional(),
  preview_thumb_url: z.string().url().optional(),
  status:            z.enum(PATTERN_STATUSES).default("active"),
  metadata:          z.record(z.string(), z.unknown()).default({}),
});

export const AddCompatSchema = z.object({
  context:   z.string().min(1).max(80),
  min_dpi:   z.number().int().positive().optional(),
  max_scale: z.enum(SCALE_VALUES).optional(),
  notes:     z.string().max(500).optional(),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreatePatternInput = z.infer<typeof CreatePatternSchema>;
export type UpdatePatternInput = z.infer<typeof UpdatePatternSchema>;
export type CreateVariantInput = z.infer<typeof CreateVariantSchema>;
export type AddCompatInput     = z.infer<typeof AddCompatSchema>;

export interface DesignPattern {
  id:                 number;
  slug:               string;
  name:               string;
  category:           string;
  domain:             string;
  style:              string;
  description:        string | null;
  repeat_behavior:    string;
  scale:              string;
  colorizable:        boolean;
  color_palette:      string[];
  preview_url:        string | null;
  preview_thumb_url:  string | null;
  source_type:        string;
  license:            string | null;
  source_attribution: string | null;
  cultural_origin:    string | null;
  cultural_notes:     string | null;
  compatibility:      string[];
  tags:               string[];
  version:            string;
  status:             string;
  created_by:         string | null;
  metadata:           Record<string, unknown>;
  created_at:         string;
  updated_at:         string;
}

export interface DesignPatternVariant {
  id:                number;
  pattern_id:        number;
  slug:              string;
  name:              string;
  color_palette:     string[];
  scale:             string;
  preview_url:       string | null;
  preview_thumb_url: string | null;
  status:            string;
  metadata:          Record<string, unknown>;
  created_at:        string;
  updated_at:        string;
}

export interface DesignPatternCompat {
  id:         number;
  pattern_id: number;
  context:    string;
  min_dpi:    number | null;
  max_scale:  string | null;
  notes:      string | null;
  created_at: string;
}

// ── Licensing guard ───────────────────────────────────────────────────────────

/**
 * Validates that the pattern submission does not bypass licensing rules.
 * - Non-original patterns require a license field.
 * - Batik-inspired patterns require cultural_origin to be set.
 * - No trademarks / brand names in slug or name (basic heuristic list).
 */
export function assertLicensingCompliance(input: CreatePatternInput | UpdatePatternInput): void {
  const isBatik = "domain" in input && input.domain === "batik-inspired";
  const sourceType = "source_type" in input ? input.source_type : undefined;

  if (sourceType && sourceType !== "original" && !input.license) {
    throw new LicensingError(
      `Patterns with source_type "${sourceType}" must include a license identifier.`,
    );
  }

  if (isBatik && !input.cultural_origin) {
    throw new LicensingError(
      "batik-inspired patterns must include cultural_origin (e.g. 'Central Java, Indonesia').",
    );
  }

  // Rudimentary trademark word list — extend as needed
  const BLOCKED_TERMS = ["louis vuitton", "lv", "gucci", "hermes", "hermès", "chanel", "burberry",
                         "prada", "versace", "fendi", "dior", "balenciaga", "supreme"];
  const lower = ((input.name ?? "") + " " + ((input as CreatePatternInput).slug ?? "")).toLowerCase();
  for (const term of BLOCKED_TERMS) {
    if (lower.includes(term)) {
      throw new LicensingError(
        `Pattern name/slug contains a potentially trademarked term: "${term}". ` +
        "Remove brand references or obtain a valid license before submitting.",
      );
    }
  }
}

export class LicensingError extends Error {
  readonly code = "LICENSING_VIOLATION";
  constructor(message: string) { super(message); this.name = "LicensingError"; }
}

export class PatternNotFoundError extends Error {
  readonly code = "PATTERN_NOT_FOUND";
  constructor(id: string | number) { super(`Pattern not found: ${id}`); this.name = "PatternNotFoundError"; }
}

// ── Service functions ─────────────────────────────────────────────────────────

/** Create a new design pattern entry */
export async function createPattern(
  input: CreatePatternInput,
  createdBy?: string,
): Promise<DesignPattern> {
  assertLicensingCompliance(input);
  const validated = CreatePatternSchema.parse(input);

  const client = await pool.connect();
  try {
    const { rows } = await client.query<DesignPattern>(
      `INSERT INTO ai_platform.design_patterns
        (slug, name, category, domain, style, description,
         repeat_behavior, scale, colorizable, color_palette,
         preview_url, preview_thumb_url,
         source_type, license, source_attribution,
         cultural_origin, cultural_notes,
         compatibility, tags, version, status, created_by, metadata)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        validated.slug, validated.name, validated.category, validated.domain,
        validated.style, validated.description ?? null,
        validated.repeat_behavior, validated.scale, validated.colorizable,
        JSON.stringify(validated.color_palette),
        validated.preview_url ?? null, validated.preview_thumb_url ?? null,
        validated.source_type, validated.license ?? null,
        validated.source_attribution ?? null,
        validated.cultural_origin ?? null, validated.cultural_notes ?? null,
        JSON.stringify(validated.compatibility),
        validated.tags, validated.version, validated.status,
        createdBy ?? null, JSON.stringify(validated.metadata),
      ],
    );
    return rows[0]!;
  } finally {
    client.release();
  }
}

/** Get a single pattern by id or slug */
export async function getPattern(idOrSlug: number | string): Promise<DesignPattern> {
  const client = await pool.connect();
  try {
    const isId = typeof idOrSlug === "number" || /^\d+$/.test(String(idOrSlug));
    const { rows } = await client.query<DesignPattern>(
      `SELECT * FROM ai_platform.design_patterns WHERE ${isId ? "id" : "slug"} = $1`,
      [idOrSlug],
    );
    if (!rows[0]) throw new PatternNotFoundError(idOrSlug);
    return rows[0];
  } finally {
    client.release();
  }
}

/** List patterns with optional filters */
export async function listPatterns(opts: {
  domain?:   string;
  category?: string;
  status?:   string;
  limit?:    number;
  offset?:   number;
}): Promise<{ patterns: DesignPattern[]; total: number }> {
  const { domain, category, status = "active", limit = 50, offset = 0 } = opts;
  const conditions: string[] = [];
  const params: unknown[]    = [];
  let   idx = 1;

  if (status)   { conditions.push(`status = $${idx++}`);   params.push(status); }
  if (domain)   { conditions.push(`domain = $${idx++}`);   params.push(domain); }
  if (category) { conditions.push(`category = $${idx++}`); params.push(category); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const client = await pool.connect();
  try {
    const [{ rows }, countResult] = await Promise.all([
      client.query<DesignPattern>(
        `SELECT * FROM ai_platform.design_patterns ${where}
         ORDER BY name ASC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      ),
      client.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM ai_platform.design_patterns ${where}`,
        params,
      ),
    ]);
    return { patterns: rows, total: parseInt(countResult.rows[0]?.total ?? "0", 10) };
  } finally {
    client.release();
  }
}

/** Update a pattern by id */
export async function updatePattern(
  id: number,
  input: UpdatePatternInput,
): Promise<DesignPattern> {
  assertLicensingCompliance(input);
  const validated = UpdatePatternSchema.parse(input);
  const fields    = Object.entries(validated).filter(([, v]) => v !== undefined);
  if (!fields.length) throw new Error("No fields to update");

  const setClauses = fields.map(([key], i) => `${key} = $${i + 2}`).join(", ");
  const values     = fields.map(([key, v]) => {
    if (["color_palette", "compatibility", "metadata"].includes(key)) return JSON.stringify(v);
    return v;
  });

  const client = await pool.connect();
  try {
    const { rows } = await client.query<DesignPattern>(
      `UPDATE ai_platform.design_patterns
       SET ${setClauses}, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, ...values],
    );
    if (!rows[0]) throw new PatternNotFoundError(id);
    return rows[0];
  } finally {
    client.release();
  }
}

/** Archive a pattern (soft delete) */
export async function archivePattern(id: number): Promise<void> {
  const client = await pool.connect();
  try {
    const { rowCount } = await client.query(
      `UPDATE ai_platform.design_patterns SET status = 'archived', updated_at = NOW() WHERE id = $1`,
      [id],
    );
    if (!rowCount) throw new PatternNotFoundError(id);
  } finally {
    client.release();
  }
}

// ── Variants ──────────────────────────────────────────────────────────────────

export async function createVariant(
  patternId: number,
  input: CreateVariantInput,
): Promise<DesignPatternVariant> {
  const validated = CreateVariantSchema.parse(input);
  const client = await pool.connect();
  try {
    const { rows } = await client.query<DesignPatternVariant>(
      `INSERT INTO ai_platform.design_pattern_variants
        (pattern_id, slug, name, color_palette, scale, preview_url, preview_thumb_url, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        patternId, validated.slug, validated.name,
        JSON.stringify(validated.color_palette), validated.scale,
        validated.preview_url ?? null, validated.preview_thumb_url ?? null,
        validated.status, JSON.stringify(validated.metadata),
      ],
    );
    return rows[0]!;
  } finally {
    client.release();
  }
}

export async function listVariants(patternId: number): Promise<DesignPatternVariant[]> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<DesignPatternVariant>(
      `SELECT * FROM ai_platform.design_pattern_variants WHERE pattern_id = $1 ORDER BY name ASC`,
      [patternId],
    );
    return rows;
  } finally {
    client.release();
  }
}

// ── Compatibility records ─────────────────────────────────────────────────────

export async function addCompat(
  patternId: number,
  input: AddCompatInput,
): Promise<DesignPatternCompat> {
  const validated = AddCompatSchema.parse(input);
  const client = await pool.connect();
  try {
    const { rows } = await client.query<DesignPatternCompat>(
      `INSERT INTO ai_platform.design_pattern_compat
        (pattern_id, context, min_dpi, max_scale, notes)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [patternId, validated.context, validated.min_dpi ?? null, validated.max_scale ?? null, validated.notes ?? null],
    );
    return rows[0]!;
  } finally {
    client.release();
  }
}

export async function listCompat(patternId: number): Promise<DesignPatternCompat[]> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<DesignPatternCompat>(
      `SELECT * FROM ai_platform.design_pattern_compat WHERE pattern_id = $1 ORDER BY context ASC`,
      [patternId],
    );
    return rows;
  } finally {
    client.release();
  }
}
