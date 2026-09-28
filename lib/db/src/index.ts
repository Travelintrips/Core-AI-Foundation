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
    ? Math.max(1, Math.min(5, Math.floor(configuredPoolMax)))
    : isProduction
      ? 1
      : 5;

const poolConfig = {
  connectionString: resolveDatabaseUrl(),
  // Keep each Hostinger process deliberately small. Rolling deploys can run
  // multiple processes at once; a default pg pool of 10 per process can exceed
  // Supabase's session-pool client limit immediately.
  max: poolMax,
  idleTimeoutMillis: isProduction ? 10_000 : 30_000,
  connectionTimeoutMillis: 8_000,
  application_name: "core-ai-foundation",
  verify: (
    client: { query: (sql: string) => Promise<unknown> },
    done: (err?: Error) => void,
  ) => {
    const initializeSession = async (): Promise<void> => {
      // The DEV Supabase role currently advertises default_transaction_read_only
      // = on even though the server is not in recovery. Queue lifecycle writes
      // and SELECT ... FOR UPDATE SKIP LOCKED require an explicit read-write
      // session. Production keeps its existing transaction-pooler behavior.
      if (!isProduction) {
        await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE");
      }
      await client.query("SET search_path TO ai_platform, public");
    };

    initializeSession()
      .then(() => done())
      .catch((err: unknown) => done(err instanceof Error ? err : new Error(String(err))));
  },
};

export const pool = new Pool(poolConfig);

const TRANSIENT_DB_CODES = new Set([
  "08000", "08001", "08003", "08004", "08006", "08007",
  "57P01", "57P02", "57P03", "53300",
]);

export function isTransientDatabaseConnectionError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = String(candidate?.message ?? error ?? "").toLowerCase();
  return TRANSIENT_DB_CODES.has(code) ||
    /timeout exceeded when trying to connect|connection terminated unexpectedly|connection reset|connection refused|connection timed out|server closed the connection unexpectedly|terminating connection due to administrator command|too many connections|remaining connection slots are reserved|econnreset|econnrefused|etimedout/.test(message);
}

export async function withTransientDatabaseRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(5, Math.floor(options.attempts ?? 3)));
  const baseDelayMs = Math.max(25, Math.min(2_000, Math.floor(options.baseDelayMs ?? 200)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientDatabaseConnectionError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError;
}

export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./env";
