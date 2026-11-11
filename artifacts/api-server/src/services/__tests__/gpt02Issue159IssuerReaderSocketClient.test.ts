import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { chmodSync, chownSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readGpt02Issue159IssuerReaderSocket,
  readGpt02Issue159IssuerReaderSocketHealth,
} from "../gpt02Issue159IssuerReaderSocketClient.js";

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

const health = {
  ok: true,
  environment: "DEV",
  issuerRole: "gpt02_issuer_evidence_reader",
  readerReady: true,
  tlsVerified: true,
  clientTlsVerified: true,
  backendTlsVerified: true,
  readOnly: true,
  signingPermitted: false,
  authorizationGranted: false,
  dispatchPermitted: false,
  releaseDecision: "NO_GO",
};

function socketFixture(responsePatch: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gpt02-issuer-socket-"));
  const uid = process.getuid!();
  const gid = process.getgid!();
  chownSync(dir, uid, gid);
  chmodSync(dir, 0o750);
  const socketPath = join(dir, "issuer.sock");
  const server = createServer((req, res) => {
    const send = (body: Record<string, unknown>, status = 200) => {
      const bytes = Buffer.from(JSON.stringify(body));
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": String(bytes.length),
      });
      res.end(bytes);
    };
    if (req.method === "GET" && req.url === "/health") {
      send({ ...health, ...responsePatch.health as object });
      return;
    }
    if (req.method === "POST" && req.url === "/issuer-evidence") {
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        expect(received).toEqual({ claims, observedAt: 5000 });
        const result = responsePatch.read as Record<string, unknown> | undefined;
        send({
          ok: false,
          environment: "DEV",
          result: result ?? {
            environment: "DEV",
            reason: "ISSUER_LEDGER_MISSING_OR_NOT_UNIQUE",
            readOnlySessionVerified: true,
            issuerLedgerMatched: false,
            persistedTrustedReadProven: false,
            cryptographicSignaturesVerified: false,
            privateKeyLoaded: false,
            signingPermitted: false,
            authorizationGranted: false,
            dispatchPermitted: false,
            commandCreated: false,
            releaseDecision: "NO_GO",
          },
          signingPermitted: false,
          authorizationGranted: false,
          dispatchPermitted: false,
          releaseDecision: "NO_GO",
        }, Number(responsePatch.readStatus ?? 409));
      });
      return;
    }
    send({ ok: false }, 404);
  });
  return new Promise<{
    socketPath: string;
    gid: number;
    close(): Promise<void>;
  }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      chownSync(socketPath, uid, gid);
      chmodSync(socketPath, 0o660);
      const stat = lstatSync(socketPath);
      expect(stat.isSocket()).toBe(true);
      resolve({
        socketPath,
        gid,
        async close() {
          await new Promise<void>(done => server.close(() => done()));
          rmSync(dir, { recursive: true, force: true });
        },
      });
    });
  });
}

describe("GPT02 Issue159 issuer-reader Unix socket client", () => {
  it("verifies native role/TLS/read-only health without claiming business evidence", async () => {
    const socket = await socketFixture();
    try {
      const result = await readGpt02Issue159IssuerReaderSocketHealth({
        env: { NODE_ENV: "test", GPT02_ISSUER_READER_SOCKET_GID: String(socket.gid) },
        socketPath: socket.socketPath,
      });
      expect(result.nativeRoleAuthenticated).toBe(true);
      expect(result.tlsVerified).toBe(true);
      expect(result.readOnlySessionVerified).toBe(true);
      expect(result.businessEvidenceRead).toBe(false);
      expect(result.persistedTrustedReadProven).toBe(false);
      expect(result.signingPermitted).toBe(false);
      expect(result.dispatchPermitted).toBe(false);
    } finally {
      await socket.close();
    }
  });

  it("returns a fail-closed result when no persisted issuer lineage exists", async () => {
    const socket = await socketFixture();
    try {
      const result = await readGpt02Issue159IssuerReaderSocket(
        { claims, observedAt: 5000 },
        {
          env: { NODE_ENV: "test", GPT02_ISSUER_READER_SOCKET_GID: String(socket.gid) },
          socketPath: socket.socketPath,
        },
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("ISSUER_LEDGER_MISSING_OR_NOT_UNIQUE");
      expect(result.readOnlySessionVerified).toBe(true);
      expect(result.issuerLedgerMatched).toBe(false);
      expect(result.persistedTrustedReadProven).toBe(false);
      expect(result.signingPermitted).toBe(false);
      expect(result.authorizationGranted).toBe(false);
      expect(result.dispatchPermitted).toBe(false);
      expect(result.releaseDecision).toBe("NO_GO");
    } finally {
      await socket.close();
    }
  });

  it("rejects health that attempts to claim signing or business-read authority", async () => {
    const socket = await socketFixture({
      health: { signingPermitted: true, persistedTrustedReadProven: true },
    });
    try {
      await expect(readGpt02Issue159IssuerReaderSocketHealth({
        env: { NODE_ENV: "test", GPT02_ISSUER_READER_SOCKET_GID: String(socket.gid) },
        socketPath: socket.socketPath,
      })).rejects.toThrow("GPT02_ISSUER_READER_SOCKET_HEALTH_NOT_TRUSTED");
    } finally {
      await socket.close();
    }
  });

  it("rejects a health response without verified backend TLS", async () => {
    const socket = await socketFixture({
      health: { backendTlsVerified: false },
    });
    try {
      await expect(readGpt02Issue159IssuerReaderSocketHealth({
        env: { NODE_ENV: "test", GPT02_ISSUER_READER_SOCKET_GID: String(socket.gid) },
        socketPath: socket.socketPath,
      })).rejects.toThrow("GPT02_ISSUER_READER_SOCKET_HEALTH_NOT_TRUSTED");
    } finally {
      await socket.close();
    }
  });

  it("rejects world-readable socket permissions", async () => {
    const socket = await socketFixture();
    try {
      chmodSync(socket.socketPath, 0o666);
      await expect(readGpt02Issue159IssuerReaderSocketHealth({
        env: { NODE_ENV: "test", GPT02_ISSUER_READER_SOCKET_GID: String(socket.gid) },
        socketPath: socket.socketPath,
      })).rejects.toThrow("GPT02_ISSUER_READER_SOCKET_SECURITY_INVALID");
    } finally {
      await socket.close();
    }
  });

  it("rejects missing numeric signer-group configuration", async () => {
    const socket = await socketFixture();
    try {
      await expect(readGpt02Issue159IssuerReaderSocketHealth({
        env: { NODE_ENV: "test" },
        socketPath: socket.socketPath,
      })).rejects.toThrow("GPT02_ISSUER_READER_SOCKET_GID_REQUIRED");
    } finally {
      await socket.close();
    }
  });

  it("source has no database credential, signer key, mutation or dispatch path", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../gpt02Issue159IssuerReaderSocketClient.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "createPrivateKey", "private-key.pkcs8", "SUPABASE_SERVICE_ROLE_KEY",
      "connectionString", "INSERT ", "UPDATE ", "DELETE ",
      "sign(", "dispatchPermitted: true",
    ]) expect(source).not.toContain(forbidden);
  });
});
