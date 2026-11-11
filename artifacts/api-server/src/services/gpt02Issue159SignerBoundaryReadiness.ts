import {
  assessGpt02Issue159SignerProvenance,
} from "./gpt02Issue159SignerCustodyPolicy.js";
import {
  buildGpt02Issue159PublicTrustHandoff,
} from "./gpt02Issue159PublicTrustHandoff.js";
import {
  inspectGpt02Issue159ApprovalAuthorizerEvidence,
} from "./gpt02Issue159ApprovalAuthorizerEvidence.js";
import {
  inspectGpt02Issue159OperatorAuthorizerEvidence,
} from "./gpt02Issue159OperatorAuthorizerEvidence.js";
import {
  inspectGpt02Issue159IssuerAuthorizerEvidence,
} from "./gpt02Issue159IssuerAuthorizerEvidence.js";

function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).sort().join(",") ===
    [...fields].sort().join(",");
}

/**
 * Source/readiness aggregator only.
 *
 * It proves that every signer domain has a matching non-authorizing contract.
 * It can NEVER declare operational signing ready. Approval trusted-read source
 * now exists, but Hub/Core/issuer trusted-read adapters and live signer/runtime
 * attestations remain outside this source-only contract.
 */
export function assessGpt02Issue159SignerBoundaryReadiness(input: unknown) {
  if (!exactObject(input, [
    "provenance", "approval", "hub", "core", "issuer",
  ])) {
    throw new Error("GPT02_ISSUE159_SIGNER_BOUNDARY_INPUT_INVALID");
  }

  const data = input as Record<string, any>;
  const provenance = assessGpt02Issue159SignerProvenance(data.provenance);
  const handoff = buildGpt02Issue159PublicTrustHandoff(data.provenance);
  const approval = inspectGpt02Issue159ApprovalAuthorizerEvidence(data.approval);
  const hub = inspectGpt02Issue159OperatorAuthorizerEvidence({
    ...data.hub,
    role: "hub",
  });
  const core = inspectGpt02Issue159OperatorAuthorizerEvidence({
    ...data.core,
    role: "core",
  });
  const issuer = inspectGpt02Issue159IssuerAuthorizerEvidence(data.issuer);

  const sourceContractsVerified =
    provenance.provenancePolicyVerified === true &&
    handoff.privateKeyMaterialIncluded === false &&
    approval.approvalBindingMatched === true &&
    hub.operatorBindingMatched === true &&
    core.operatorBindingMatched === true &&
    issuer.issuerEvidenceBindingMatched === true;

  if (!sourceContractsVerified) {
    throw new Error("GPT02_ISSUE159_SIGNER_BOUNDARY_NOT_VERIFIED");
  }

  return Object.freeze({
    environment: "DEV" as const,
    sourceContractsVerified: true as const,
    fourPublicRootsUnique:
      new Set(Object.values(handoff.manifest)).size === 4,
    approvalAuthorizerContractVerified: true as const,
    hubAuthorizerContractVerified: true as const,
    coreAuthorizerContractVerified: true as const,
    issuerAuthorizerContractVerified: true as const,
    publicTrustHandoffContractVerified: true as const,
    blockers: Object.freeze([
      "TRUSTED_READ_RUNTIME_INTEGRATION_ATTESTATION_REQUIRED",
      "REAL_AAL2_APPROVAL_INTENT_NOT_AVAILABLE",
      "LIVE_SIGNER_CUSTODY_ATTESTATION_REQUIRED",
      "SIGNER_RUNTIME_NOT_MOUNTED",
      "OPERATIONAL_PUBLIC_TRUST_NOT_INSTALLED",
    ]),
    trustedPersistedReadsOperational: false as const,
    realPrivateKeyCustodyAttested: false as const,
    signerRuntimeMounted: false as const,
    operationalPublicTrustInstalled: false as const,
    signingPermitted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
    operationalSigningReady: false as const,
    releaseDecision: "NO_GO" as const,
  });
}
