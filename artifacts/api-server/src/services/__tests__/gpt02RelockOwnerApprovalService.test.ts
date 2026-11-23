import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, transaction } = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute, transaction },
}));

import {
  createGpt02RelockOwnerChallenge,
  digestGpt02RelockManifest,
  getGpt02RelockOwnerApprovalReadiness,
  verifyGpt02RelockOwnerSignatureWithKey,
  type Gpt02OwnerActor,
  type Gpt02RelockManifest,
} from "../gpt02RelockOwnerApprovalService.js";

const actor: Gpt02OwnerActor = {
  id: "google_owner123456",
  role: "super_admin",
  companyId: "default",
  email: "owner@example.test",
  authSource: "supabase_google_identity",
  authSupabaseId: "11111111-2222-4333-8444-555555555555",
  authVerifiedAt: 1_700_000_000_000,
};

function manifestFixture(): Gpt02RelockManifest {
  return {
    version: 1,
    environment: "DEV",
    scope: "GPT02_RELOCK_CST_DEV",
    projectId: "xssrfshdrtdfupgqwfdw",
    database: "postgres",
    hostId: "srv1792369",
    workerPrincipal: "openclaw-vps-main",
    roles: [
      { name: "dev_gpt02_relock_catalog_auditor", canLogin: false, connectionLimit: 0, passwordState: "PRESERVE_PRESENT" },
      { name: "dev_gpt02_attestor_evidence", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
      { name: "dev_gpt02_issuer_evidence", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
      { name: "gpt02_issuer_evidence_reader", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
    ],
    timer: { unit: "gpt02-issue159-relock-catalog-auditor.timer", finalActiveState: "inactive", finalUnitFileState: "disabled" },
    service: { unit: "gpt02-issue159-relock-catalog-auditor.service", finalActiveState: "inactive", finalMainPid: 0 },
    credential: { source: "/etc/credstore.encrypted/gpt02-issue159-relock-catalog-dsn", regularFile: true, symlink: false, mode: "0600", owner: "root", group: "root", contentRead: false, decrypted: false },
    operations: ["DISABLE_ISSUE159_TIMER", "SET_EVIDENCE_ROLES_NOLOGIN_LIMIT0_PASSWORD_NULL", "SET_AUDITOR_NOLOGIN_LIMIT0_PRESERVE_PASSWORD"],
    preconditions: { rolesFound: 4, activeSessions: 0, openWatchdogRows: 0, serviceIdle: true, noConcurrentSupervisorRun: true },
    postconditions: { allRoleInvariantsPass: true, activeSessions: 0, openWatchdogRows: 0, timerInactiveDisabled: true, serviceIdle: true, credentialMetadataPass: true },
    ownerSubject: "owner:google_owner123456",
    ownerAuthSupabaseId: "11111111-2222-4333-8444-555555555555",
    ownerEmail: "owner@example.test",
    requestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    nonce: "n".repeat(43),
    issuedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_120_000,
  };
}

describe("GPT02 relock Owner approval", () => {
  beforeEach(() => {
    execute.mockReset().mockResolvedValue({ rows: [] });
    transaction.mockReset();
  });

  it("creates only an exact DEV challenge after trusted Owner eligibility is confirmed", async () => {
    const result = await createGpt02RelockOwnerChallenge({
      actor,
      verifyOwner: async (candidate) => candidate.id === actor.id,
      nowMs: actor.authVerifiedAt,
    });

    expect(result.manifest.scope).toBe("GPT02_RELOCK_CST_DEV");
    expect(result.manifest.projectId).toBe("xssrfshdrtdfupgqwfdw");
    expect(result.manifest.workerPrincipal).toBe("openclaw-vps-main");
    expect(result.manifest.roles).toHaveLength(4);
    expect(result.manifest.timer.finalActiveState).toBe("inactive");
    expect(result.manifest.timer.finalUnitFileState).toBe("disabled");
    expect(result.manifest.expiresAt - result.manifest.issuedAt).toBe(120_000);
    expect(result.signatureAlgorithm).toBe("Ed25519");
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("PASSWORD_HASH");
  });

  it("fails closed when Owner eligibility is not proven", async () => {
    await expect(createGpt02RelockOwnerChallengeWithDeniedOwner()).rejects.toThrow(
      "GPT02_OWNER_IDENTITY_NOT_ELIGIBLE",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("verifies an Ed25519 signature over the exact canonical manifest", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const manifest = manifestFixture();
    const payload = Buffer.from(
      `CST_GPT02_RELOCK_OWNER_APPROVAL_V1\n${stableCanonicalForTest(manifest)}`,
      "utf8",
    );
    const signature = sign(null, payload, privateKey).toString("base64url");

    expect(verifyGpt02RelockOwnerSignatureWithKey({ manifest, signature, publicKey })).toBe(true);
    expect(verifyGpt02RelockOwnerSignatureWithKey({
      manifest: { ...manifest, projectId: "prod-project-not-allowed" } as Gpt02RelockManifest,
      signature,
      publicKey,
    })).toBe(false);
    expect(verifyGpt02RelockOwnerSignatureWithKey({ manifest, signature: "not-a-signature", publicKey })).toBe(false);
  });

  it("does not report readiness without the dedicated GPT02 trust anchor", async () => {
    const readiness = await getGpt02RelockOwnerApprovalReadiness();
    expect(readiness.task189KeyFallbackPermitted).toBe(false);
    expect(readiness.runtimeRouteIntegrated).toBe(false);
  });

  it("hashes the full canonical manifest including nonce and expiry", () => {
    const manifest = manifestFixture();
    expect(digestGpt02RelockManifest(manifest)).toMatch(/^[a-f0-9]{64}$/);
    expect(digestGpt02RelockManifest({ ...manifest, nonce: "z".repeat(43) })).not.toBe(
      digestGpt02RelockManifest(manifest),
    );
  });
});

async function createGpt02RelockOwnerChallengeWithDeniedOwner() {
  return createGpt02RelockOwnerChallenge({ actor, verifyOwner: async () => false, nowMs: actor.authVerifiedAt });
}

function stableCanonicalForTest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCanonicalForTest).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalForTest(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
