import { lstatSync } from "node:fs";
import { dirname } from "node:path";
import { request as httpRequest } from "node:http";

const DEFAULT_SOCKET = "/run/gpt02-issuer-reader/reader.sock";
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024;

const fail = (code: string): never => {
  const error = new Error(code);
  error.name = "Gpt02IssuerReaderSocketClientError";
  throw error;
};

type RecordValue = Record<string, unknown>;

function exactObject(value: unknown, fields: readonly string[]): value is RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as RecordValue).sort().join(",") ===
    [...fields].sort().join(",");
}

function expectedGroupGid(env: Record<string, string | undefined>): number {
  const value = env.GPT02_ISSUER_READER_SOCKET_GID;
  const gid = Number(value);
  if (!value || !Number.isSafeInteger(gid) || gid <= 0) {
    return fail("GPT02_ISSUER_READER_SOCKET_GID_REQUIRED");
  }
  return gid;
}

function assertSocket(socketPath: string, gid: number, synthetic: boolean) {
  let directory;
  let socket;
  try {
    directory = lstatSync(dirname(socketPath));
    socket = lstatSync(socketPath);
  } catch {
    return fail("GPT02_ISSUER_READER_SOCKET_REQUIRED");
  }
  if ((!synthetic && socketPath !== DEFAULT_SOCKET) ||
      !directory.isDirectory() || directory.isSymbolicLink() ||
      directory.uid === 0 || directory.gid !== gid ||
      (directory.mode & 0o777) !== 0o750 ||
      !socket.isSocket() || socket.uid !== directory.uid ||
      socket.gid !== gid || (socket.mode & 0o777) !== 0o660) {
    return fail("GPT02_ISSUER_READER_SOCKET_SECURITY_INVALID");
  }
}

async function requestReader(
  socketPath: string,
  method: "GET" | "POST",
  path: "/health" | "/issuer-evidence",
  body?: unknown,
): Promise<{ status: number; body: RecordValue }> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  if (payload && payload.length > MAX_REQUEST_BYTES) {
    return fail("GPT02_ISSUER_READER_REQUEST_TOO_LARGE");
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      socketPath,
      path,
      method,
      headers: payload ? {
        "content-type": "application/json",
        "content-length": String(payload.length),
      } : {},
    }, response => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", chunk => {
        const value = Buffer.from(chunk);
        bytes += value.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("GPT02_ISSUER_READER_RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(value);
      });
      response.on("end", () => {
        let parsed: unknown;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { reject(new Error("GPT02_ISSUER_READER_RESPONSE_INVALID")); return; }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("GPT02_ISSUER_READER_RESPONSE_INVALID"));
          return;
        }
        resolve({ status: response.statusCode ?? 0, body: parsed as RecordValue });
      });
      response.on("error", () => reject(new Error("GPT02_ISSUER_READER_RESPONSE_FAILED")));
    });
    req.setTimeout(10_000, () => req.destroy(new Error("GPT02_ISSUER_READER_TIMEOUT")));
    req.on("error", () => reject(new Error("GPT02_ISSUER_READER_SOCKET_UNAVAILABLE")));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Health is a native role/TLS/read-only-session proof, not business evidence. */
