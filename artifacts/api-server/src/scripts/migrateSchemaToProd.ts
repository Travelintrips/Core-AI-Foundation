/**
 * Migrates missing tables from dev to prod by:
 * 1. Querying information_schema on dev for column/enum/index definitions
 * 2. Generating CREATE TABLE IF NOT EXISTS statements
 * 3. Applying them to prod
 *
 * Run: npx tsx src/scripts/migrateSchemaToProd.ts
 */
// @ts-ignore
import pgModule from "/home/runner/workspace/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js";
// @ts-ignore
const Pool = pgModule.Pool ?? pgModule.default?.Pool;

const DEV_URL =
  process.env.SUPABASE_DEV_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV;
const PROD_URL =
  process.env.SUPABASE_PROD_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL;

if (!DEV_URL) throw new Error("No dev DB URL found");
if (!PROD_URL) throw new Error("No prod DB URL found");

const devPool = new Pool({
  connectionString: DEV_URL,
  ssl: { rejectUnauthorized: false },
});

const prodPool = new Pool({
  connectionString: PROD_URL,
  ssl: { rejectUnauthorized: false },
});

const SCHEMA = "ai_platform";

async function getTablesInSchema(pool: Pool, schema: string): Promise<string[]> {
  const res = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema]
  );
  return res.rows.map((r: any) => r.table_name);
}

async function getEnumsInSchema(pool: Pool, schema: string): Promise<Record<string, string[]>> {
  const res = await pool.query(
    `SELECT t.typname AS enum_name, e.enumlabel AS enum_value
     FROM pg_type t
     JOIN pg_enum e ON t.oid = e.enumtypid
     JOIN pg_namespace n ON t.typnamespace = n.oid
     WHERE n.nspname = $1
     ORDER BY t.typname, e.enumsortorder`,
    [schema]
  );
  const enums: Record<string, string[]> = {};
  for (const row of res.rows as any[]) {
    if (!enums[row.enum_name]) enums[row.enum_name] = [];
    enums[row.enum_name].push(row.enum_value);
  }
  return enums;
}

async function getColumnsForTable(
  pool: Pool,
  schema: string,
  table: string
): Promise<any[]> {
  const res = await pool.query(
    `SELECT
       c.column_name,
       c.ordinal_position,
       c.column_default,
       c.is_nullable,
       c.data_type,
       c.udt_name,
       c.character_maximum_length,
       c.numeric_precision,
       c.numeric_scale,
       c.is_identity,
       c.identity_generation
     FROM information_schema.columns c
     WHERE c.table_schema = $1 AND c.table_name = $2
     ORDER BY c.ordinal_position`,
    [schema, table]
  );
  return res.rows;
}

async function getPrimaryKeys(
  pool: Pool,
  schema: string,
  table: string
): Promise<string[]> {
  const res = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema = $1
       AND tc.table_name = $2
     ORDER BY kcu.ordinal_position`,
    [schema, table]
  );
  return res.rows.map((r: any) => r.column_name);
}

async function getUniqueConstraints(
  pool: Pool,
  schema: string,
  table: string
): Promise<Array<{ name: string; columns: string[] }>> {
  const res = await pool.query(
    `SELECT tc.constraint_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'UNIQUE'
       AND tc.table_schema = $1
       AND tc.table_name = $2
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [schema, table]
  );
  const map: Record<string, string[]> = {};
  for (const row of res.rows as any[]) {
    if (!map[row.constraint_name]) map[row.constraint_name] = [];
    map[row.constraint_name].push(row.column_name);
  }
  return Object.entries(map).map(([name, columns]) => ({ name, columns }));
}

async function getIndexes(
  pool: Pool,
  schema: string,
  table: string
): Promise<Array<{ name: string; def: string }>> {
  const res = await pool.query(
    `SELECT indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = $1 AND tablename = $2
       AND indexname NOT IN (
         SELECT constraint_name FROM information_schema.table_constraints
         WHERE table_schema = $1 AND table_name = $2
       )`,
    [schema, table]
  );
  return res.rows.map((r: any) => ({ name: r.indexname, def: r.indexdef }));
}

function columnTypeToSql(col: any, schema: string): string {
  const dt = col.data_type;
  const udt = col.udt_name;

  if (dt === "USER-DEFINED") {
    return `${schema}.${udt}`;
  }
  if (dt === "ARRAY") {
    // udt_name starts with _ for arrays
    const base = udt.startsWith("_") ? udt.slice(1) : udt;
    return `${base}[]`;
  }
  if (dt === "character varying") {
    return col.character_maximum_length
      ? `varchar(${col.character_maximum_length})`
      : "varchar";
  }
  if (dt === "character") {
    return col.character_maximum_length
      ? `char(${col.character_maximum_length})`
      : "char";
  }
  if (dt === "numeric") {
    if (col.numeric_precision && col.numeric_scale != null) {
      return `numeric(${col.numeric_precision},${col.numeric_scale})`;
    }
    return "numeric";
  }
  if (dt === "timestamp without time zone") return "timestamp";
  if (dt === "timestamp with time zone") return "timestamptz";
  if (dt === "time without time zone") return "time";
  if (dt === "time with time zone") return "timetz";
  if (dt === "double precision") return "float8";
  if (dt === "real") return "float4";
  if (dt === "smallint") return "int2";
  if (dt === "integer") return "int4";
  if (dt === "bigint") return "int8";
  if (dt === "boolean") return "bool";
  if (dt === "json") return "json";
  if (dt === "jsonb") return "jsonb";
  if (dt === "text") return "text";
  if (dt === "uuid") return "uuid";
  if (dt === "bytea") return "bytea";
  if (dt === "date") return "date";
  if (dt === "interval") return "interval";
  if (dt === "inet") return "inet";
  return dt;
}

