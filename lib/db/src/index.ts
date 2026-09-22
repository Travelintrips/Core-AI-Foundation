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
const poolConfig = {
  connectionString: resolveDatabaseUrl(),
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
