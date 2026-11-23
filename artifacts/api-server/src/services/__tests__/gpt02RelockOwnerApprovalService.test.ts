import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, transaction } = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: { execute, transaction } }));

import {
  assertExactGpt02RelockManifestScope,
  createGpt02RelockOwnerChallenge,
  digestGpt02RelockManifest,
  verifyAndRecordGpt02RelockOwnerApproval,
  type Gpt02OwnerActor,
  type Gpt02RelockManifest,
} from "../gpt02RelockOwnerApprovalService.js";

const nowMs = 1_700_000_000_000;
const actor: Gpt02OwnerActor = {
  id: "google_owner123456",
  role: "super_admin",
  companyId: "default",
  email: "owner@example.test",
  authSource: "supabase_google_identity",
  authSupabaseId: "11111111-2222-4333-8444-555555555555",
  authVerifiedAt: nowMs,
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
    issuedAt: nowMs,
    expiresAt: nowMs + 120_000,
  };
}

function txFor(challengeId: string, updateRows: unknown[] = [{ id: challengeId }]) {
  const txExecute = vi.fn()
    .mockResolvedValueOnce({ rows: updateRows })
    .mockResolvedValueOnce({ rows: [] });
  transaction.mockImplementation(async (callback: (tx: { execute: typeof txExecute }) => unknown) => callback({ execute: txExecute }));
  return txExecute;
}

describe("GPT02 relock Owner approval", () => {
  beforeEach(() => {
    execute.mockReset().mockResolvedValue({ rows: [] });
    transaction.mockReset();
  });

  it("creates only a short-lived exact DEV challenge after trusted Owner eligibility is confirmed", async () => {
    const result = await createGpt02RelockOwnerChallenge({
      actor,
      verifyOwner: async (candidate) => candidate.id === actor.id,
      nowMs,
    });
    expect(result.manifest.scope).toBe("GPT02_RELOCK_CST_DEV");
    expect(result.manifest.projectId).toBe("xssrfshdrtdfupgqwfdw");
    expect(result.manifest.workerPrincipal).toBe("openclaw-vps-main");
    expect(result.manifest.roles).toHaveLength(4);
    expect(result.manifest.timer.finalActiveState).toBe("inactive");
    expect(result.manifest.timer.finalUnitFileState).toBe("disabled");
    expect(result.manifest.expiresAt - result.manifest.issuedAt).toBe(120_000);
    expect(result.approvalMethod).toBe("FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION");
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Owner eligibility is not proven", async () => {
    await expect(createGpt02RelockOwnerChallenge({ actor, verifyOwner: async () => false, nowMs }))
      .rejects.toThrow("GPT02_OWNER_IDENTITY_NOT_ELIGIBLE");
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts only the fixed target scope and exact action list", () => {
    const manifest = manifestFixture();
    expect(() => assertExactGpt02RelockManifestScope(manifest, actor, nowMs)).not.toThrow();
    expect(() => assertExactGpt02RelockManifestScope({ ...manifest, projectId: "prod" } as Gpt02RelockManifest, actor, nowMs))
      .toThrow("GPT02_OWNER_APPROVAL_MANIFEST_SCOPE_INVALID");
    expect(() => assertExactGpt02RelockManifestScope({ ...manifest, operations: ["DISABLE_ISSUE159_TIMER"] as unknown as Gpt02RelockManifest["operations"] }, actor, nowMs))
      .toThrow("GPT02_OWNER_APPROVAL_MANIFEST_SCOPE_INVALID");
  });

  it("records an explicit Owner decision bound to the exact digest and signed session hash", async () => {
    const manifest = manifestFixture();
    const challengeId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const digest = digestGpt02RelockManifest(manifest);
    const sessionHash = createHash("sha256").update("signed-owner-session-fixture").digest("hex");
    execute.mockResolvedValueOnce({ rows: [{
      id: challengeId,
      owner_subject: manifest.ownerSubject,
      owner_auth_supabase_id: manifest.ownerAuthSupabaseId,
      owner_email: manifest.ownerEmail,
      manifest_json: manifest,
      manifest_sha256: digest,
      nonce_hash: createHash("sha256").update(manifest.nonce).digest("hex"),
      expires_at: new Date(manifest.expiresAt).toISOString(),
      status: "PENDING",
    }] });
    const txExecute = txFor(challengeId);

    const result = await verifyAndRecordGpt02RelockOwnerApproval({
      actor,
      verifyOwner: async (candidate) => candidate.authSupabaseId === actor.authSupabaseId,
      challengeId,
      manifestSha256: digest,
      signedSessionSha256: sessionHash,
      nowMs,
    });

    expect(result.recorded).toBe(true);
    expect(result.ownerIdentityCryptographicallyVerified).toBe(true);
    expect(result.explicitOwnerDecision).toBe("APPROVE");
    expect(result.executionPermitted).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
    expect(txExecute).toHaveBeenCalledTimes(2);
  });

  it("rejects a challenge if the authenticated Owner submits a different manifest digest", async () => {
    const manifest = manifestFixture();
    const challengeId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    execute.mockResolvedValueOnce({ rows: [{
      id: challengeId,
      owner_subject: manifest.ownerSubject,
      owner_auth_supabase_id: manifest.ownerAuthSupabaseId,
      owner_email: manifest.ownerEmail,
      manifest_json: manifest,
      manifest_sha256: digestGpt02RelockManifest(manifest),
      nonce_hash: createHash("sha256").update(manifest.nonce).digest("hex"),
      expires_at: new Date(manifest.expiresAt).toISOString(),
      status: "PENDING",
    }] });
    await expect(verifyAndRecordGpt02RelockOwnerApproval({
      actor,
      verifyOwner: async () => true,
      challengeId,
      manifestSha256: "a".repeat(64),
      signedSessionSha256: "b".repeat(64),
      nowMs,
    })).rejects.toThrow("GPT02_OWNER_APPROVAL_MANIFEST_DIGEST_MISMATCH");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a replay or concurrent consume when the pending challenge was already consumed", async () => {
    const manifest = manifestFixture();
    const challengeId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const digest = digestGpt02RelockManifest(manifest);
    execute.mockResolvedValueOnce({ rows: [{
      id: challengeId,
      owner_subject: manifest.ownerSubject,
      owner_auth_supabase_id: manifest.ownerAuthSupabaseId,
      owner_email: manifest.ownerEmail,
      manifest_json: manifest,
      manifest_sha256: digest,
      nonce_hash: createHash("sha256").update(manifest.nonce).digest("hex"),
      expires_at: new Date(manifest.expiresAt).toISOString(),
      status: "PENDING",
    }] });
    const txExecute = txFor(challengeId, []);
    await expect(verifyAndRecordGpt02RelockOwnerApproval({
      actor, verifyOwner: async () => true, challengeId, manifestSha256: digest,
      signedSessionSha256: "b".repeat(64), nowMs,
    })).rejects.toThrow("GPT02_OWNER_APPROVAL_NONCE_REPLAY_OR_RACE");
    expect(txExecute).toHaveBeenCalledTimes(1);
  });

  it("hashes the full canonical manifest including nonce and expiry", () => {
    const manifest = manifestFixture();
    expect(digestGpt02RelockManifest(manifest)).toMatch(/^[a-f0-9]{64}$/);
    expect(digestGpt02RelockManifest({ ...manifest, nonce: "z".repeat(43) })).not.toBe(digestGpt02RelockManifest(manifest));
  });
});