function buildColumnDef(col: any, schema: string): string {
  const typeSql = columnTypeToSql(col, schema);

  // Handle identity columns (serial/bigserial equivalent in pg)
  if (col.is_identity === "YES") {
    const gen = col.identity_generation === "ALWAYS" ? "ALWAYS" : "BY DEFAULT";
    return `"${col.column_name}" ${typeSql} GENERATED ${gen} AS IDENTITY`;
  }

  let def = `"${col.column_name}" ${typeSql}`;

  if (col.column_default !== null) {
    def += ` DEFAULT ${col.column_default}`;
  }

  if (col.is_nullable === "NO") {
    def += " NOT NULL";
  }

  return def;
}

async function generateCreateTable(
  pool: Pool,
  schema: string,
  table: string
): Promise<string> {
  const columns = await getColumnsForTable(pool, schema, table);
  const pks = await getPrimaryKeys(pool, schema, table);
  const uniques = await getUniqueConstraints(pool, schema, table);

  const colDefs = columns.map((c) => buildColumnDef(c, schema));

  if (pks.length > 0) {
    colDefs.push(
      `CONSTRAINT "${table}_pkey" PRIMARY KEY (${pks.map((p) => `"${p}"`).join(", ")})`
    );
  }

  for (const u of uniques) {
    colDefs.push(
      `CONSTRAINT "${u.name}" UNIQUE (${u.columns.map((c) => `"${c}"`).join(", ")})`
    );
  }

  return `CREATE TABLE IF NOT EXISTS ${schema}."${table}" (\n  ${colDefs.join(",\n  ")}\n);`;
}

async function main() {
  console.log("🔍 Connecting to dev and prod databases...");

  const [devTables, prodTables] = await Promise.all([
    getTablesInSchema(devPool, SCHEMA),
    getTablesInSchema(prodPool, SCHEMA),
  ]);

  console.log(`\nDev tables:  ${devTables.length}`);
  console.log(`Prod tables: ${prodTables.length}`);

  const prodTableSet = new Set(prodTables);
  const missingTables = devTables.filter((t) => !prodTableSet.has(t));

  if (missingTables.length === 0) {
    console.log("\n✅ Prod schema is up-to-date. No missing tables.");
    return;
  }

  console.log(`\n⚠️  Missing ${missingTables.length} table(s) in prod:`);
  missingTables.forEach((t) => console.log(`   - ${t}`));

  // Step 1: Sync enums
  console.log("\n📦 Syncing enums...");
  const [devEnums, prodEnums] = await Promise.all([
    getEnumsInSchema(devPool, SCHEMA),
    getEnumsInSchema(prodPool, SCHEMA),
  ]);

  const prodClient = await prodPool.connect();
  try {
    await prodClient.query("BEGIN");

    // Ensure schema exists
    await prodClient.query(
      `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`
    );

    // Create missing enums
    for (const [enumName, values] of Object.entries(devEnums)) {
      if (!prodEnums[enumName]) {
        const valList = values.map((v) => `'${v}'`).join(", ");
        const sql = `CREATE TYPE ${SCHEMA}.${enumName} AS ENUM (${valList});`;
        console.log(`  Creating enum: ${enumName}`);
        await prodClient.query(sql);
      } else {
        // Add missing enum values
        const prodVals = new Set(prodEnums[enumName]);
        for (const val of values) {
          if (!prodVals.has(val)) {
            console.log(`  Adding value '${val}' to enum ${enumName}`);
            await prodClient.query(
              `ALTER TYPE ${SCHEMA}.${enumName} ADD VALUE IF NOT EXISTS '${val}'`
            );
          }
        }
      }
    }

    await prodClient.query("COMMIT");
    console.log("  ✅ Enums synced");

    // Step 2: Create missing tables
    console.log("\n🏗️  Creating missing tables...");
    for (const table of missingTables) {
      try {
        const ddl = await generateCreateTable(devPool, SCHEMA, table);
        console.log(`\n  Creating: ${table}`);
        console.log(`  DDL: ${ddl.substring(0, 120)}...`);
        await prodClient.query(ddl);
        console.log(`  ✅ Created`);
      } catch (err: any) {
        console.error(`  ❌ Failed to create ${table}: ${err.message}`);
        // Continue with other tables
      }
    }

    // Step 3: Create missing indexes
    console.log("\n📇 Creating indexes for new tables...");
    for (const table of missingTables) {
      try {
        const indexes = await getIndexes(devPool, SCHEMA, table);
        for (const idx of indexes) {
          // Replace schema name in the index def
          const idxDef = idx.def
            .replace(/ON public\./g, `ON ${SCHEMA}.`)
            .replace(/ON ai_platform\./g, `ON ${SCHEMA}.`);
          try {
            await prodClient.query(idxDef);
            console.log(`  ✅ Index ${idx.name} on ${table}`);
          } catch (err: any) {
            if (!err.message.includes("already exists")) {
              console.error(`  ⚠️  Index ${idx.name}: ${err.message}`);
            }
          }
        }
      } catch (err: any) {
        console.error(`  ❌ Index error for ${table}: ${err.message}`);
      }
    }

    console.log("\n🎉 Migration complete!");
    console.log("\nSummary of tables created:");
    missingTables.forEach((t) => console.log(`  ✅ ${t}`));
  } catch (err: any) {
    await prodClient.query("ROLLBACK");
    console.error("Migration failed, rolled back:", err.message);
    throw err;
  } finally {
    prodClient.release();
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await devPool.end();
    await prodPool.end();
  });
