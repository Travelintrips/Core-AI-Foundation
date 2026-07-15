/**
 * Migrates missing tables from dev to prod by:
 * 1. Querying information_schema on dev for column definitions
 * 2. Generating CREATE TABLE IF NOT EXISTS statements
 * 3. Applying them to prod
 *
 * Run: npx tsx src/scripts/migrateSchemaToProd.ts
 */
import { Pool } from "@workspace/db/node_modules/pg";

const devPool = new Pool({
  connectionString: process.env.SUPABASE_DEV_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  options: "-c search_path=ai_platform,public",
});

const prodPool = new Pool({
  connectionString: process.env.SUPABASE_PROD_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  options: "-c search_path=ai_platform,public",
});
