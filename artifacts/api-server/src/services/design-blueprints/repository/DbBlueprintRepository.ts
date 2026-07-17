/**
 * DbBlueprintRepository — PRODUCTION implementation of IBlueprintRepository.
 *
 * Reads and writes ai_platform.ai_design_blueprints (defined in
 * integration/migrations/team-07.sql — applied by Team 24).
 *
 * Uses `db.execute(sql\`...\`)` from @workspace/db (Drizzle raw SQL) and
 * the ai_platform schema (search_path is set per-query via fully-qualified table names).
 *
 * Read operations: if the table does not yet exist (migration not applied),
 *   returns empty results so built-in blueprints remain available.
 * Write operations: propagate errors so callers surface a 500 rather than
 *   silently losing data. NEVER falls back to in-memory.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Blueprint, BlueprintStatus } from "../types.js";
import type { IBlueprintRepository, CustomBlueprintFilter } from "./IBlueprintRepository.js";

// ── Row ↔ Blueprint mapping ───────────────────────────────────────────────────

interface DbRow {
  public_id: string;
  slug: string;
  schema_version: string;
  domain: string;
  name: string;
  description: string;
  version: string;
  status: string;
  dimensions_json: unknown;
  zones_json: unknown;
  slots_json: unknown;
  constraints_json: unknown;
  components_json: unknown;
  required_data_json: unknown;
  outputs_json: unknown;
  industry_tags: string[];
  style_tags: string[];
  created_at: string | Date;
  updated_at: string | Date;
}

function rowToBlueprint(row: DbRow): Blueprint {
  return {
    id:                  row.public_id,
    slug:                row.slug,
    schemaVersion:       row.schema_version as Blueprint["schemaVersion"],
    domain:              row.domain as Blueprint["domain"],
    name:                row.name,
    description:         row.description,
    version:             row.version,
    status:              row.status as Blueprint["status"],
    dimensions:          row.dimensions_json as Blueprint["dimensions"],
    zones:               (row.zones_json as Blueprint["zones"]) ?? [],
    slots:               (row.slots_json as Blueprint["slots"]) ?? [],
    constraints:         (row.constraints_json as Blueprint["constraints"]) ?? {},
    supportedComponents: (row.components_json as Blueprint["supportedComponents"]) ?? [],
    requiredData:        (row.required_data_json as Blueprint["requiredData"]) ?? [],
    outputCapabilities:  (row.outputs_json as Blueprint["outputCapabilities"]) ?? [],
    industryTags:        row.industry_tags ?? [],
    styleTags:           row.style_tags ?? [],
    createdAt:           new Date(row.created_at).toISOString(),
    updatedAt:           new Date(row.updated_at).toISOString(),
  };
}

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * Returns true if the error indicates the table does not yet exist
 * (i.e. the migration draft has not been applied yet).
 */
function isTableMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("relation") && msg.includes("does not exist");
}

// ── Repository ────────────────────────────────────────────────────────────────

export class DbBlueprintRepository implements IBlueprintRepository {
  async findById(id: string): Promise<Blueprint | null> {
    try {
      const result = await db.execute(sql`
        SELECT *
        FROM ai_platform.ai_design_blueprints
        WHERE public_id = ${id}
          AND deleted_at IS NULL
        LIMIT 1
      `);
      const row = rows<DbRow>(result)[0];
      return row ? rowToBlueprint(row) : null;
    } catch (err) {
      if (isTableMissingError(err)) return null;
      throw err;
    }
  }

  async findBySlug(slug: string): Promise<Blueprint | null> {
    try {
      const result = await db.execute(sql`
        SELECT *
        FROM ai_platform.ai_design_blueprints
        WHERE slug = ${slug}
          AND deleted_at IS NULL
        LIMIT 1
      `);
      const row = rows<DbRow>(result)[0];
      return row ? rowToBlueprint(row) : null;
    } catch (err) {
      if (isTableMissingError(err)) return null;
      throw err;
    }
  }

