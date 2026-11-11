import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createGpt02Issue159IssuerTrustedReader,
} from "../../artifacts/api-server/src/services/gpt02Issue159IssuerTrustedReader.js";

const DEFAULT_RUNTIME_DIRECTORY = "/run/gpt02-issuer-reader";
const DEFAULT_PRIVATE_RUNTIME_DIRECTORY = "/run/private/gpt02-issuer-reader";
const DEFAULT_SOCKET = DEFAULT_RUNTIME_DIRECTORY + "/reader.sock";
const MAX_BODY_BYTES = 8 * 1024;

const fail = (code: string): never => {
  throw new Error(code);
};

/**
 * systemd moves RuntimeDirectory paths for DynamicUser services below
 * /run/private and leaves a public symlink at the configured path. Accept
 * only that exact systemd-managed symlink target; do not follow arbitrary
 * symlinks for the issuer socket directory.
 */
export function assertIssuerReaderRuntimeDirectory(
  parentPath: string,
  options: {
    expectedPublicPath?: string;
    expectedPrivatePath?: string;
    expectedUid: number;
    expectedGid: number;
  },
): string {
  const expectedPublicPath = options.expectedPublicPath ?? DEFAULT_RUNTIME_DIRECTORY;
  const expectedPrivatePath = options.expectedPrivatePath ?? DEFAULT_PRIVATE_RUNTIME_DIRECTORY;
  if (parentPath !== expectedPublicPath) {
    return fail("ISSUER_READER_SOCKET_DIRECTORY_PATH_INVALID");
  }

  const entry = fs.lstatSync(parentPath);
  let resolvedPath = parentPath;
  if (entry.isSymbolicLink()) {
    resolvedPath = fs.realpathSync(parentPath);
    if (resolvedPath !== expectedPrivatePath) {
      return fail("ISSUER_READER_SOCKET_DIRECTORY_SYMLINK_INVALID");
    }
  }

  const directory = fs.statSync(parentPath);
  if (!directory.isDirectory() ||
      directory.uid !== options.expectedUid ||
      directory.gid !== options.expectedGid ||
      (directory.mode & 0o777) !== 0o750) {
    return fail("ISSUER_READER_SOCKET_DIRECTORY_SECURITY_INVALID");
  }
  return resolvedPath;
}

function codeOf(error: unknown): string {
  const value = error as { code?: unknown; message?: unknown };
  const code = typeof value?.code === "string"
    ? value.code
    : typeof value?.message === "string" ? value.message : "";
  return /^[A-Z0-9_:-]{1,100}$/.test(code)
    ? code : "ISSUER_READ_FAILED_CLOSED";
}

function respond(res: ServerResponse, status: number, payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!String(req.headers["content-type"] || "")
    .toLowerCase().startsWith("application/json")) {
    return fail("JSON_REQUIRED");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY_BYTES) return fail("REQUEST_TOO_LARGE");
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return fail("JSON_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("JSON_OBJECT_REQUIRED");
  }
  const keys = Object.keys(parsed as Record<string, unknown>).sort().join(",");
  if (keys !== "claims,observedAt") return fail("ISSUER_READ_REQUEST_SHAPE_INVALID");
  return parsed;
}

function nativeHealthIsTrusted(health: Awaited<ReturnType<ReturnType<
  typeof createGpt02Issue159IssuerTrustedReader
>["health"]>>) {
  return health.readOnlySessionVerified === true &&
    health.nativeRoleAuthenticated === true &&
    health.tlsVerified === true &&
    health.operationalTrustedReaderRuntime === true &&
    health.signingPermitted === false &&
    health.authorizationGranted === false &&
    health.dispatchPermitted === false &&
    health.releaseDecision === "NO_GO";
}

