import { describe, expect, it } from "vitest";
import {
  GPT02_CUSTODY_DIRECT_HOST, GPT02_CUSTODY_SESSION_POOLER_HOST,
  GPT02_CUSTODY_READER_ROLE, GPT02_CUSTODY_PROJECT,
  resolveGpt02ReaderDbTransport,
} from "../gpt02ReaderCustodyDbTransport.js";

const CONFIG = {
  host: GPT02_CUSTODY_DIRECT_HOST, port: 5432, database: "postgres",
  user: GPT02_CUSTODY_READER_ROLE, projectId: GPT02_CUSTODY_PROJECT, sslMode: "verify-full",
} as const;

describe("CST-DEV GPT02 reader sealed transport pins (no external network)", () => {
  it("keeps the existing direct PostgreSQL connection unchanged", () => {
    expect(resolveGpt02ReaderDbTransport(CONFIG)).toEqual({
      host: GPT02_CUSTODY_DIRECT_HOST, port: 5432, database: "postgres",
      databaseUser: GPT02_CUSTODY_READER_ROLE,
      tlsServerName: GPT02_CUSTODY_DIRECT_HOST, mode: "direct",
    });
  });
  it("accepts ONLY the exact CST-DEV session pooler, never transaction pooling", () => {
    expect(resolveGpt02ReaderDbTransport({ ...CONFIG, host: GPT02_CUSTODY_SESSION_POOLER_HOST })).toEqual({
      host: GPT02_CUSTODY_SESSION_POOLER_HOST, port: 5432, database: "postgres",
      databaseUser: `${GPT02_CUSTODY_READER_ROLE}.${GPT02_CUSTODY_PROJECT}`,
      tlsServerName: GPT02_CUSTODY_SESSION_POOLER_HOST, mode: "session-pooler",
    });
  });
  it.each([
    ["unapproved arbitrary host", { host: "evil.invalid" }],
    ["lookalike host", { host: `${GPT02_CUSTODY_SESSION_POOLER_HOST}.evil.invalid` }],
    ["other region", { host: "aws-0-us-east-1.pooler.supabase.com" }],
    ["other project", { projectId: "nzdweipzckfszczzqtuw" }],
    ["Task190 role", { user: "gpt02_owner_ledger_reader_dev" }],
    ["writer role", { user: "postgres" }],
    ["transaction pool", { host: GPT02_CUSTODY_SESSION_POOLER_HOST, port: 6543 }],
    ["direct wrong port", { port: 6543 }],
    ["TLS require without hostname verification", { sslMode: "require" }],
    ["plaintext TLS disabled", { sslMode: "disable" }],
    ["incorrect database", { database: "template1" }],
    ["string port", { port: "5432" }],
  ])("fails closed for %s", (_description, patch) => {
    expect(resolveGpt02ReaderDbTransport({ ...CONFIG, ...patch })).toBeNull();
  });
});