  async findAll(filter: CustomBlueprintFilter): Promise<{ rows: Blueprint[]; total: number }> {
    try {
      const limit  = filter.limit  ?? 100;
      const offset = filter.offset ?? 0;

      // Build WHERE clauses dynamically using safe parameterisation.
      // Drizzle sql`` handles escaping; we accumulate conditions as sql fragments.
      const conditions: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];
      if (filter.domain)      conditions.push(sql`domain = ${filter.domain}`);
      if (filter.status)      conditions.push(sql`status = ${filter.status}`);
      if (filter.industryTag) conditions.push(sql`industry_tags @> ARRAY[${filter.industryTag}]::text[]`);
      if (filter.styleTag)    conditions.push(sql`style_tags    @> ARRAY[${filter.styleTag}]::text[]`);

      const whereClause = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

      const [dataResult, countResult] = await Promise.all([
        db.execute(sql`
          SELECT *
          FROM ai_platform.ai_design_blueprints
          WHERE ${whereClause}
          ORDER BY created_at ASC
          LIMIT ${limit} OFFSET ${offset}
        `),
        db.execute(sql`
          SELECT count(*)::int AS total
          FROM ai_platform.ai_design_blueprints
          WHERE ${whereClause}
        `),
      ]);

      const blueprints = rows<DbRow>(dataResult).map(rowToBlueprint);
      const total = (rows<{ total: string }>(countResult)[0]?.total ?? 0);
      return { rows: blueprints, total: Number(total) };
    } catch (err) {
      if (isTableMissingError(err)) return { rows: [], total: 0 };
      throw err;
    }
  }

  async create(blueprint: Blueprint): Promise<Blueprint> {
    // Write operations MUST fail if the table is missing — never silently drop data.
    await db.execute(sql`
      INSERT INTO ai_platform.ai_design_blueprints (
        public_id, slug, schema_version, domain, name, description, version, status,
        dimensions_json, zones_json, slots_json, constraints_json,
        components_json, required_data_json, outputs_json,
        industry_tags, style_tags, created_at, updated_at
      ) VALUES (
        ${blueprint.id},
        ${blueprint.slug},
        ${blueprint.schemaVersion},
        ${blueprint.domain},
        ${blueprint.name},
        ${blueprint.description},
        ${blueprint.version},
        ${blueprint.status},
        ${JSON.stringify(blueprint.dimensions)}::jsonb,
        ${JSON.stringify(blueprint.zones)}::jsonb,
        ${JSON.stringify(blueprint.slots)}::jsonb,
        ${JSON.stringify(blueprint.constraints)}::jsonb,
        ${JSON.stringify(blueprint.supportedComponents)}::jsonb,
        ${JSON.stringify(blueprint.requiredData)}::jsonb,
        ${JSON.stringify(blueprint.outputCapabilities)}::jsonb,
        ${blueprint.industryTags}::text[],
        ${blueprint.styleTags}::text[],
        ${blueprint.createdAt}::timestamptz,
        ${blueprint.updatedAt}::timestamptz
      )
    `);
    return blueprint;
  }

  async update(id: string, updates: Partial<Blueprint>): Promise<Blueprint | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const merged: Blueprint = {
      ...existing,
      ...updates,
      id,
      slug:      existing.slug,   // slug is immutable after creation
      updatedAt: new Date().toISOString(),
    };

    await db.execute(sql`
      UPDATE ai_platform.ai_design_blueprints SET
        name               = ${merged.name},
        description        = ${merged.description},
        version            = ${merged.version},
        status             = ${merged.status},
        dimensions_json    = ${JSON.stringify(merged.dimensions)}::jsonb,
        zones_json         = ${JSON.stringify(merged.zones)}::jsonb,
        slots_json         = ${JSON.stringify(merged.slots)}::jsonb,
        constraints_json   = ${JSON.stringify(merged.constraints)}::jsonb,
        components_json    = ${JSON.stringify(merged.supportedComponents)}::jsonb,
        required_data_json = ${JSON.stringify(merged.requiredData)}::jsonb,
        outputs_json       = ${JSON.stringify(merged.outputCapabilities)}::jsonb,
        industry_tags      = ${merged.industryTags}::text[],
        style_tags         = ${merged.styleTags}::text[],
        updated_at         = ${merged.updatedAt}::timestamptz
      WHERE public_id = ${id} AND deleted_at IS NULL
    `);
    return merged;
  }

  async setStatus(id: string, status: BlueprintStatus): Promise<Blueprint | null> {
    const now = new Date().toISOString();
    const result = await db.execute(sql`
      UPDATE ai_platform.ai_design_blueprints
      SET status = ${status}, updated_at = ${now}::timestamptz
      WHERE public_id = ${id} AND deleted_at IS NULL
      RETURNING *
    `);
    const row = rows<DbRow>(result)[0];
    return row ? rowToBlueprint(row) : null;
  }
}
