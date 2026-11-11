import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createGpt02Issue159IssuerReaderPool } from "../gpt02Issue159IssuerReaderPool.js";

const host = "aws-1-ap-southeast-2.pooler.supabase.com";
const ref = "xssrfshdrtdfupgqwfdw";
const role = "gpt02_issuer_evidence_reader";
const ca = readFileSync(
  new URL("../../../../../scripts/dev/fixtures/supabase-root-ca-2021.crt", import.meta.url),
  "utf8",
);
const dsn = (username = role + "." + ref, password = "issuer-secret-fixture") =>
  "postgresql://" + username + ":" + password + "@" + host + ":5432/postgres";

class FakePool {
  config: Record<string, unknown>;
  ended = false;
  constructor(config: Record<string, unknown>) { this.config = config; }
  async connect() { throw new Error("fixture pool must not connect"); }
  async end() { this.ended = true; }
}

function make(envPatch: Record<string, string | undefined> = {}, Pool = FakePool) {
  return createGpt02Issue159IssuerReaderPool({
    env: {
      GPT02_ISSUER_READER_DATABASE_URL_DEV: dsn(),
      GPT02_READER_DEV_CA: ca,
      ...envPatch,
    },
    Pool,
    nodeEnv: "test",
    appEnv: "development",
  });
}

describe("GPT02 Issue159 dedicated issuer reader pool", () => {
  it("creates one isolated TLS-pinned, read-only CST-DEV pool without exposing credentials", async () => {
    const value = make();
    expect(value.issuerPool).toBeInstanceOf(FakePool);
    const pool = value.issuerPool as unknown as FakePool;
    expect(pool.config.max).toBe(1);
    expect(pool.config.connectionTimeoutMillis).toBe(5000);
    expect(pool.config.idleTimeoutMillis).toBe(10000);
    expect(pool.config.application_name).toBe("gpt02-issuer-evidence-reader");
    expect(pool.config.connectionString).toBe(dsn());
    expect(pool.config.ssl).toEqual({ ca, rejectUnauthorized: true });
    expect(pool.config.options).toContain("default_transaction_read_only=on");
    expect(pool.config.options).toContain("search_path=pg_catalog");
    expect(pool.config.options).toContain("statement_timeout=5000");
    expect(pool.config.options).toContain("lock_timeout=1000");
    expect(pool.config.options).toContain("idle_in_transaction_session_timeout=10000");
    expect(pool.config.options).toContain("row_security=on");
    expect(value.metadata.environment).toBe("DEV");
    expect(value.metadata.projectRef).toBe(ref);
    expect(value.metadata.role).toBe(role);
    expect(value.metadata.sharedPoolFallback).toBe(false);
    expect(value.metadata.dispatchPermitted).toBe(false);
    expect(value.metadata.signingPermitted).toBe(false);
    expect(JSON.stringify(value.metadata)).not.toContain("issuer-secret-fixture");
    await value.close();
    expect(pool.ended).toBe(true);
  });

  it("requires the dedicated issuer DSN and never falls back to the shared app URL", () => {
    let constructed = 0;
    class CountPool extends FakePool {
      constructor(config: Record<string, unknown>) { super(config); constructed++; }
    }
    expect(() => createGpt02Issue159IssuerReaderPool({
      env: {
        SUPABASE_DATABASE_URL_DEV: dsn("postgres.xssrfshdrtdfupgqwfdw"),
        GPT02_READER_DEV_CA: ca,
      },
      Pool: CountPool,
      nodeEnv: "test",
      appEnv: "development",
    })).toThrow("GPT02_ISSUER_READER_DSN_REQUIRED");
    expect(constructed).toBe(0);
  });

  it("rejects the shared application DSN even if copied into the issuer variable", () => {
    const shared = dsn();
    expect(() => make({
      GPT02_ISSUER_READER_DATABASE_URL_DEV: shared,
      SUPABASE_DATABASE_URL_DEV: shared,
    })).toThrow("GPT02_ISSUER_READER_SHARED_DSN_FORBIDDEN");
  });

  for (const [label, value, code] of [
    ["wrong role", dsn("postgres.xssrfshdrtdfupgqwfdw"), "GPT02_ISSUER_READER_DEDICATED_IDENTITY_REQUIRED"],
    ["wrong project", dsn("gpt02_issuer_evidence_reader.other"), "GPT02_ISSUER_READER_DEDICATED_IDENTITY_REQUIRED"],
    ["wrong host", "postgresql://" + role + "." + ref + ":pw@db.example.invalid:5432/postgres", "GPT02_ISSUER_READER_CST_DEV_TARGET_REQUIRED"],
    ["wrong database", "postgresql://" + role + "." + ref + ":pw@" + host + ":5432/production", "GPT02_ISSUER_READER_CST_DEV_TARGET_REQUIRED"],
    ["query parameters", dsn() + "?sslmode=no-verify", "GPT02_ISSUER_READER_DSN_QUERY_FORBIDDEN"],
  ] as const) {
    it("rejects " + label, () => {
      expect(() => make({ GPT02_ISSUER_READER_DATABASE_URL_DEV: value }))
        .toThrow(code);
    });
  }

  it("rejects missing, malformed, expanded or mismatched TLS roots and global TLS downgrade", () => {
    for (const patch of [
      { GPT02_READER_DEV_CA: undefined },
      { GPT02_READER_DEV_CA: "not-a-certificate" },
      { GPT02_READER_DEV_CA: ca + ca },
      { GPT02_READER_DEV_CA: ca.replace("MIIDxD", "MIIDyD") },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    ]) {
      expect(() => make(patch)).toThrow();
    }
  });

  it("rejects production mode before pool construction", () => {
    let constructed = 0;
    class CountPool extends FakePool {
      constructor(config: Record<string, unknown>) { super(config); constructed++; }
    }
    expect(() => createGpt02Issue159IssuerReaderPool({
      env: {
        GPT02_ISSUER_READER_DATABASE_URL_DEV: dsn(),
        GPT02_READER_DEV_CA: ca,
      },
      Pool: CountPool,
      nodeEnv: "production",
      appEnv: "production",
    })).toThrow("GPT02_ISSUER_READER_EXPLICIT_CST_DEV_MODE_REQUIRED");
    expect(constructed).toBe(0);
  });

  it("source has no private-key, signing, shared-pool or dispatch surface", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../gpt02Issue159IssuerReaderPool.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "createPrivateKey", "sign(", "private-key.pkcs8",
      "SUPABASE_SERVICE_ROLE_KEY", "@workspace/db",
      "sendCommand(", "dispatchPermitted: true",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
