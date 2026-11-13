import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createIssuerReaderServer } from "../../../../../scripts/dev/gpt02-issuer-reader-runtime";

describe("GPT02 Issue159 issuer reader DynamicUser runtime directory", () => {
  it("accepts only the exact systemd /run/private mapping and validates its owner/mode", async () => {
    const source = await readFile(
      new URL("../../../../../scripts/dev/gpt02-issuer-reader-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('fs.lstatSync(parent)');
    expect(source).toContain('fs.realpathSync(parent)');
    expect(source).toContain('path.join("/run/private", path.basename(parent))');
    expect(source).toContain('fs.lstatSync("/run/private")');
    expect(source).toContain('privateRoot.uid !== 0 || privateRoot.gid !== 0');
    expect(source).toContain('const privateRootMode = privateRoot.mode & 0o777');
    expect(source).toContain('![0o700, 0o755].includes(privateRootMode)');
    expect(source).toContain('(privateRootMode & 0o022) !== 0');
    expect(source).toContain('directory.uid !== process.getuid?.() || directory.gid !== gid');
    expect(source).toContain('(directory.mode & 0o777) !== 0o750');
    expect(source).toContain('ISSUER_READER_SYSTEMD_RUNTIME_MAPPING_INVALID');
    expect(source).toContain("let healthInFlight: Promise<Awaited<ReturnType");
    expect(source).toContain("healthInFlight ??= runSerialized(() => reader.health()).then");
    expect(source).toContain("const HEALTH_CACHE_MS = 5_000");
    expect(source).toContain("if (nativeHealthIsTrusted(result))");
    expect(source).toContain("lastHealthy = null");
    expect(source).toContain("lastHealthyAt = 0");
    expect(source).toContain("let databaseQueue: Promise<unknown> = Promise.resolve()");
    expect(source).toContain("runSerialized(() => reader.read(input))");
  });

  it("serializes concurrent health and evidence reads through one database session", async () => {
    let active = 0;
    let maxActive = 0;
    let healthCalls = 0;
    let readCalls = 0;
    const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
    const reader = {
      health: async () => {
        healthCalls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await pause();
        active -= 1;
        return {
          readOnlySessionVerified: true,
          nativeRoleAuthenticated: true,
          tlsVerified: true,
          operationalTrustedReaderRuntime: true,
          signingPermitted: false,
          authorizationGranted: false,
          dispatchPermitted: false,
          releaseDecision: "NO_GO",
        };
      },
      read: async () => {
        readCalls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await pause();
        active -= 1;
        return {
          reason: "ISSUER_LEDGER_MISSING_OR_NOT_UNIQUE",
          readOnlySessionVerified: true,
          issuerLedgerMatched: false,
          persistedTrustedReadProven: false,
          signingPermitted: false,
          authorizationGranted: false,
          dispatchPermitted: false,
          releaseDecision: "NO_GO",
        };
      },
    } as unknown as Parameters<typeof createIssuerReaderServer>[0]["reader"];
    const server = createIssuerReaderServer({ reader });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_REQUIRED");
      const health = () => fetch(`http://127.0.0.1:${address.port}/health`).then(async (response) => ({
        status: response.status,
        body: await response.json(),
      }));
      const evidence = () => fetch(`http://127.0.0.1:${address.port}/issuer-evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ observedAt: Date.now(), claims: { environment: "DEV" } }),
      }).then(async (response) => ({ status: response.status, body: await response.json() }));
      const [healthResults, evidenceResults] = await Promise.all([
        Promise.all(Array.from({ length: 4 }, health)),
        Promise.all(Array.from({ length: 4 }, evidence)),
      ]);
      expect(healthCalls).toBe(1);
      expect(readCalls).toBe(4);
      expect(maxActive).toBe(1);
      expect(healthResults.every((result) => result.status === 200 && result.body.ok === true)).toBe(true);
      expect(evidenceResults.every((result) =>
        result.status === 409 &&
        result.body.result?.readOnlySessionVerified === true &&
        result.body.dispatchPermitted === false
      )).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps signing, authorization and dispatch disabled in the reader runtime", async () => {
    const source = await readFile(
      new URL("../../../../../scripts/dev/gpt02-issuer-reader-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('signingPermitted: false');
    expect(source).toContain('authorizationGranted: false');
    expect(source).toContain('dispatchPermitted: false');
    expect(source).toContain('releaseDecision: "NO_GO"');
  });
});
