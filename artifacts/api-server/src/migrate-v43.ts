/**
 * V4.3 migration — ai_templates + ai_template_analytics
 * Hand-written DDL (avoids drizzle-kit dropping the ai_platform schema).
 * Run: pnpm --filter @workspace/api-server run migrate:v43
 */
import { pool } from "@workspace/db";

async function run() {
  const client = await pool.connect();
  try {
    await client.query("SET search_path = ai_platform, public");

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.ai_templates (
        id                 SERIAL PRIMARY KEY,
        template_code      TEXT NOT NULL UNIQUE,
        name               TEXT NOT NULL,
        description        TEXT,
        category           TEXT NOT NULL,
        style              TEXT NOT NULL,
        industry           TEXT,
        color_theme        JSONB,
        typography         JSONB,
        layout             TEXT,
        supported_packages JSONB,
        brand_dna_tags     JSONB,
        preview_images     JSONB,
        pdf_preview_url    TEXT,
        ppt_preview_url    TEXT,
        cover_image        TEXT,
        editable           BOOLEAN NOT NULL DEFAULT TRUE,
        is_premium         BOOLEAN NOT NULL DEFAULT FALSE,
        version            TEXT NOT NULL DEFAULT '1.0',
        status             TEXT NOT NULL DEFAULT 'published',
        featured           BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order         INTEGER NOT NULL DEFAULT 0,
        price_points       JSONB,
        views              INTEGER NOT NULL DEFAULT 0,
        selections         INTEGER NOT NULL DEFAULT 0,
        previews_generated INTEGER NOT NULL DEFAULT 0,
        conversions        INTEGER NOT NULL DEFAULT 0,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_templates_category ON ai_platform.ai_templates(category);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_templates_industry ON ai_platform.ai_templates(industry);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_templates_status  ON ai_platform.ai_templates(status);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_templates_featured ON ai_platform.ai_templates(featured) WHERE featured = TRUE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.ai_template_analytics (
        id          SERIAL PRIMARY KEY,
        template_id INTEGER NOT NULL REFERENCES ai_platform.ai_templates(id) ON DELETE CASCADE,
        event_type  TEXT NOT NULL,
        client_id   TEXT,
        session_id  TEXT,
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_template_analytics_template_id
        ON ai_platform.ai_template_analytics(template_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_template_analytics_event_type
        ON ai_platform.ai_template_analytics(event_type);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_template_analytics_client_id
        ON ai_platform.ai_template_analytics(client_id) WHERE client_id IS NOT NULL;
    `);

    console.log("✅ V4.3 migration complete: ai_templates + ai_template_analytics created");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
