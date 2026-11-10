export const GPT02_ISSUE159_PRIVATE_KEY_CUSTODY = Object.freeze({
  mechanism: "systemd-credential-encrypted",
  encryptedStoreDirectory: "/etc/credstore.encrypted",
  runtimeCredentialName: "private-key.pkcs8",
  roles: Object.freeze({
    approval: Object.freeze({
      encryptedCredential:
        "/etc/credstore.encrypted/gpt02-issue159-approval-private-key.pkcs8",
    }),
    hub: Object.freeze({
      encryptedCredential:
        "/etc/credstore.encrypted/gpt02-issue159-hub-private-key.pkcs8",
    }),
    core: Object.freeze({
      encryptedCredential:
        "/etc/credstore.encrypted/gpt02-issue159-core-private-key.pkcs8",
    }),
    issuer: Object.freeze({
      encryptedCredential:
        "/etc/credstore.encrypted/gpt02-issue159-issuer-private-key.pkcs8",
    }),
  }),
  forbiddenTransports: Object.freeze([
    "environment-variable",
    "repository-file",
    "AI-Task-Hub-env",
    "database-row",
    "http-request-body",
    "chat",
    "issue-comment",
  ]),
});

export function assessGpt02Issue159PrivateKeyCustodyHost(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("GPT02_ISSUE159_CUSTODY_HOST_INPUT_INVALID");
  }
  const x = input as Record<string, unknown>;
  const expected = [
    "systemdVersion", "systemdCredsAvailable", "encryptedStoreDirectory",
    "encryptedStoreMode", "encryptedStoreOwnerUid", "encryptedStoreOwnerGid",
    "hostCredentialSecretPresent", "tpm2DevicePresent",
    "realSignerCredentialsPresent",
  ];
  if (Object.keys(x).sort().join(",") !== expected.sort().join(",")) {
    throw new Error("GPT02_ISSUE159_CUSTODY_HOST_INPUT_INVALID");
  }
  if (!Number.isInteger(x["systemdVersion"]) ||
      Number(x["systemdVersion"]) < 252 ||
      x["systemdCredsAvailable"] !== true ||
      x["encryptedStoreDirectory"] !==
        GPT02_ISSUE159_PRIVATE_KEY_CUSTODY.encryptedStoreDirectory ||
      x["encryptedStoreMode"] !== "0700" ||
      x["encryptedStoreOwnerUid"] !== 0 ||
      x["encryptedStoreOwnerGid"] !== 0) {
    throw new Error("GPT02_ISSUE159_SYSTEMD_CUSTODY_BASELINE_INVALID");
  }

  const hostKeyReady = x["hostCredentialSecretPresent"] === true;
  const realCredentialsPresent = x["realSignerCredentialsPresent"] === true;

  return Object.freeze({
    environment: "DEV" as const,
    mechanism:
      GPT02_ISSUE159_PRIVATE_KEY_CUSTODY.mechanism,
    encryptedStoreBaselineVerified: true as const,
    tpm2Available: x["tpm2DevicePresent"] === true,
    hostEncryptionKeyObserved: hostKeyReady,
    fourRealSignerCredentialsObserved: realCredentialsPresent,
    hostMetadataIndependentlyAttested: false as const,
    privateKeysLoaded: false as const,
    signerRuntimeMounted: false as const,
    signingPermitted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
    operationalCustodyReady: false as const,
    releaseDecision: "NO_GO" as const,
  });
}
