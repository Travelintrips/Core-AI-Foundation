import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: vi.fn(), readProtected: vi.fn(), lstat: vi.fn(), open: vi.fn(),
  rename: vi.fn(), link: vi.fn(), unlink: vi.fn(),
}));
vi.mock("@workspace/db", () => { throw new Error("APPLICATION_WRITER_POOL_IMPORT_FORBIDDEN"); });
vi.mock("@workspace/db/pg", () => ({ Pool: mocks.pool }));
vi.mock("../gpt02ProtectedRuntimeFile.js", () => ({ readProtectedRuntimeFile: mocks.readProtected }));
vi.mock("node:fs/promises", () => ({
  lstat: mocks.lstat, open: mocks.open, rename: mocks.rename, link: mocks.link, unlink: mocks.unlink,
}));

import { runGpt02ReaderCustodian } from "../../../../../scripts/dev/gpt02-reader-custodian-runtime.js";
import {
  Gpt02DbaCustodianError, type Gpt02DbaCustodianErrorCode,
} from "../gpt02ReaderCustodyDbaIssuer.js";

const PRIVATE_MARKER = "SYNTHETIC_PRIVATE_DSN_PASSWORD_KEY_DIAGNOSTIC";
const PUBLICATION = {
  state: "CUSTODY_EVIDENCE_PUBLISHED", receiptId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  expiresAt: 1_800_000_900_000, readerE2eVerified: false, credentialGenerationChecked: false,
  authorizationGranted: false, dispatchPermitted: false,
} as const;

function fixture() {
  return {
    issuer: { issueAndPublish: vi.fn(async () => PUBLICATION) },
    output: { stdout: vi.fn(), stderr: vi.fn() },
  };
}

describe("standalone DBA custodian host entry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("GPT02_DEV_CUSTODY_DBA_PREPARATION_ENABLED", "false");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    // These entry tests use a fake issuer or the real default-disabled gate.
    // No host file or SQL adapter may be reached in either case.
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
  });

  it("emits only the bounded public publication status after an awaited success", async () => {
    const f = fixture();
    expect(await runGpt02ReaderCustodian([], f.issuer, f.output)).toBe(0);
    expect(f.issuer.issueAndPublish).toHaveBeenCalledOnce();
    expect(f.output.stdout).toHaveBeenCalledOnce(); expect(f.output.stderr).not.toHaveBeenCalled();
    expect(f.output.stdout.mock.calls[0]).toEqual([
      JSON.stringify({ event: "gpt02_reader_custody_dba_published", ...PUBLICATION }) + "\n",
    ]);
    expect(f.output.stdout.mock.calls[0][0]).not.toMatch(/password|privateKey|credentialBinding|signature|tokenHash/);
  });

  it("keeps the actual default factory dormant and returns a safe disabled result without IO", async () => {
    const f = fixture();
    expect(await runGpt02ReaderCustodian([], undefined, f.output)).toBe(1);
    expect(f.output.stdout).not.toHaveBeenCalled();
    expect(f.output.stderr.mock.calls).toEqual([["GPT02_DBA_CUSTODIAN=BLOCKED code=CUSTODY_DBA_DISABLED\n"]]);
  });

  it.each([{ args: ["--help"] }, { args: ["--private-key", PRIVATE_MARKER] }, { args: ["--reader-role", "postgres"] }])(
    "rejects caller arguments before invoking the issuer", async ({ args }) => {
      const f = fixture();
      expect(await runGpt02ReaderCustodian(args, f.issuer, f.output)).toBe(1);
      expect(f.issuer.issueAndPublish).not.toHaveBeenCalled(); expect(f.output.stdout).not.toHaveBeenCalled();
      expect(f.output.stderr.mock.calls).toEqual([["GPT02_DBA_CUSTODIAN=BLOCKED code=CUSTODY_DBA_ARGUMENTS_INVALID\n"]]);
      expect(f.output.stderr.mock.calls[0][0]).not.toContain(PRIVATE_MARKER);
    },
  );

  it.each([
    { error: new Gpt02DbaCustodianError("CUSTODY_DBA_READER_BUSY"), code: "CUSTODY_DBA_READER_BUSY" },
    { error: new Error(PRIVATE_MARKER), code: "CUSTODY_DBA_UNAVAILABLE" },
    { error: { code: PRIVATE_MARKER, message: PRIVATE_MARKER }, code: "CUSTODY_DBA_UNAVAILABLE" },
    { error: new Gpt02DbaCustodianError(PRIVATE_MARKER as Gpt02DbaCustodianErrorCode), code: "CUSTODY_DBA_UNAVAILABLE" },
  ])("redacts failure as $code without returning a receipt or private diagnostics", async ({ error, code }) => {
    const f = fixture(); f.issuer.issueAndPublish.mockRejectedValue(error);
    expect(await runGpt02ReaderCustodian([], f.issuer, f.output)).toBe(1);
    expect(f.output.stdout).not.toHaveBeenCalled();
    expect(f.output.stderr.mock.calls).toEqual([[`GPT02_DBA_CUSTODIAN=BLOCKED code=${code}\n`]]);
    expect(f.output.stderr.mock.calls[0][0]).not.toContain(PRIVATE_MARKER);
  });
});
