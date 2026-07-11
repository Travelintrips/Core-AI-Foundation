import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabaseUrl } from "./env";

const { Pool } = pg;

// Raw SQL in the app (outside Drizzle's schema-qualified query builder) uses
// unqualified table names, so every new connection must default its search
// path to our dedicated schema instead of "public". Setting it via the libpq
// startup "options" parameter (rather than a query in a "connect" listener)
// guarantees it is applied atomically before the connection is handed back
// to the pool for use — a `client.query(...)` in a "connect" handler is not
// awaited by the pool and can race with the first real query on that
// connection, intermittently causing "relation ... does not exist" errors.
export const pool = new Pool({
  connectionString: resolveDatabaseUrl(),
  options: "-c search_path=ai_platform,public",
});

export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./env";
