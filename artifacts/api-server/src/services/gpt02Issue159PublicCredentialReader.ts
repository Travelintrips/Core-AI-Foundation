import { createHash, createPublicKey } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import {
  inspectGpt02Issue159PublicRoots,
} from "./gpt02Issue159FourSignerContract.js";

const FILES = Object.freeze({
  approval: "approval-public.pem",
  hub: "hub-identity-public.pem",
  core: "core-identity-public.pem",
  issuer: "issuer-public.pem",
});
const MANIFEST = "manifest.json";
const fail = (code: string): never => {
  const error = new Error(code);
  error.name = "Gpt02Issue159PublicCredentialReaderError";
  throw error;
};

function credentialFile(directory: string, filename: string): string {
  const path = directory + "/" + filename;
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return fail("GPT02_PUBLIC_CREDENTIAL_REQUIRED");
  }
  const mode = stat.mode & 0o777;
  const allowedOwners = new Set([0, process.getuid?.() ?? -1]);
  const allowedGroups = new Set([0, process.getgid?.() ?? -1]);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      !allowedOwners.has(stat.uid) || !allowedGroups.has(stat.gid) ||
      ![0o400, 0o440, 0o600].includes(mode) ||
      stat.size < 1 || stat.size > 4096) {
    return fail("GPT02_PUBLIC_CREDENTIAL_FILE_SECURITY_INVALID");
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fail("GPT02_PUBLIC_CREDENTIAL_REQUIRED");
  }
}

function fingerprint(pem: string): string {
  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    return fail("GPT02_PUBLIC_ED25519_KEY_INVALID");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    return fail("GPT02_PUBLIC_ED25519_KEY_REQUIRED");
  }
  return createHash("sha256")
    .update(key.export({ format: "der", type: "spki" }))
    .digest("hex");
}

/**
 * Reads only the four public verifier keys and their pinned fingerprint
 * manifest from a systemd LoadCredential directory. No private key is read.
 */
export function readGpt02Issue159PublicCredentials(input: {
  directory?: string;
} = {}) {
  const synthetic = process.env.NODE_ENV === "test";
  const directory = input.directory ?? process.env.CREDENTIALS_DIRECTORY;
  if (typeof directory !== "string" || !directory.startsWith("/run/credentials/") ||
      (!synthetic && input.directory !== undefined)) {
    return fail("GPT02_PUBLIC_CREDENTIAL_DIRECTORY_NOT_PINNED");
  }
  const approvalPublicKeyPem = credentialFile(directory, FILES.approval);
  const hubPublicKeyPem = credentialFile(directory, FILES.hub);
  const corePublicKeyPem = credentialFile(directory, FILES.core);
  const issuerPublicKeyPem = credentialFile(directory, FILES.issuer);
  const manifestText = credentialFile(directory, MANIFEST);
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return fail("GPT02_PUBLIC_FINGERPRINT_MANIFEST_INVALID");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      Object.keys(manifest).sort().join(",") !== "approval,core,hub,issuer") {
    return fail("GPT02_PUBLIC_FINGERPRINT_MANIFEST_INVALID");
  }
  const roots = inspectGpt02Issue159PublicRoots({
    approvalPublicKeyPem,
    hubPublicKeyPem,
    corePublicKeyPem,
    issuerPublicKeyPem,
  });
  const actual = roots.fingerprints;
  const expected = manifest as Record<string, unknown>;
  for (const role of ["approval", "hub", "core", "issuer"] as const) {
    if (typeof expected[role] !== "string" ||
        !/^[0-9a-f]{64}$/.test(expected[role] as string) ||
        expected[role] !== actual[role]) {
      return fail("GPT02_PUBLIC_FINGERPRINT_MISMATCH");
    }
  }
  return Object.freeze({
    approvalPublicKeyPem,
    hubPublicKeyPem,
    corePublicKeyPem,
    issuerPublicKeyPem,
    fingerprints: actual,
    publicRootsVerified: true as const,
    privateKeyMaterialRead: false as const,
    signingPermitted: false as const,
    dispatchPermitted: false as const,
  });
}
