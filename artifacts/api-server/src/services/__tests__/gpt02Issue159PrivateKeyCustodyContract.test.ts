import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  GPT02_ISSUE159_PRIVATE_KEY_CUSTODY,
  assessGpt02Issue159PrivateKeyCustodyHost,
} from "../gpt02Issue159PrivateKeyCustodyContract.js";

const host = (patch: Record<string, unknown> = {}) => ({
  systemdVersion: 255,
  systemdCredsAvailable: true,
  encryptedStoreDirectory: "/etc/credstore.encrypted",
  encryptedStoreMode: "0700",
  encryptedStoreOwnerUid: 0,
  encryptedStoreOwnerGid: 0,
  hostCredentialSecretPresent: false,
  tpm2DevicePresent: false,
  realSignerCredentialsPresent: false,
  ...patch,
});

describe("GPT02 Issue159 private-key custody contract", () => {
  it("pins four distinct encrypted credential paths outside Hub/env/repo", () => {
    expect(GPT02_ISSUE159_PRIVATE_KEY_CUSTODY.mechanism)
      .toBe("systemd-credential-encrypted");
    expect(GPT02_ISSUE159_PRIVATE_KEY_CUSTODY.encryptedStoreDirectory)
      .toBe("/etc/credstore.encrypted");
    expect(GPT02_ISSUE159_PRIVATE_KEY_CUSTODY.runtimeCredentialName)
      .toBe("private-key.pkcs8");

    const paths = Object.values(GPT02_ISSUE159_PRIVATE_KEY_CUSTODY.roles)
      .map((x) => x.encryptedCredential);
    expect(new Set(paths).size).toBe(4);
    for (const path of paths) {
      expect(path.startsWith("/etc/credstore.encrypted/gpt02-issue159-"))
        .toBe(true);
      expect(path.endsWith("-private-key.pkcs8")).toBe(true);
    }
    expect(GPT02_ISSUE159_PRIVATE_KEY_CUSTODY.forbiddenTransports)
      .toContain("AI-Task-Hub-env");
    expect(GPT02_ISSUE159_PRIVATE_KEY_CUSTODY.forbiddenTransports)
      .toContain("environment-variable");
  });

  it("accepts host metadata baseline only as observation, never operational authority", () => {
    const result = assessGpt02Issue159PrivateKeyCustodyHost(host());
    expect(result.encryptedStoreBaselineVerified).toBe(true);
    expect(result.tpm2Available).toBe(false);
    expect(result.hostEncryptionKeyObserved).toBe(false);
    expect(result.fourRealSignerCredentialsObserved).toBe(false);
    expect(result.hostMetadataIndependentlyAttested).toBe(false);
    expect(result.privateKeysLoaded).toBe(false);
    expect(result.signerRuntimeMounted).toBe(false);
    expect(result.operationalCustodyReady).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
  });

  it("spoofed presence booleans still cannot make custody operationally ready", () => {
    const result = assessGpt02Issue159PrivateKeyCustodyHost(host({
      hostCredentialSecretPresent: true,
      tpm2DevicePresent: true,
      realSignerCredentialsPresent: true,
    }));
    expect(result.hostEncryptionKeyObserved).toBe(true);
    expect(result.fourRealSignerCredentialsObserved).toBe(true);
    expect(result.hostMetadataIndependentlyAttested).toBe(false);
    expect(result.operationalCustodyReady).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
  });

  it("rejects weak store metadata or malformed host input", () => {
    for (const patch of [
      { systemdVersion: 251 },
      { systemdCredsAvailable: false },
      { encryptedStoreDirectory: "/tmp/credentials" },
      { encryptedStoreMode: "0755" },
      { encryptedStoreOwnerUid: 1000 },
      { encryptedStoreOwnerGid: 1000 },
    ]) {
      expect(() => assessGpt02Issue159PrivateKeyCustodyHost(host(patch)))
        .toThrow("GPT02_ISSUE159_SYSTEMD_CUSTODY_BASELINE_INVALID");
    }
    expect(() => assessGpt02Issue159PrivateKeyCustodyHost({
      ...host(), injected: true,
    })).toThrow("GPT02_ISSUE159_CUSTODY_HOST_INPUT_INVALID");
  });

  it("production source never loads credentials, keys, env, filesystem or signing APIs", async () => {
    const source = await readFile(
      new URL("../gpt02Issue159PrivateKeyCustodyContract.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "createPrivateKey", "sign(", "readFile", "node:fs", "process.env",
      "systemd-creds cat", "systemd-creds decrypt", "@workspace/db", "fetch(",
      "operationalCustodyReady: true", "signingPermitted: true",
      "dispatchPermitted: true",
    ]) expect(source).not.toContain(forbidden);
  });
});
