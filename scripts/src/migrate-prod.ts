/**
 * migrate-prod.ts — Automated production migration runner
 *
 * Runs ALL pending DDL migrations against the production Supabase database
 * in the correct dependency order. Every statement uses IF NOT EXISTS /
 * ADD COLUMN IF NOT EXISTS, so re-running is always safe.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run migrate:prod            # run for real
 *   pnpm --filter @workspace/scripts run migrate:prod -- --dry-run  # print SQL only
 *
 * Requirements:
 *   SUPABASE_PROD_DATABASE_URL must be set in Replit Secrets.
 */

import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../scripts/migrations");

// ── Colours ──────────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
  blue: "\x1b[34m",
};
const ok    = (s: string) => `${c.green}✓${c.reset} ${s}`;
const skip  = (s: string) => `${c.yellow}↷${c.reset} ${s}`;
const fail  = (s: string) => `${c.red}✗${c.reset} ${s}`;
const info  = (s: string) => `${c.cyan}→${c.reset} ${s}`;
const head  = (s: string) => `\n${c.bold}${c.blue}═══ ${s} ${c.reset}`;

// ── Migration steps ───────────────────────────────────────────────────────────

interface MigrationStep {
  id: string;
  description: string;
  /** Return the SQL to execute. */
  sql: () => string;
}

