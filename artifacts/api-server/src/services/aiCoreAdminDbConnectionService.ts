import { db, PostgresPool, withTransientDatabaseRetry } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  getAdminDbConnectionDescriptors,
  getAdminDbRegistrations,
  type AdminDbConnectionDescriptor,
} from "./aiCoreAdminDbRegistryService.js";

export interface AdminDbExecutor {
  execute(query: SQL): Promise<unknown>;
}

export interface AdminDbClient extends AdminDbExecutor {
  transaction<T>(work: (tx: AdminDbExecutor) => Promise<T>): Promise<T>;
}

export type AdminDbConnection = AdminDbConnectionDescriptor & {
  client(): AdminDbClient;
};

const clients = new Map<string, {
  url: string;
  database: AdminDbClient;
  pool: InstanceType<typeof PostgresPool>;
}>();

function additionalClient(id: string, rawUrl: string, env: NodeJS.ProcessEnv): AdminDbClient {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch {
    throw new Error(`Koneksi database ${id} memiliki konfigurasi URL tidak valid.`);
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error(`Koneksi database ${id} harus memakai PostgreSQL.`);
  }
  const supabase = /(?:\.supabase\.co|\.pooler\.supabase\.com)$/.test(parsed.hostname);
  if (supabase && !parsed.searchParams.has("sslmode")) parsed.searchParams.set("sslmode", "require");
  if (env["NODE_ENV"] === "production" && env["SUPABASE_FORCE_SESSION_POOLER"] !== "true" && parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "5432") {
    parsed.port = "6543";
  }
  const url = parsed.toString();
  const previous = clients.get(id);
  if (previous?.url === url) return previous.database;
  if (previous) void previous.pool.end().catch(() => {});
  const pool = new PostgresPool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 3_000,
    query_timeout: 10_000,
    allowExitOnIdle: true,
    application_name: `ai-core-admin-read-${id}`,
  });
  // An idle connection failure must not become an unhandled process error.
  // The next discovery reports connection health through its normal query result.
  pool.on("error", () => {});
  const database: AdminDbClient = drizzle(pool);
  clients.set(id, { url, database, pool });
  return database;
}

export function getAdminDbConnections(
  env: NodeJS.ProcessEnv = process.env,
): AdminDbConnection[] {
  const entries = getAdminDbRegistrations(env);
  const descriptors = getAdminDbConnectionDescriptors(env);
  return descriptors.map((descriptor) => ({
    ...descriptor,
    client: () => {
      if (descriptor.id === "primary") {
        if (env["NODE_ENV"] !== "production") return db;
        const url = (env["SUPABASE_PROD_DATABASE_URL"] || env["SUPABASE_DATABASE_URL"])?.trim();
        if (!url) throw new Error("Koneksi database primary belum dikonfigurasi.");
        // Keep interactive reads out of the control-plane worker queue, while
        // limiting the extra production database load to one connection.
        return additionalClient("primary", url, env);
      }
      const entry = entries.find((item) => item.id === descriptor.id)!;
      const url = env[entry.databaseUrlEnv]?.trim();
      if (!url) throw new Error(`Koneksi database ${descriptor.id} belum dikonfigurasi.`);
      return additionalClient(descriptor.id, url, env);
    },
  }));
}

export function getAdminDbConnection(id = "primary"): AdminDbConnection {
  const connection = getAdminDbConnections().find((entry) => entry.id === id);
  if (!connection) throw new Error(`Koneksi database ${id} tidak terdaftar.`);
  return connection;
}

export function runAdminDbReadTransaction<T>(
  connection: AdminDbConnection,
  work: (tx: AdminDbExecutor) => Promise<T>,
): Promise<T> {
  return withTransientDatabaseRetry(
    () => connection.client().transaction(work),
    { attempts: 3, baseDelayMs: 200 },
  );
}

export async function readAdminDbMetadata(connection: AdminDbConnection, query: SQL): Promise<unknown> {
  return runAdminDbReadTransaction(connection, async (tx) => {
    await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
    await tx.execute(sql.raw("SET LOCAL statement_timeout = '8000ms'"));
    await tx.execute(sql.raw("SET LOCAL lock_timeout = '1500ms'"));
    return tx.execute(query);
  });
}
