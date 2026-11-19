/**
 * CST one-job DEV fixed-destination PostgreSQL socket broker -- NOT launched.
 *
 * This module contains only an inert security contract and an OFFLINE test
 * harness. It does not listen at module import, and intentionally has NO
 * authorized production starter until independently verified egress ACL,
 * fixed DEV-only pooler destination, UDS identity/permissions and recovery.
 *
 * PG TLS, SNI, hostname certificate verification and user authentication
 * remain end-to-end inside node-postgres; the broker never terminates TLS,
 * reads credentials, chooses an endpoint from client data or stores packets.
 */
import { createServer } from "node:net";
import { lstatSync, chmodSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

export const CST_DEV_FIXED_POOLER = Object.freeze({
  host: "aws-1-ap-southeast-2.pooler.supabase.com",
  port: 6543,
  project: "xssrfshdrtdfupgqwfdw",
});
export const CST_DEV_FIXED_SOCKET = "/run/cst-onejob-dev-db/pg-pooler.sock";

function denied(code) {
  return new Error("CST_ONEJOB_BROKER_" + code);
}

export function assertSafeSocketLocation(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    throw denied("INVALID_SOCKET_PATH");
  }
  let parent;
  try { parent = lstatSync(dirname(path)); }
  catch { throw denied("SOCKET_PARENT_UNAVAILABLE"); }
  if (!parent.isDirectory() || parent.isSymbolicLink() ||
      (parent.mode & 0o022) !== 0) {
    throw denied("INSECURE_SOCKET_PARENT");
  }
  try {
    lstatSync(path); // Also detects dangling symlinks (existsSync would miss).
    throw denied("SOCKET_ALREADY_OCCUPIED");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

/**
 * TEST-ONLY implementation of the exact byte tunnel. `dialMock` comes from
 * a local test, not a client handshake, environment URL or runtime setting.
 * A real-pooler connector is deliberately absent in this module.
 */
export async function startOfflineMockBroker({
  socketPath, dialMock, maxConnections = 1, idleTimeoutMs = 5_000,
} = {}) {
  if (typeof dialMock !== "function" ||
      !Number.isSafeInteger(maxConnections) || maxConnections !== 1 ||
      !Number.isSafeInteger(idleTimeoutMs) ||
      idleTimeoutMs < 250 || idleTimeoutMs > 30_000) {
    throw denied("OFFLINE_TEST_ARGS_DENIED");
  }
  assertSafeSocketLocation(socketPath);
  let active = 0, rejected = 0, forwarded = 0;
  const sockets = new Set();
  const server = createServer({ allowHalfOpen: false }, inbound => {
    sockets.add(inbound);
    if (active >= 1) {
      rejected++;
      inbound.destroy();
      sockets.delete(inbound);
      return;
    }
    active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      sockets.delete(inbound);
    };
    inbound.pause();
    let upstream;
    try { upstream = dialMock(); }
    catch { inbound.destroy(); release(); return; }
    if (!upstream || typeof upstream.pipe !== "function" ||
        typeof upstream.destroy !== "function") {
      inbound.destroy();
      release();
      return;
    }
    sockets.add(upstream);
    const tearDown = () => { inbound.destroy(); upstream.destroy(); };
    inbound.setTimeout(idleTimeoutMs, tearDown);
    upstream.setTimeout(idleTimeoutMs, tearDown);
    upstream.once("error", tearDown);
    inbound.once("error", tearDown);
    inbound.once("close", () => {
      release();
      sockets.delete(upstream);
      upstream.destroy();
    });
    upstream.once("close", () => {
      sockets.delete(upstream);
      inbound.destroy();
    });
    upstream.once("connect", () => {
      forwarded++;
      inbound.pipe(upstream);
      upstream.pipe(inbound);
      inbound.resume();
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    chmodSync(socketPath, 0o600);
  } catch {
    // Do not unlink anything explicitly on a failed bind: it might be an
    // existing socket/symlink from another process. close() cleans up only
    // a listener that this process successfully created.
    if (server.listening) await new Promise(resolve => server.close(resolve));
    throw denied("SOCKET_BIND_FAILED");
  }
  let closed = false;
  return {
    destination: CST_DEV_FIXED_POOLER,
    socketPath,
    snapshot: () => Object.freeze({ active, rejected, forwarded }),
    close: async () => {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      // Node normally unlinks its Unix socket when server.close completes.
    },
  };
}

/** Not a feature flag. No code path may launch a real broker yet. */
export function startOperationalCstDevBroker() {
  throw denied("INDEPENDENT_ACL_AND_DB_TRANSPORT_NOT_VERIFIED");
}
