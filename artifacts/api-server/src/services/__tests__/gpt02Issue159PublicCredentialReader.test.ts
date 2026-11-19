import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  readGpt02Issue159PublicCredentials,
} from "../gpt02Issue159PublicCredentialReader.js";

function key() {
  const pair = generateKeyPairSync("ed25519");
  const pem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  const fingerprint = createHash("sha256")
    .update(pair.publicKey.export({ format: "der", type: "spki" }))
    .digest("hex");
  return { pem, fingerprint };
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "gpt02-public-credentials-"));
  const keys = {
    approval: key(),
    hub: key(),
    core: key(),
    issuer: key(),
  };
  const files = {
    approval: "approval-public.pem",
    hub: "hub-identity-public.pem",
    core: "core-identity-public.pem",
    issuer: "issuer-public.pem",
  };
  for (const role of ["approval", "hub", "core", "issuer"] as const) {
    writeFileSync(join(dir, files[role]), keys[role].pem, { mode: 0o600 });
    chmodSync(join(dir, files[role]), 0o600);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    approval: keys.approval.fingerprint,
    hub: keys.hub.fingerprint,
    core: keys.core.fingerprint,
    issuer: keys.issuer.fingerprint,
  }), { mode: 0o600 });
  chmodSync(join(dir, "manifest.json"), 0o600);
  return { dir, keys, files };
}

describe("GPT02 Issue159 systemd public verifier credentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads four independent Ed25519 public keys and matches the pinned manifest", () => {
    vi.stubEnv("NODE_ENV", "test");
    const f = fixture();
    try {
      const result = readGpt02Issue159PublicCredentials({ directory: f.dir });
      expect(result.publicRootsVerified).toBe(true);
      expect(result.privateKeyMaterialRead).toBe(false);
      expect(result.signingPermitted).toBe(false);
      expect(result.dispatchPermitted).toBe(false);
      expect(result.fingerprints.approval).toBe(f.keys.approval.fingerprint);
      expect(result.fingerprints.hub).toBe(f.keys.hub.fingerprint);
      expect(result.fingerprints.core).toBe(f.keys.core.fingerprint);
      expect(result.fingerprints.issuer).toBe(f.keys.issuer.fingerprint);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("rejects a changed public key fingerprint", () => {
    vi.stubEnv("NODE_ENV", "test");
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "manifest.json"), JSON.stringify({
        approval: "0".repeat(64),
        hub: f.keys.hub.fingerprint,
        core: f.keys.core.fingerprint,
        issuer: f.keys.issuer.fingerprint,
      }), { mode: 0o600 });
      chmodSync(join(f.dir, "manifest.json"), 0o600);
      expect(() => readGpt02Issue159PublicCredentials({ directory: f.dir }))
        .toThrow("GPT02_PUBLIC_FINGERPRINT_MISMATCH");
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("rejects public-key symlinks and world-readable credential files", () => {
    vi.stubEnv("NODE_ENV", "test");
    const f = fixture();
    try {
      const path = join(f.dir, "hub-identity-public.pem");
      const target = join(f.dir, "hub-real.pem");
      writeFileSync(target, f.keys.hub.pem, { mode: 0o600 });
      chmodSync(target, 0o600);
      rmSync(path);
      symlinkSync(target, path);
      expect(() => readGpt02Issue159PublicCredentials({ directory: f.dir }))
        .toThrow("GPT02_PUBLIC_CREDENTIAL_FILE_SECURITY_INVALID");
      rmSync(path);
      writeFileSync(path, f.keys.hub.pem, { mode: 0o644 });
      chmodSync(path, 0o644);
      expect(() => readGpt02Issue159PublicCredentials({ directory: f.dir }))
        .toThrow("GPT02_PUBLIC_CREDENTIAL_FILE_SECURITY_INVALID");
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("does not allow production callers to override the systemd credential directory", () => {
    vi.stubEnv("NODE_ENV", "production");
    const f = fixture();
    try {
      expect(() => readGpt02Issue159PublicCredentials({ directory: f.dir }))
        .toThrow("GPT02_PUBLIC_CREDENTIAL_DIRECTORY_NOT_PINNED");
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });
});
