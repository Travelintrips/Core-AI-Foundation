/**
 * V4.7 — Creative Marketplace migration
 * Run: pnpm --filter @workspace/api-server exec tsx --tsconfig tsconfig.json src/migrate-v47.ts
 *
 * Hand-written DDL (never drizzle-kit push) per project convention.
 * Idempotent — uses IF NOT EXISTS throughout.
 */

import { pool } from "@workspace/db";

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── marketplace_creators ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.marketplace_creators (
        id              SERIAL PRIMARY KEY,
        creator_code    TEXT NOT NULL UNIQUE,
        display_name    TEXT NOT NULL,
        bio             TEXT,
        avatar_url      TEXT,
        website_url     TEXT,
        email           TEXT,
        is_verified     BOOLEAN NOT NULL DEFAULT false,
        is_active       BOOLEAN NOT NULL DEFAULT true,
        total_assets    INTEGER NOT NULL DEFAULT 0,
        total_downloads INTEGER NOT NULL DEFAULT 0,
        avg_rating      NUMERIC(3,2) NOT NULL DEFAULT 0,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── marketplace_assets ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.marketplace_assets (
        id              SERIAL PRIMARY KEY,
        asset_code      TEXT NOT NULL UNIQUE,
        asset_type      TEXT NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT,
        category        TEXT NOT NULL,
        tags            JSONB NOT NULL DEFAULT '[]',
        creator_id      INTEGER REFERENCES ai_platform.marketplace_creators(id) ON DELETE SET NULL,
        price_type      TEXT NOT NULL DEFAULT 'free',
        price_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency        TEXT NOT NULL DEFAULT 'IDR',
        file_url        TEXT,
        preview_urls    JSONB NOT NULL DEFAULT '[]',
        thumbnail_url   TEXT,
        file_size_bytes BIGINT,
        file_format     TEXT,
        license         TEXT NOT NULL DEFAULT 'standard',
        is_featured     BOOLEAN NOT NULL DEFAULT false,
        is_active       BOOLEAN NOT NULL DEFAULT true,
        downloads_count INTEGER NOT NULL DEFAULT 0,
        views_count     INTEGER NOT NULL DEFAULT 0,
        favorites_count INTEGER NOT NULL DEFAULT 0,
        avg_rating      NUMERIC(3,2) NOT NULL DEFAULT 0,
        ratings_count   INTEGER NOT NULL DEFAULT 0,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── marketplace_favorites ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.marketplace_favorites (
        id             SERIAL PRIMARY KEY,
        customer_email TEXT NOT NULL,
        item_type      TEXT NOT NULL,
        item_id        INTEGER NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (customer_email, item_type, item_id)
      );
    `);

    // ── marketplace_ratings ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.marketplace_ratings (
        id             SERIAL PRIMARY KEY,
        customer_email TEXT NOT NULL,
        item_type      TEXT NOT NULL,
        item_id        INTEGER NOT NULL,
        rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        review         TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (customer_email, item_type, item_id)
      );
    `);

    // ── marketplace_downloads ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.marketplace_downloads (
        id             SERIAL PRIMARY KEY,
        customer_email TEXT,
        item_type      TEXT NOT NULL,
        item_id        INTEGER NOT NULL,
        ip_address     TEXT,
        metadata       JSONB DEFAULT '{}',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── indexes ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mp_assets_type     ON ai_platform.marketplace_assets (asset_type);
      CREATE INDEX IF NOT EXISTS idx_mp_assets_category ON ai_platform.marketplace_assets (category);
      CREATE INDEX IF NOT EXISTS idx_mp_assets_featured ON ai_platform.marketplace_assets (is_featured) WHERE is_featured = true;
      CREATE INDEX IF NOT EXISTS idx_mp_assets_active   ON ai_platform.marketplace_assets (is_active) WHERE is_active = true;
      CREATE INDEX IF NOT EXISTS idx_mp_assets_creator  ON ai_platform.marketplace_assets (creator_id);
      CREATE INDEX IF NOT EXISTS idx_mp_favs_email      ON ai_platform.marketplace_favorites (customer_email);
      CREATE INDEX IF NOT EXISTS idx_mp_downloads_item  ON ai_platform.marketplace_downloads (item_type, item_id);
      CREATE INDEX IF NOT EXISTS idx_mp_ratings_item    ON ai_platform.marketplace_ratings (item_type, item_id);
    `);

    await client.query("COMMIT");
    console.log("✅ V4.7 marketplace migration complete");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