// Inline DDL (extracted from migrate-v4x.ts files — those call process.exit
// so cannot be imported directly)
const STEPS: MigrationStep[] = [

  // ── V4.2E: Brand DNA + Asset Intelligence ──────────────────────────────────
  {
    id: "v42e-brand-dna",
    description: "V4.2E — ai_brand_dna + ai_asset_intelligence tables",
    sql: () => `
SET search_path TO ai_platform, public;

CREATE TABLE IF NOT EXISTS ai_platform.ai_brand_dna (
  id                    SERIAL PRIMARY KEY,
  client_id             TEXT NOT NULL UNIQUE,
  brand_personality     JSONB,
  brand_voice           TEXT,
  writing_style         TEXT,
  photography_style     TEXT,
  illustration_style    TEXT,
  icon_style            TEXT,
  layout_style          TEXT,
  visual_density        TEXT,
  spacing_style         TEXT,
  detected_colors       JSONB,
  color_psychology      JSONB,
  detected_typography   JSONB,
  target_audience       JSONB,
  industry              TEXT,
  risk_profile          TEXT,
  completeness_score    INTEGER,
  consistency_score     INTEGER,
  confidence_score      NUMERIC(4,3),
  data_sources_summary  JSONB,
  analysis_version      TEXT NOT NULL DEFAULT 'v1',
  metadata              JSONB,
  analyzed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_platform.ai_asset_intelligence (
  id                  SERIAL PRIMARY KEY,
  asset_id            INTEGER NOT NULL,
  asset_source        TEXT NOT NULL,
  client_id           TEXT NOT NULL,
  detected_subjects   JSONB,
  auto_tags           JSONB,
  auto_category       TEXT,
  search_keywords     JSONB,
  suggested_usage     JSONB,
  color_palette       JSONB,
  dominant_colors     JSONB,
  perceptual_hash     TEXT,
  is_duplicate        BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_id     INTEGER,
  version_type        TEXT,
  version_chain_id    INTEGER,
  quality_score       INTEGER,
  resolution_info     JSONB,
  has_transparency    BOOLEAN,
  analysis_failed     BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason      TEXT,
  confidence_score    NUMERIC(4,3),
  metadata            JSONB,
  analyzed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_brand_dna_client_id
  ON ai_platform.ai_brand_dna(client_id);
CREATE INDEX IF NOT EXISTS idx_ai_asset_intelligence_client_id
  ON ai_platform.ai_asset_intelligence(client_id);
CREATE INDEX IF NOT EXISTS idx_ai_asset_intelligence_asset_id
  ON ai_platform.ai_asset_intelligence(asset_id, asset_source);
CREATE INDEX IF NOT EXISTS idx_ai_asset_intelligence_hash
  ON ai_platform.ai_asset_intelligence(perceptual_hash);
`,
  },

  // ── V4.3: Template Marketplace ─────────────────────────────────────────────
  {
    id: "v43-templates",
    description: "V4.3 — ai_templates + ai_template_analytics tables",
    sql: () => `
SET search_path TO ai_platform, public;

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

CREATE INDEX IF NOT EXISTS idx_ai_templates_category ON ai_platform.ai_templates(category);
CREATE INDEX IF NOT EXISTS idx_ai_templates_industry ON ai_platform.ai_templates(industry);
CREATE INDEX IF NOT EXISTS idx_ai_templates_status   ON ai_platform.ai_templates(status);
CREATE INDEX IF NOT EXISTS idx_ai_templates_featured
  ON ai_platform.ai_templates(featured) WHERE featured = TRUE;

CREATE TABLE IF NOT EXISTS ai_platform.ai_template_analytics (
  id          SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES ai_platform.ai_templates(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  client_id   TEXT,
  session_id  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_template_analytics_template_id
  ON ai_platform.ai_template_analytics(template_id);
CREATE INDEX IF NOT EXISTS idx_ai_template_analytics_event_type
  ON ai_platform.ai_template_analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_ai_template_analytics_client_id
  ON ai_platform.ai_template_analytics(client_id) WHERE client_id IS NOT NULL;
`,
  },

  // ── V4.3 Gallery: Portfolio Favorites ──────────────────────────────────────
  {
    id: "v43-portfolio-favorites",
    description: "V4.3 Gallery — ai_portfolio_favorites table",
    sql: () => `
SET search_path TO ai_platform, public;

CREATE TABLE IF NOT EXISTS ai_platform.ai_portfolio_favorites (
  id           SERIAL PRIMARY KEY,
  client_id    TEXT NOT NULL,
  portfolio_id INTEGER NOT NULL
    REFERENCES ai_platform.ai_service_portfolios(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, portfolio_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_favorites_client
  ON ai_platform.ai_portfolio_favorites (client_id);
`,
  },

  // ── V4.4: Production Pipeline ───────────────────────────────────────────────
  {
    id: "v44-production-pipelines",
    description: "V4.4 — ai_production_pipelines + ai_pipeline_stages tables",
    sql: () => `
SET search_path TO ai_platform, public;

CREATE TABLE IF NOT EXISTS ai_platform.ai_production_pipelines (
  id                SERIAL PRIMARY KEY,
  run_id            TEXT NOT NULL UNIQUE,
  project_id        INTEGER NOT NULL
    REFERENCES ai_platform.creative_projects(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending',
  current_stage     TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  error_message     TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  execution_summary JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_prod_pipelines_project_id
  ON ai_platform.ai_production_pipelines(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_prod_pipelines_status
  ON ai_platform.ai_production_pipelines(status);
CREATE INDEX IF NOT EXISTS idx_ai_prod_pipelines_run_id
  ON ai_platform.ai_production_pipelines(run_id);

CREATE TABLE IF NOT EXISTS ai_platform.ai_pipeline_stages (
  id            SERIAL PRIMARY KEY,
  run_id        INTEGER NOT NULL
    REFERENCES ai_platform.ai_production_pipelines(id) ON DELETE CASCADE,
  stage_name    TEXT NOT NULL,
  stage_order   INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  input         JSONB,
  output        JSONB,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  latency_ms    INTEGER,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  agent_slug    TEXT,
  model         TEXT,
  provider      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_pipeline_stages_run_id
  ON ai_platform.ai_pipeline_stages(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_pipeline_stages_status
  ON ai_platform.ai_pipeline_stages(status);
CREATE INDEX IF NOT EXISTS idx_ai_pipeline_stages_stage_name
  ON ai_platform.ai_pipeline_stages(stage_name);
`,
  },

  // ── P2.5 Commercial Conversion Layer (SQL file) ────────────────────────────
  {
    id: "p25-commercial-layer",
    description: "P2.5 — sales_funnel_events, promotions, coupons, referrals, affiliates, A/B tests, customer segments",
    sql: () => readSql("p25-commercial-layer.sql"),
  },

  // ── P7 Internal RBAC (SQL file) ────────────────────────────────────────────
  {
    id: "p7-internal-rbac",
    description: "P7 Internal RBAC — internal_users table + service category visibility columns",
    sql: () => readSql("p7-internal-rbac/migration.sql"),
  },

  // ── P1.1 Customer Workspace (SQL file) ─────────────────────────────────────
  {
    id: "p1-1-customer-workspace",
    description: "P1.1 Customer Workspace — ai_customer_documents, ai_customer_impersonation_tokens + indexes",
    sql: () => readSql("p1-1-customer-workspace/migration.sql"),
  },

  // ── WP04/WP05 Soft Delete (SQL file) ───────────────────────────────────────
  {
    id: "wp04-wp05-soft-delete",
    description: "WP04/WP05 — soft-delete columns (deleted_at, archived_at) on installed packages, service requests, projects",
    sql: () => readSql("wp04-wp05-soft-delete.sql"),
  },

  // ── CP Sprint Brief Guard (SQL file) ───────────────────────────────────────
  {
    id: "p-cp-brief-guard",
    description: "CP Brief Guard — brief_guard_override_* columns on ai_service_requests",
    sql: () => readSql("p-cp-sprint-brief-guard.sql"),
  },

  // ── V4.5 Design Studio (SQL file) ─────────────────────────────────────────
  {
    id: "v45-design-studio",
    description: "V4.5 — ai_design_projects + ai_design_versions tables",
    sql: () => readSql("v4.5-design-studio.sql"),
  },

  // ── Seed AI Sales Manager (SQL file) ──────────────────────────────────────
  {
    id: "seed-ai-sales-manager",
    description: "Seed — AI Sales Manager employee record (idempotent upsert)",
    sql: () => readSql("seed-ai-sales-manager.sql"),
  },

  // ── Design Template Engine — Phase 1 ──────────────────────────────────────
  {
    id: "design-template-engine-phase1",
    description: "Phase 1 — design_templates, design_template_versions, design_render_batches, design_render_items",
    sql: () => `
SET search_path TO ai_platform, public;

CREATE TABLE IF NOT EXISTS ai_platform.design_templates (
  id                    BIGSERIAL PRIMARY KEY,
  tenant_id             TEXT NOT NULL DEFAULT 'default',
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL,
  description           TEXT,
  category              TEXT,
  status                TEXT NOT NULL DEFAULT 'draft',
  active_version_id     BIGINT,
  thumbnail_url         TEXT,
  thumbnail_storage_path TEXT,
  created_by            TEXT NOT NULL DEFAULT 'system',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

-- Ensure deleted_at exists even if design_templates was created by a prior
-- migration without it (canonical Drizzle schema includes deleted_at for
-- soft-delete via softDeleteTemplate()).  ADD COLUMN IF NOT EXISTS is safe
-- to run when the column already exists.
ALTER TABLE ai_platform.design_templates
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ai_platform.design_template_versions (
  id                    BIGSERIAL PRIMARY KEY,
  tenant_id             TEXT NOT NULL DEFAULT 'default',
  template_id           BIGINT NOT NULL,
  version_number        INTEGER NOT NULL,
  schema_version        TEXT NOT NULL DEFAULT '1.0',
  template_json         JSONB NOT NULL,
  changelog             TEXT,
  created_by            TEXT NOT NULL DEFAULT 'system',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_platform.design_render_batches (
  id                    BIGSERIAL PRIMARY KEY,
  tenant_id             TEXT NOT NULL DEFAULT 'default',
  template_id           BIGINT NOT NULL,
  template_version_id   BIGINT NOT NULL,
  name                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft',
  total_items           INTEGER NOT NULL DEFAULT 0,
  queued_items          INTEGER NOT NULL DEFAULT 0,
  processing_items      INTEGER NOT NULL DEFAULT 0,
  completed_items       INTEGER NOT NULL DEFAULT 0,
  failed_items          INTEGER NOT NULL DEFAULT 0,
  requested_format      TEXT NOT NULL DEFAULT 'png',
  requested_width       INTEGER,
  requested_height      INTEGER,
  requested_by          TEXT NOT NULL DEFAULT 'system',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_platform.design_render_items (
  id                    BIGSERIAL PRIMARY KEY,
  tenant_id             TEXT NOT NULL DEFAULT 'default',
  batch_id              BIGINT NOT NULL,
  template_id           BIGINT NOT NULL,
  template_version_id   BIGINT NOT NULL,
  row_index             INTEGER NOT NULL,
  input_data            JSONB NOT NULL,
  input_hash            TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'queued',
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  output_storage_path   TEXT,
  output_url            TEXT,
  output_width          INTEGER,
  output_height         INTEGER,
  output_format         TEXT,
  output_file_size_bytes INTEGER,
  render_duration_ms    INTEGER,
  error_code            TEXT,
  error_message         TEXT,
  render_warnings       JSONB,
  queued_at             TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT drni_batch_row_uniq UNIQUE (batch_id, row_index)
);

-- Soft-delete partial index: scope active-template queries to non-deleted rows.
-- Uses (tenant_id) because 'status' may not exist on pre-migration instances
-- of design_templates; the existing idx_design_templates_tenant_status covers
-- the active-only path via its own WHERE predicate.
CREATE INDEX IF NOT EXISTS idx_design_templates_soft_delete
  ON ai_platform.design_templates (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_design_template_versions_template_id
  ON ai_platform.design_template_versions (template_id);

CREATE INDEX IF NOT EXISTS idx_design_render_batches_tenant
  ON ai_platform.design_render_batches (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_design_render_items_batch_status
  ON ai_platform.design_render_items (batch_id, status);

CREATE INDEX IF NOT EXISTS idx_design_render_items_input_hash
  ON ai_platform.design_render_items (input_hash);
`,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function readSql(relativePath: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, relativePath), "utf8");
}

