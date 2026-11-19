import {
  type Gpt02Issue159SignerRole,
} from "./gpt02Issue159FourSignerContract.js";
import {
  assessGpt02Issue159SignerProvenance,
} from "./gpt02Issue159SignerCustodyPolicy.js";

export const GPT02_ISSUE159_HUB_PUBLIC_KEY_FILES = Object.freeze({
  approval: "approval-public.pem",
  hub: "hub-identity-public.pem",
  core: "core-identity-public.pem",
  issuer: "issuer-public.pem",
} satisfies Record<Gpt02Issue159SignerRole, string>);

export const GPT02_ISSUE159_HUB_PUBLIC_TRUST_TARGETS = Object.freeze({
  publicKeyDirectory: "/etc/gpt02-dev/public",
  fingerprintManifest: "/etc/gpt02-dev/trust-fingerprints.json",
});

type ProvenanceInput = Parameters<typeof assessGpt02Issue159SignerProvenance>[0];

function records(input: ProvenanceInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("GPT02_ISSUE159_PUBLIC_HANDOFF_INPUT_REQUIRED");
  }
  return input as Record<Gpt02Issue159SignerRole, {
    publicKeyPem: string;
  }>;
}

/**
 * Creates an in-memory public-only handoff description.
 *
 * It never writes files, never opens a private key, never grants authority,
 * and never mounts the signer into a route/worker.
 */
export function buildGpt02Issue159PublicTrustHandoff(input: ProvenanceInput) {
  const assessed = assessGpt02Issue159SignerProvenance(input);
  const source = records(input);
  const files = Object.freeze({
    [GPT02_ISSUE159_HUB_PUBLIC_KEY_FILES.approval]:
      source.approval.publicKeyPem,
    [GPT02_ISSUE159_HUB_PUBLIC_KEY_FILES.hub]:
      source.hub.publicKeyPem,
    [GPT02_ISSUE159_HUB_PUBLIC_KEY_FILES.core]:
      source.core.publicKeyPem,
    [GPT02_ISSUE159_HUB_PUBLIC_KEY_FILES.issuer]:
      source.issuer.publicKeyPem,
  });

  return Object.freeze({
    environment: "DEV" as const,
    targets: GPT02_ISSUE159_HUB_PUBLIC_TRUST_TARGETS,
    files,
    manifest: Object.freeze({
      approval: assessed.publicFingerprints.approval,
      hub: assessed.publicFingerprints.hub,
      core: assessed.publicFingerprints.core,
      issuer: assessed.publicFingerprints.issuer,
    }),
    privateKeyMaterialIncluded: false as const,
    writesPerformed: false as const,
    signerMounted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
    operationalTrustInstalled: false as const,
    releaseDecision: "NO_GO" as const,
  });
}
