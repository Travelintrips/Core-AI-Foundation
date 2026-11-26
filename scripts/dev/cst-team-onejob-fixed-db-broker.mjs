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
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lstatSync, chmodSync } from "node:fs";
import { dirname, isAbsolute, normalize } from "node:path";

export const CST_DEV_FIXED_POOLER = Object.freeze({
  host: "aws-1-ap-southeast-2.pooler.supabase.com",
  port: 6543,
  project: "xssrfshdrtdfupgqwfdw",
});
export const CST_DEV_FIXED_SOCKET = "/run/cst-onejob-dev-db/pg-pooler.sock";

// The existing Python verifier uses kernel SO_PEERCRED on an inherited
// accepted fd. File descriptor 3 is passed directly, never serialized as
// client-supplied UID strings. The helper does not read PostgreSQL bytes.
const PEER_VERIFIER = fileURLToPath(new URL("./cst_team_onejob_peercred.py", import.meta.url));
const PEER_VERIFIED = "CST_ONEJOB_KERNEL_PEER_VERIFIED";
function validPositiveId(n) {
  return Number.isSafeInteger(n) && n>0 && n<=60000;
}
function verifyAcceptedPeerWithKernel(inbound, identity) {
  return new Promise(resolve => {
    let settled=false, output="";
    let child;
    const settle=(ok)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      resolve(ok===true);
    };
    try {
      child=spawn("/usr/bin/python3",[
        "-I", PEER_VERIFIER, "--check-accepted-fd3",
        String(identity.uid), String(identity.gid),
      ],{
        stdio:["ignore","pipe","ignore",inbound],
        env:{PYTHONNOUSERSITE:"1"},
      });
    } catch { resolve(false); return; }
    const timer=setTimeout(()=>{child.kill("SIGKILL");settle(false)},2000);
    child.stdout.on("data",buffer=>{
      output+=buffer.toString("utf8");
      if(output.length>128) {child.kill("SIGKILL");settle(false);}
    });
    child.once("error",()=>settle(false));
    child.once("close",code=>settle(code===0 && output.trim()===PEER_VERIFIED));
  });
}


function denied(code) {
  return new Error("CST_ONEJOB_BROKER_" + code);
}

export function assertSafeSocketLocation(path) {
  if (typeof path !== "string" || !isAbsolute(path) ||
      normalize(path) !== path || path.includes("\0")) {
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
  // If supplied, the accepted socket MUST pass real Linux SO_PEERCRED before
  // any bytes are read or upstream connection is created. Undefined preserves
  // the pre-existing inert mock broker tests, not operational authorization.
  peerIdentity = undefined,
} = {}) {
  if (typeof dialMock !== "function" ||
      !Number.isSafeInteger(maxConnections) || maxConnections !== 1 ||
      !Number.isSafeInteger(idleTimeoutMs) ||
      idleTimeoutMs < 250 || idleTimeoutMs > 30_000) {
    throw denied("OFFLINE_TEST_ARGS_DENIED");
  }
  if (peerIdentity!==undefined && (
      !peerIdentity || !validPositiveId(peerIdentity.uid) ||
      !validPositiveId(peerIdentity.gid) ||
      (typeof process.getuid==="function" && process.getuid()===peerIdentity.uid)
  )) throw denied("INVALID_OR_SHARED_PEER_IDENTITY");
  assertSafeSocketLocation(socketPath);
  let active = 0, rejected = 0, forwarded = 0, kernelPeerVerified = 0;
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
    // Close during verification must release the one-session lease. The
    // forwarding path reuses the idempotent release function.
    inbound.once("close", release);
    const beginForwarding = () => {
    if (inbound.destroyed) { release(); return; }
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
      if (inbound.destroyed) { upstream.destroy(); return; }
      forwarded++;
      inbound.pipe(upstream);
      upstream.pipe(inbound);
      inbound.resume();
    });
    };
    if (peerIdentity===undefined) beginForwarding();
    else verifyAcceptedPeerWithKernel(inbound,peerIdentity)
      .then(ok=>{
        if (!ok || inbound.destroyed) {
          rejected++;
          inbound.destroy();
          release();
          return;
        }
        kernelPeerVerified++;
        beginForwarding();
      })
      .catch(()=>{
        rejected++;
        inbound.destroy();
        release();
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
    chmodSync(socketPath, peerIdentity ? 0o660 : 0o600);
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
    snapshot: () => Object.freeze({
      active, rejected, forwarded,
      ...(peerIdentity ? {kernelPeerVerified} : {}),
    }),
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