/**
 * Strip standalone SELECT statements from a SQL script — multiline safe.
 *
 * The naive line-filter approach (`filter line => !line.startsWith("SELECT")`)
 * only removes the first line of a multi-line SELECT, leaving orphaned
 * FROM / WHERE / ORDER BY clauses that cause "syntax error at or near FROM".
 *
 * This function splits on statement-terminator semicolons so an entire
 * multi-line SELECT block is removed in one step.
 *
 * Scope: safe for the controlled DDL scripts in this runner
 * (no PL/pgSQL dollar-quoting, no semicolons embedded in string literals).
 */
function stripSelectStatements(sql: string): string {
  return sql
    .split(";")
    .filter(stmt => {
      const trimmed = stmt.trim();
      return trimmed.length > 0 && !/^SELECT\b/i.test(trimmed);
    })
    .map(stmt => stmt.trimEnd() + ";")
    .join("\n");
}

function banner() {
  console.log(`
${c.bold}${c.blue}╔══════════════════════════════════════════════════════╗
║       Creative AI Studio — Production Migration      ║
╚══════════════════════════════════════════════════════╝${c.reset}
`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  banner();

  // Resolve connection string
  const connString =
    process.env.SUPABASE_PROD_DATABASE_URL ||
    process.env.SUPABASE_DATABASE_URL;     // fallback alias used after re-imports

  if (isDryRun) {
    console.log(`${c.yellow}${c.bold}DRY RUN — no changes will be made to the database.${c.reset}\n`);
    for (const step of STEPS) {
      console.log(head(step.id));
      console.log(`  ${c.grey}${step.description}${c.reset}`);
      console.log(`\n${c.grey}${step.sql()}${c.reset}`);
    }
    console.log(`\n${c.yellow}${c.bold}DRY RUN complete — ${STEPS.length} migration(s) would run.${c.reset}\n`);
    process.exit(0);
  }

  if (!connString) {
    console.error(fail(
      "SUPABASE_PROD_DATABASE_URL is not set.\n" +
      "  Set it in Replit Secrets, then re-run this script."
    ));
    process.exit(1);
  }

  // Connect
  const client = new pg.Client({
    connectionString: connString,
    ssl: { rejectUnauthorized: false },
    options: "-c search_path=ai_platform,public",
  });

  console.log(info(`Connecting to production database…`));
  try {
    await client.connect();
    console.log(ok("Connected.\n"));
  } catch (err: any) {
    console.error(fail(`Cannot connect: ${err.message}`));
    process.exit(1);
  }

  // Run migrations
  const results: { id: string; status: "ok" | "error"; message?: string }[] = [];
  let errorCount = 0;

  for (const step of STEPS) {
    process.stdout.write(info(`[${step.id}] ${step.description} … `));

    let sql: string;
    try {
      sql = step.sql();
    } catch (err: any) {
      console.log(fail(`Cannot read SQL file: ${err.message}`));
      results.push({ id: step.id, status: "error", message: err.message });
      errorCount++;
      continue;
    }

    // Strip trailing SELECT sanity-check statements — multiline safe.
    // Uses statement-level splitting (on ";") instead of line-level to avoid
    // leaving orphaned FROM / WHERE / ORDER BY clauses from multiline SELECTs.
    const cleanSql = stripSelectStatements(sql);

    try {
      await client.query(cleanSql);
      console.log(ok("done"));
      results.push({ id: step.id, status: "ok" });
    } catch (err: any) {
      const msg: string = err.message ?? String(err);
      // Treat "already exists" as success — the migration is idempotent by design.
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate column") ||
        msg.includes("duplicate key value")
      ) {
        console.log(skip(`already applied (${msg.split("\n")[0]})`));
        results.push({ id: step.id, status: "ok" });
      } else {
        console.log(fail(msg.split("\n")[0]));
        results.push({ id: step.id, status: "error", message: msg });
        errorCount++;
        // Continue — don't abort on first error so the user sees all problems at once.
      }
    }
  }

  await client.end();

  // Summary
  console.log(`\n${c.bold}${c.blue}═══ Summary ═══════════════════════════════════════════${c.reset}`);
  for (const r of results) {
    const line = r.status === "ok"
      ? ok(r.id)
      : fail(`${r.id}: ${r.message?.split("\n")[0]}`);
    console.log(`  ${line}`);
  }
  console.log();

  if (errorCount === 0) {
    console.log(`${c.green}${c.bold}✅  All ${STEPS.length} migrations applied successfully.${c.reset}`);
    console.log(`\nNext step: run the seed script against production:\n`);
    console.log(`  ${c.cyan}NODE_ENV=production pnpm --filter @workspace/api-server run seed${c.reset}\n`);
  } else {
    console.log(`${c.red}${c.bold}❌  ${errorCount} migration(s) failed. Review errors above.${c.reset}\n`);
    process.exit(1);
  }
}

main();
