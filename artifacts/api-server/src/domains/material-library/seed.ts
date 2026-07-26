/**
 * seed.ts — Idempotent seed for the Material Library.
 *
 * Upserts 13 categories + 500+ materials using ON CONFLICT DO UPDATE.
 * Safe to run multiple times; does not delete existing data.
 */

import { db } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { upsertCategory, upsertMaterial, countMaterials } from "./materialLibraryRepository.js";
import { DEFAULT_CATEGORIES } from "@workspace/db/schema";
import { ALL_MATERIALS } from "./seedData.js";

export async function seedMaterialLibrary(): Promise<{
  categories: number;
  materials: number;
  total: number;
}> {
  let categoriesSeeded = 0;
  let materialsSeeded = 0;

  // ── Categories ──────────────────────────────────────────────────────────────
  for (const cat of DEFAULT_CATEGORIES) {
    await upsertCategory(cat);
    categoriesSeeded++;
  }

  // ── Materials ───────────────────────────────────────────────────────────────
  for (const m of ALL_MATERIALS) {
    await upsertMaterial({
      materialCode:   m.materialCode,
      name:           m.name,
      slug:           m.slug,
      category:       m.category,
      subcategory:    m.subcategory,
      brand:          m.brand,
      materialType:   m.materialType,
      color:          m.color,
      finish:         m.finish,
      texture:        m.texture,
      pattern:        m.pattern,
      description:    m.description,
      priceTier:      m.priceTier,
      thumbnailUrl:   null,
      previewImages:  null,
      technicalData:  null,
      searchKeywords: m.searchKeywords,
      status:         "active",
    });
    materialsSeeded++;
  }

  const total = await countMaterials();

  logger.info({
    domain: "material-library-seed",
    categoriesSeeded,
    materialsSeeded,
    totalInDb: total,
  }, "Material library seed complete");

  return { categories: categoriesSeeded, materials: materialsSeeded, total };
}

const SEED_BASELINE = 500; // minimum expected material count after a full seed

/**
 * seedMaterialLibraryIfEmpty — only runs the full seed when the catalog is
 * empty or below the expected baseline. Avoids 500+ upserts on every boot.
 *
 * The explicit POST /material-library/seed endpoint (admin-only) always runs
 * the full upsert, so new materials added to seedData.ts can be pushed to any
 * existing installation without restarting.
 */
export async function seedMaterialLibraryIfEmpty(): Promise<void> {
  const current = await countMaterials();
  if (current >= SEED_BASELINE) {
    logger.info(
      { domain: "material-library-seed", currentCount: current, baseline: SEED_BASELINE },
      "Material library already seeded — skipping startup seed",
    );
    return;
  }
  logger.info(
    { domain: "material-library-seed", currentCount: current, baseline: SEED_BASELINE },
    "Material library below baseline — seeding now",
  );
  await seedMaterialLibrary();
}

/**
 * ensureMaterialLibraryTables — run DDL idempotently at startup.
 * This prevents the service from crashing if the tables don't exist yet.
 */
export async function ensureMaterialLibraryTables(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_platform.material_categories (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      icon          TEXT NOT NULL DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_platform.materials (
      id               SERIAL PRIMARY KEY,
      material_code    TEXT NOT NULL UNIQUE,
      name             TEXT NOT NULL,
      slug             TEXT NOT NULL UNIQUE,
      category         TEXT NOT NULL,
      subcategory      TEXT,
      brand            TEXT,
      material_type    TEXT,
      color            TEXT,
      finish           TEXT,
      texture          TEXT,
      pattern          TEXT,
      description      TEXT,
      price_tier       TEXT NOT NULL DEFAULT 'Standard',
      thumbnail_url    TEXT,
      preview_images   JSONB,
      technical_data   JSONB,
      search_keywords  JSONB,
      status           TEXT NOT NULL DEFAULT 'active',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_materials_category   ON ai_platform.materials (category);
    CREATE INDEX IF NOT EXISTS idx_materials_brand      ON ai_platform.materials (brand);
    CREATE INDEX IF NOT EXISTS idx_materials_price_tier ON ai_platform.materials (price_tier);
    CREATE INDEX IF NOT EXISTS idx_materials_status     ON ai_platform.materials (status);
    CREATE INDEX IF NOT EXISTS idx_materials_finish     ON ai_platform.materials (finish);
    CREATE INDEX IF NOT EXISTS idx_materials_color      ON ai_platform.materials (color);
    CREATE INDEX IF NOT EXISTS idx_materials_name_lower ON ai_platform.materials (LOWER(name));
  `);
}