export function createIssuerReaderServer({
  reader,
}: {
  reader: ReturnType<typeof createGpt02Issue159IssuerTrustedReader>;
}) {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      try {
        const health = await reader.health();
        const ok = nativeHealthIsTrusted(health);
        respond(res, ok ? 200 : 503, {
          ok,
          environment: "DEV",
          readerReady: ok,
          issuerRole: "gpt02_issuer_evidence_reader",
          tlsVerified: ok,
          readOnly: ok,
          signingPermitted: false,
          authorizationGranted: false,
          dispatchPermitted: false,
          releaseDecision: "NO_GO",
        });
      } catch (error) {
        respond(res, 503, {
          ok: false,
          readerReady: false,
          code: codeOf(error),
          signingPermitted: false,
          authorizationGranted: false,
          dispatchPermitted: false,
          releaseDecision: "NO_GO",
        });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/issuer-evidence") {
      let input: unknown;
      try {
        input = await readJson(req);
      } catch (error) {
        const code = codeOf(error);
        respond(res, code === "REQUEST_TOO_LARGE" ? 413 : 400, {
          ok: false,
          code,
          signingPermitted: false,
          authorizationGranted: false,
          dispatchPermitted: false,
          releaseDecision: "NO_GO",
        });
        return;
      }

      try {
        const result = await reader.read(input);
        const ok = result.persistedTrustedReadProven === true &&
          result.signingPermitted === false &&
          result.authorizationGranted === false &&
          result.dispatchPermitted === false &&
          result.releaseDecision === "NO_GO";
        respond(res, ok ? 200 : 409, {
          ok,
          environment: "DEV",
          result,
          signingPermitted: false,
          authorizationGranted: false,
          dispatchPermitted: false,
          releaseDecision: "NO_GO",
        });
      } catch (error) {
        respond(res, 503, {
          ok: false,
          code: codeOf(error),
          signingPermitted: false,
          authorizationGranted: false,
          dispatchPermitted: false,
          releaseDecision: "NO_GO",
        });
      }
      return;
    }

    respond(res, 404, {
      ok: false,
      code: "NOT_FOUND",
      signingPermitted: false,
      authorizationGranted: false,
      dispatchPermitted: false,
      releaseDecision: "NO_GO",
    });
  });

  server.headersTimeout = 5_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 16;
  return server;
}

export async function startIssuerReaderRuntime() {
  if (process.env.NODE_ENV !== "development" ||
      process.env.APP_ENV !== "development") {
    return fail("ISSUER_READER_EXPLICIT_DEV_MODE_REQUIRED");
  }

  const reader = createGpt02Issue159IssuerTrustedReader({ env: process.env });
  let server: ReturnType<typeof createIssuerReaderServer> | undefined;
  const socketPath = process.env.GPT02_ISSUER_READER_SOCKET || DEFAULT_SOCKET;

  try {
    const initial = await reader.health();
    if (!nativeHealthIsTrusted(initial)) {
      return fail("ISSUER_READER_INITIAL_NATIVE_HEALTH_FAILED");
    }

    server = createIssuerReaderServer({ reader });
    const parent = path.dirname(socketPath);
    const groupName = "gpt02-issue159-signers";
    const groupLine = fs.readFileSync("/etc/group", "utf8")
      .split(/\r?\n/)
      .find((line) => line.startsWith(groupName + ":"));
    const gid = Number(groupLine?.split(":")[2]);

    if (!Number.isSafeInteger(gid) || gid <= 0 ||
        !Number.isSafeInteger(process.getuid?.()) ||
        process.getgid?.() !== gid) {
      return fail("ISSUER_READER_SOCKET_DIRECTORY_IDENTITY_INVALID");
    }
    assertIssuerReaderRuntimeDirectory(parent, {
      expectedUid: process.getuid!(),
      expectedGid: gid,
    });

    if (fs.existsSync(socketPath)) {
      const existing = fs.lstatSync(socketPath);
      if (!existing.isSocket() ||
          existing.uid !== process.getuid?.() ||
          existing.gid !== gid) {
        return fail("ISSUER_READER_SOCKET_OCCUPIED");
      }
      fs.unlinkSync(socketPath);
    }

    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(socketPath, () => {
        server!.removeListener("error", reject);
        resolve();
      });
    });

    fs.chownSync(socketPath, process.getuid!(), gid);
    fs.chmodSync(socketPath, 0o660);
    const socket = fs.lstatSync(socketPath);
    if (!socket.isSocket() || socket.uid !== process.getuid?.() ||
        socket.gid !== gid || (socket.mode & 0o777) !== 0o660) {
      return fail("ISSUER_READER_SOCKET_MODE_INVALID");
    }

    process.stdout.write(JSON.stringify({
      event: "gpt02_issuer_reader_runtime_started",
      environment: "DEV",
      socketPath,
      role: "gpt02_issuer_evidence_reader",
      tlsVerified: true,
      readOnly: true,
      signingPermitted: false,
      authorizationGranted: false,
      dispatchPermitted: false,
      releaseDecision: "NO_GO",
    }) + "\n");

    const shutdown = () => {
      server!.close(async () => {
        try { await reader.close(); } catch { /* fail-closed */ }
        try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch { /* fail-closed */ }
        process.exit(0);
      });
      server!.closeAllConnections?.();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    return { server, reader, socketPath };
  } catch (error) {
    if (server) try { server.close(); } catch { /* fail-closed */ }
    try { await reader.close(); } catch { /* fail-closed */ }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startIssuerReaderRuntime().catch((error) => {
    process.stderr.write(JSON.stringify({
      event: "gpt02_issuer_reader_runtime_start_failed",
      code: codeOf(error),
      environment: "DEV",
      signingPermitted: false,
      authorizationGranted: false,
      dispatchPermitted: false,
      releaseDecision: "NO_GO",
    }) + "\n");
    process.exitCode = 1;
  });
}
