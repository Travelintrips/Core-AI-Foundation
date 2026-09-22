import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabaseUrl } from "./env";

const { Pool } = pg;

// Raw SQL in the app (outside Drizzle's schema-qualified query builder) uses
// unqualified table names, so every new connection must default its search
// path to our dedicated schema instead of "public".
//
// Do not pass search_path through libpq's startup "options" parameter here.
// Supabase's transaction/session pooler rejects that startup parameter with
// "unsupported startup parameter in options: search_path". pg-pool's
// verify hook is awaited before a new client is handed to a caller, so this
// keeps the schema setup race-free while working with both direct Postgres and
// Supabase pooler connections.
const isProduction = process.env["NODE_ENV"] === "production";
const configuredPoolMax = Number(process.env["PG_POOL_MAX"]);
const poolMax =
  Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
    ? Math.max(1, Math.min(10, Math.floor(configuredPoolMax)))
    : isProduction
      ? 3
      : 10;

const poolConfig = {
  connectionString: resolveDatabaseUrl(),
  // Keep each Hostinger process deliberately small. Rolling deploys can run
  // multiple processes at once; a default pg pool of 10 per process can exceed
  // Supabase's session-pool client limit immediately.
  max: poolMax,
  idleTimeoutMillis: isProduction ? 10_000 : 30_000,
  connectionTimeoutMillis: 10_000,
  verify: (
    client: { query: (sql: string) => Promise<unknown> },
    done: (err?: Error) => void,
  ) => {
    client
      .query("SET search_path TO ai_platform, public")
      .then(() => done())
      .catch((err: unknown) => done(err instanceof Error ? err : new Error(String(err))));
  },
};

export const pool = new Pool(poolConfig);

export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./env";
