import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), transaction: vi.fn(), poolOptions: vi.fn(),
  poolOn: vi.fn(), poolEnd: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@workspace/db", async () => ({
  withTransientDatabaseRetry: (await vi.importActual<typeof import("@workspace/db")>("@workspace/db")).withTransientDatabaseRetry,
  db: { execute: mocks.execute, transaction: mocks.transaction },
  PostgresPool: class {
    constructor(options: unknown) { mocks.poolOptions(options); }
    on = mocks.poolOn;
    end = mocks.poolEnd;
  },
}));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({ execute: mocks.execute, transaction: mocks.transaction }) }));
import { getAdminDbConnections, readAdminDbMetadata, runAdminDbReadTransaction } from "../aiCoreAdminDbConnectionService.js";
import { getAdminDbConnectionDescriptors } from "../aiCoreAdminDbRegistryService.js";

const registration = '[{"id":"sports","label":"Sport center","databaseUrlEnv":"SPORT_DATABASE_URL"}]';

describe("admin database connection boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ rows: [] });
    mocks.transaction.mockImplementation(async (work: (tx: { execute: typeof mocks.execute }) => Promise<unknown>) => work({ execute: mocks.execute }));
  });

  it("discovers only registered server-side connections and exposes no credential or environment reference", () => {
    const env = { AI_CORE_ADMIN_DATABASES_JSON: registration, SPORT_DATABASE_URL: "postgresql://user:private@localhost/sports", SUPABASE_DEV_DATABASE_URL: "postgresql://private-dev" };
    const descriptors = getAdminDbConnectionDescriptors(env);
    expect(descriptors).toEqual([{ id: "primary", label: "AI Core", configured: true }, { id: "sports", label: "Sport center", configured: true }]);
    expect(JSON.stringify(descriptors)).not.toMatch(/private|SPORT_DATABASE_URL/);
    expect(mocks.poolOptions).not.toHaveBeenCalled();
  });

  it("rejects inline credentials, duplicate ids, and invalid registries before querying", () => {
    expect(() => getAdminDbConnections({ AI_CORE_ADMIN_DATABASES_JSON: '[{"id":"sports","label":"Sport","url":"postgresql://private"}]' })).toThrow(/credential/);
    expect(() => getAdminDbConnections({ AI_CORE_ADMIN_DATABASES_JSON: '[' + registration.slice(1,-1) + ',' + registration.slice(1,-1) + ']' })).toThrow(/duplikat/);
    expect(() => getAdminDbConnections({ AI_CORE_ADMIN_DATABASES_JSON: 'private-invalid-json' })).toThrow(/JSON/);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("contains an unconfigured connection failure without aborting healthy discovery", async () => {
    const connections = getAdminDbConnections({ AI_CORE_ADMIN_DATABASES_JSON: registration });
    const outcomes = await Promise.allSettled(connections.map((connection) => readAdminDbMetadata(connection, sql.raw("SELECT 1"))));
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "rejected"]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("sets metadata limits inside a read-only transaction and lazily creates a bounded TLS pool", async () => {
    const connections = getAdminDbConnections({ AI_CORE_ADMIN_DATABASES_JSON: registration, SPORT_DATABASE_URL: "postgresql://user:private@test.pooler.supabase.com:6543/sports" });
    await readAdminDbMetadata(connections[1]!, sql.raw("SELECT table_name FROM information_schema.tables"));
    expect(mocks.poolOptions).toHaveBeenCalledWith(expect.objectContaining({ max: 1, connectionTimeoutMillis: 3000, query_timeout: 10000 }));
    const options = mocks.poolOptions.mock.calls[0]![0] as { connectionString: string };
    expect(new URL(options.connectionString).searchParams.get("sslmode")).toBe("require");
    const dialect = new PgDialect();
    expect(mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql)).toEqual([
      "SET TRANSACTION READ ONLY", "SET LOCAL statement_timeout = '8000ms'", "SET LOCAL lock_timeout = '1500ms'", "SELECT table_name FROM information_schema.tables",
    ]);
  });

  it("retries a disconnected read transaction and starts its read-only guards again", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("Failed query", {
      cause: Object.assign(new Error("connection reset"), { code: "08006" }),
    }));
    await readAdminDbMetadata(getAdminDbConnections({})[0]!, sql.raw("SELECT 1"));
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.execute).toHaveBeenCalledTimes(4);
  });

  it("does not retry SQL errors or retry more than three disconnected attempts", async () => {
    const connection = getAdminDbConnections({})[0]!;
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("syntax error"), { code: "42601" }));
    await expect(runAdminDbReadTransaction(connection, async () => "ok")).rejects.toThrow("syntax error");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    mocks.transaction.mockClear();
    mocks.transaction.mockRejectedValue(Object.assign(new Error("connection reset"), { code: "08006" }));
    await expect(runAdminDbReadTransaction(connection, async () => "ok")).rejects.toThrow("connection reset");
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });
});
