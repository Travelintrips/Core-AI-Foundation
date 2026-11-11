import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createGpt02Issue159IssuerTrustedReader,
} from "../gpt02Issue159IssuerTrustedReader.js";
import {
  GPT02_ISSUE159_ISSUER_IDENTITY_SQL,
  GPT02_ISSUE159_ISSUER_LEDGER_SQL,
} from "../gpt02Issue159IssuerLedgerReadOnly.js";

const host = "db.xssrfshdrtdfupgqwfdw.supabase.co";
const ref = "xssrfshdrtdfupgqwfdw";
const role = "gpt02_issuer_evidence_reader";
const ca = readFileSync(
  new URL("../../../../../scripts/dev/fixtures/supabase-root-ca-2021.crt", import.meta.url),
  "utf8",
);
const dsn = "postgresql://" + role +
  ":issuer-secret-fixture@" + host + ":5432/postgres";

const claims = {
  v: 1,
  environment: "DEV",
  audience: "GPT02_ISSUER_LEASE_EVIDENCE_V1",
  companyId: "default",
  hubTaskId: 137,
  hubExecutionId: "11111111-1111-4111-8111-111111111111",
  coreTaskId: "22222222-2222-4222-8222-222222222222",
  commandId: "33333333-3333-4333-8333-333333333333",
  attemptId: "44444444-4444-4444-8444-444444444444",
  workerId: "openclaw-dell-chatgpt-wake-dev",
  receiptId: "55555555-5555-4555-8555-555555555555",
  linkId: "66666666-6666-4666-8666-666666666666",
  fenceId: "77777777-7777-4777-8777-777777777777",
  approvalDigest: "a".repeat(64),
  nonceDigest: "b".repeat(64),
  issuerRole: "dev_gpt02_issuer_evidence",
  leaseEpoch: 1,
  issuedAt: 1000,
  expiresAt: 10000,
};

class FakeClient {
  released = false;
  connection = { stream: { encrypted: true, authorized: true } };
  async query(sql: string) {
    if (sql === GPT02_ISSUE159_ISSUER_IDENTITY_SQL) {
      return { rows: [{
        db: "postgres",
        login: role,
        session: role,
        tx_readonly: true,
        search_path_locked: true,
        statement_timeout_locked: true,
        lock_timeout_locked: true,
        idle_timeout_locked: true,
        backend_pid: 12345,
        db_tls: true,
        restricted_role: true,
        no_memberships: true,
        no_global_read: true,
        no_global_write: true,
        no_db_create: true,
        no_relation_writes: true,
        no_privileged_routines: true,
      }] };
    }
    if (sql === GPT02_ISSUE159_ISSUER_LEDGER_SQL) return { rows: [] };
    return { rows: [] };
  }
  release() { this.released = true; }
}

class FakePool {
  ended = false;
  client = new FakeClient();
  constructor(_config: Record<string, unknown>) {}
  async connect() { return this.client; }
  async end() { this.ended = true; }
}

describe("GPT02 Issue159 issuer trusted-read adapter", () => {
  it("composes the restricted pool and ledger reader without creating authority", async () => {
    const reader = createGpt02Issue159IssuerTrustedReader({
      env: {
        NODE_ENV: "test",
        APP_ENV: "development",
        GPT02_ISSUER_READER_DATABASE_URL_DEV: dsn,
        GPT02_READER_DEV_CA: ca,
      },
      Pool: FakePool,
      nodeEnv: "test",
      appEnv: "development",
    });
    expect(reader.metadata.environment).toBe("DEV");
    expect(reader.metadata.role).toBe(role);
    expect(reader.metadata.source).toBe("systemd-credential-backed-issuer-reader");
    expect(reader.metadata.readOnly).toBe(true);
    expect(reader.metadata.signingPermitted).toBe(false);
    expect(reader.metadata.authorizationGranted).toBe(false);
    expect(reader.metadata.dispatchPermitted).toBe(false);

    const result = await reader.read({ claims, observedAt: 5000 });
    expect(result.reason).toBe("ISSUER_LEDGER_MISSING_OR_NOT_UNIQUE");
    expect(result.readOnlySessionVerified).toBe(true);
    // A test-injected pool can never be promoted to operational provenance.
    expect(result.persistedTrustedReadProven).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);

    await reader.close();
  });

  it("rejects caller-injected pools in operational mode", () => {
    expect(() => createGpt02Issue159IssuerTrustedReader({
      env: {
        NODE_ENV: "development",
        APP_ENV: "development",
        CREDENTIALS_DIRECTORY: "/run/credentials/gpt02-issue159-issuer-reader.service",
      },
      Pool: FakePool,
      nodeEnv: "development",
      appEnv: "development",
    })).toThrow("GPT02_ISSUER_TRUSTED_READER_CALLER_POOL_FORBIDDEN");
  });

  it("requires the exact systemd credential mount in operational mode", () => {
    expect(() => createGpt02Issue159IssuerTrustedReader({
      env: {
        NODE_ENV: "development",
        APP_ENV: "development",
        CREDENTIALS_DIRECTORY: "/run/credentials/gpt02-issue159-signer@issuer.service",
      },
      nodeEnv: "development",
      appEnv: "development",
    })).toThrow("GPT02_ISSUER_TRUSTED_READER_SYSTEMD_CREDENTIALS_REQUIRED");
  });

  it("source has no private-key, signing, mutation or dispatch surface", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../gpt02Issue159IssuerTrustedReader.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "private-key.pkcs8",
      "createPrivateKey",
      "sign(",
      "consumeLinkedApproval",
      "INSERT ",
      "UPDATE ",
      "DELETE ",
      "dispatchPermitted: true",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
