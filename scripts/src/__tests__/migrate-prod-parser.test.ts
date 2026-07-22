/**
 * Regression tests for the SQL statement parser used in migrate-prod.ts.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts exec tsx src/__tests__/migrate-prod-parser.test.ts
 *
 * Uses only Node built-ins (no vitest dependency required in the scripts package).
 */
import assert from "node:assert/strict";

// ── Copy of the production function (kept in sync with migrate-prod.ts) ──────

/**
 * Strip standalone SELECT statements from a SQL script — multiline safe.
 *
 * The naive line-filter approach only removes the first line of a
 * multi-line SELECT, leaving orphaned FROM / WHERE / ORDER BY clauses
 * that trigger "syntax error at or near FROM".
 *
 * This implementation splits on statement-terminator semicolons instead,
 * so an entire multi-line SELECT block is removed in one step.
 *
 * Scope: designed for the controlled DDL scripts in this runner
 * (no PL/pgSQL dollar-quoting, no semicolons inside string literals).
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

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  console.log(`  ✓  ${name}`);
  passed++;
}

// ── Test suite ────────────────────────────────────────────────────────────────

console.log("\nmigrate-prod SQL parser — regression tests\n");

// ── 1. Multiline SELECT is fully removed (the original bug) ──────────────────
test("multiline SELECT stripped without leaving orphan FROM", () => {
  const sql = `
SET search_path TO ai_platform, public;

ALTER TABLE ai_platform.ai_installed_packages
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_installed_packages_deleted_at
  ON ai_platform.ai_installed_packages (deleted_at)
  WHERE deleted_at IS NOT NULL;

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ai_platform'
  AND column_name IN ('deleted_at', 'archived_at')
  AND table_name IN ('ai_installed_packages', 'ai_service_requests', 'creative_projects')
ORDER BY table_name, column_name;
`.trim();

  const result = stripSelectStatements(sql);

  assert.ok(
    !result.includes("FROM information_schema"),
    "orphaned FROM clause must not appear in output",
  );
  assert.ok(
    !result.includes("ORDER BY table_name"),
    "orphaned ORDER BY clause must not appear in output",
  );
  assert.ok(
    !result.includes("WHERE table_schema"),
    "orphaned WHERE clause must not appear in output",
  );
  assert.ok(
    result.includes("ADD COLUMN IF NOT EXISTS deleted_at"),
    "ALTER TABLE ADD COLUMN must be preserved",
  );
  assert.ok(
    result.includes("CREATE INDEX IF NOT EXISTS"),
    "CREATE INDEX must be preserved",
  );
});

// ── 2. Single-line SELECT stripped ──────────────────────────────────────────
test("single-line SELECT stripped", () => {
  const sql = `CREATE TABLE IF NOT EXISTS foo (id SERIAL PRIMARY KEY);
SELECT count(*) FROM foo;`;

  const result = stripSelectStatements(sql);
  assert.ok(!result.includes("SELECT"), "SELECT line must be gone");
  assert.ok(result.includes("CREATE TABLE IF NOT EXISTS foo"), "CREATE TABLE preserved");
});

// ── 3. ALTER TABLE without any SELECT preserved verbatim ────────────────────
test("ALTER TABLE without SELECT preserved intact", () => {
  const sql =
    "ALTER TABLE ai_platform.t ADD COLUMN IF NOT EXISTS x TIMESTAMPTZ;";
  const result = stripSelectStatements(sql);
  assert.ok(
    result.includes("ADD COLUMN IF NOT EXISTS x TIMESTAMPTZ"),
    "ALTER TABLE content must survive unchanged",
  );
});

// ── 4. No double-semicolons or orphan punctuation in output ─────────────────
test("no double-semicolons after strip", () => {
  const sql = `
SET search_path TO ai_platform;
ALTER TABLE t ADD COLUMN IF NOT EXISTS y TEXT;
SELECT table_name FROM information_schema.tables WHERE table_schema='ai_platform';
`.trim();

  const result = stripSelectStatements(sql);
  assert.ok(!result.includes(";;"), "double-semicolons must not appear");
});

// ── 5. SELECT-less script passes through unchanged ────────────────────────────
test("script with no SELECT is unchanged", () => {
  const sql =
    "SET search_path TO ai_platform;\nCREATE TABLE IF NOT EXISTS bar (id SERIAL);";
  const result = stripSelectStatements(sql);
  assert.ok(result.includes("CREATE TABLE IF NOT EXISTS bar"), "table creation preserved");
  assert.ok(result.includes("SET search_path"), "SET search_path preserved");
});

// ── 6. Case-insensitive SELECT matching ──────────────────────────────────────
test("lowercase 'select' is also stripped", () => {
  const sql = `CREATE INDEX IF NOT EXISTS idx_x ON t(x);\nselect * from t;`;
  const result = stripSelectStatements(sql);
  assert.ok(!result.toLowerCase().includes("\nselect"), "lowercase select stripped");
  assert.ok(result.includes("CREATE INDEX"), "CREATE INDEX preserved");
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} tests passed.\n`);