export async function readGpt02Issue159IssuerReaderSocketHealth(options: {
  env?: Record<string, string | undefined>;
  socketPath?: string;
} = {}) {
  const env = options.env ?? process.env;
  const synthetic = env.NODE_ENV === "test";
  const socketPath = synthetic ? (options.socketPath ?? DEFAULT_SOCKET) : DEFAULT_SOCKET;
  const gid = expectedGroupGid(env);
  assertSocket(socketPath, gid, synthetic);
  const response = await requestReader(socketPath, "GET", "/health");
  const b = response.body;
  if (response.status !== 200 ||
      !exactObject(b, [
        "ok", "environment", "readerReady", "issuerRole", "tlsVerified",
        "readOnly", "signingPermitted", "authorizationGranted",
        "dispatchPermitted", "releaseDecision",
      ]) ||
      b.ok !== true || b.environment !== "DEV" ||
      b.readerReady !== true ||
      b.issuerRole !== "gpt02_issuer_evidence_reader" ||
      b.tlsVerified !== true || b.readOnly !== true ||
      b.signingPermitted !== false || b.authorizationGranted !== false ||
      b.dispatchPermitted !== false || b.releaseDecision !== "NO_GO") {
    fail("GPT02_ISSUER_READER_SOCKET_HEALTH_NOT_TRUSTED");
  }
  return Object.freeze({
    environment: "DEV" as const,
    nativeRoleAuthenticated: true as const,
    tlsVerified: true as const,
    readOnlySessionVerified: true as const,
    businessEvidenceRead: false as const,
    persistedTrustedReadProven: false as const,
    signingPermitted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
    releaseDecision: "NO_GO" as const,
  });
}

/** Reads a single persisted lineage through the isolated issuer-reader socket. */
export async function readGpt02Issue159IssuerReaderSocket(input: unknown, options: {
  env?: Record<string, string | undefined>;
  socketPath?: string;
} = {}) {
  if (!exactObject(input, ["claims", "observedAt"])) {
    fail("GPT02_ISSUER_READER_SOCKET_REQUEST_INVALID");
  }
  const env = options.env ?? process.env;
  const synthetic = env.NODE_ENV === "test";
  const socketPath = synthetic ? (options.socketPath ?? DEFAULT_SOCKET) : DEFAULT_SOCKET;
  const gid = expectedGroupGid(env);
  assertSocket(socketPath, gid, synthetic);
  const response = await requestReader(socketPath, "POST", "/issuer-evidence", input);
  const envelope = response.body;
  if (![200, 409, 400, 413].includes(response.status) ||
      !exactObject(envelope, [
        "ok", "environment", "result", "signingPermitted",
        "authorizationGranted", "dispatchPermitted", "releaseDecision",
      ]) ||
      envelope.environment !== "DEV" ||
      typeof envelope.ok !== "boolean" ||
      envelope.signingPermitted !== false ||
      envelope.authorizationGranted !== false ||
      envelope.dispatchPermitted !== false ||
      envelope.releaseDecision !== "NO_GO" ||
      !envelope.result || typeof envelope.result !== "object" ||
      Array.isArray(envelope.result)) {
    fail("GPT02_ISSUER_READER_SOCKET_RESPONSE_NOT_TRUSTED");
  }
  const result = envelope.result as RecordValue;
  if (typeof result.reason !== "string" ||
      typeof result.readOnlySessionVerified !== "boolean" ||
      typeof result.issuerLedgerMatched !== "boolean" ||
      typeof result.persistedTrustedReadProven !== "boolean" ||
      result.signingPermitted !== false ||
      result.authorizationGranted !== false ||
      result.dispatchPermitted !== false ||
      result.commandCreated !== false ||
      result.releaseDecision !== "NO_GO") {
    fail("GPT02_ISSUER_READER_SOCKET_RESULT_NOT_TRUSTED");
  }
  const normalized = Object.freeze({
    ok: envelope.ok,
    environment: "DEV" as const,
    reason: result.reason,
    readOnlySessionVerified: result.readOnlySessionVerified,
    issuerLedgerMatched: result.issuerLedgerMatched,
    persistedTrustedReadProven: result.persistedTrustedReadProven,
    trustedReadProof: result.trustedReadProof ?? null,
    signingPermitted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
    commandCreated: false as const,
    releaseDecision: "NO_GO" as const,
  });
  if (response.status === 200 &&
      (normalized.ok !== true || normalized.issuerLedgerMatched !== true ||
       normalized.persistedTrustedReadProven !== true || !normalized.trustedReadProof)) {
    fail("GPT02_ISSUER_READER_SOCKET_SUCCESS_PROOF_INVALID");
  }
  if (response.status !== 200 && normalized.ok !== false) {
    fail("GPT02_ISSUER_READER_SOCKET_FAILURE_NOT_CLOSED");
  }
  return normalized;
}
