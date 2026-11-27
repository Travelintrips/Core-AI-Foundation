import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(fileURLToPath(new URL("../../app.ts", import.meta.url)), "utf8");
const readerSource = readFileSync(fileURLToPath(new URL("../../services/gpt02SuperAdminLedgerReader.ts", import.meta.url)), "utf8");

describe("GPT02 Super Admin separate ledger reader release boundary", () => {
  it("is mounted only under a dedicated DEV feature flag, not an existing approval flag", () => {
    const mount = appSource.indexOf('app.use("/api/gpt02-owner-ledger", createGpt02OwnerLedgerReadRouter(');
    expect(mount).toBeGreaterThan(0);
    const start = appSource.lastIndexOf("if (", mount);
    const gate = appSource.slice(start, mount);
    expect(gate).toContain('process.env.NODE_ENV !== "production"');
    expect(gate).toContain('process.env.APP_ENV === "development"');
    expect(gate).toContain('process.env.GPT02_OWNER_LEDGER_READER_ENABLED === "true"');
    expect(appSource.match(/app\.use\("\/api\/gpt02-owner-ledger"/g)).toHaveLength(1);
  });

  it("never falls back to the app writer pool or takes credentials from the browser", () => {
    expect(readerSource).toContain('new PostgresPool(');
    expect(readerSource).toContain('user: transport.databaseUser');
    expect(readerSource).toContain('resolveGpt02ReaderDbTransport(config)');
    expect(readerSource).toContain('identity.rows[0]?.actor !== ROLE');
    expect(readerSource).toContain('identity.rows[0]?.effective !== ROLE');
    expect(readerSource).toContain('reader.json');
    expect(readerSource).toContain('await readProtectedRuntimeFile(CREDENTIAL_FILE,');
    expect(readerSource).toContain('await readProtectedRuntimeFile(ROOT_CA,');
    expect(readerSource).not.toMatch(/\b(?:lstatSync|readFileSync|readFile)\s*\(/);
    expect(readerSource).toContain('rejectUnauthorized: true');
    expect(readerSource).toContain('BEGIN TRANSACTION READ ONLY');
    expect(readerSource).toContain('current_setting(\'default_transaction_read_only\')');
    expect(readerSource).not.toContain('import { db }');
    expect(readerSource).not.toContain('process.env.DATABASE_URL');
  });

  it("mounts before the generic admin middleware, without exposing other API paths", () => {
    const ledger = appSource.indexOf('app.use("/api/gpt02-owner-ledger"');
    const generic = appSource.indexOf('app.use("/api", adminAuthWithExceptions, router)');
    expect(ledger).toBeGreaterThan(0);
    expect(ledger).toBeLessThan(generic);
  });
});
