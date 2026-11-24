import { getExternalAgentRule } from "./externalAgentRegistryService.js";

export const GPT02_READER_CUSTODY_SCOPE = "GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV" as const;
const CAPABILITY = "gpt02:reader-custody:coordinate:dev";
const PRINCIPAL = "openclaw-vps-main";
const PROJECT = "xssrfshdrtdfupgqwfdw";

export type ReaderCustodyCoordinationAction =
  | "REQUEST_AUTHORIZED_CUSTODIAN_PROVISIONING"
  | "VERIFY_NON_SECRET_READER_STATUS"
  | "VERIFY_SEALED_CUSTODY_RECEIPT"
  | "REQUEST_SIGNED_SUPER_ADMIN_E2E_QA";

const ACTIONS: ReadonlySet<string> = new Set<ReaderCustodyCoordinationAction>([
  "REQUEST_AUTHORIZED_CUSTODIAN_PROVISIONING",
  "VERIFY_NON_SECRET_READER_STATUS",
  "VERIFY_SEALED_CUSTODY_RECEIPT",
  "REQUEST_SIGNED_SUPER_ADMIN_E2E_QA",
]);

export type ReaderCustodyCoordinationInput = Readonly<{
  /** Verified by a separate cryptographic worker identity verifier, not a submitted clientId alone. */
  authenticatedPrincipal: string;
  source: string;
  projectId: string;
  environment: string;
  scope: string;
  action: string;
  /** Independent live-presence result from CST-DEV, never agent-provided. */
  leaseActive: boolean;
  verifiedHealthy: boolean;
  /** Explicit independently verified worker attestation required; registry lease is insufficient. */
  workerAttestationVerified: boolean;
}>;

export type ReaderCustodyCoordinationDecision = Readonly<{
  allowed: boolean;
  scope: typeof GPT02_READER_CUSTODY_SCOPE;
  principal: typeof PRINCIPAL;
  credentialsReadable: false;
  databaseRoleMutationPermitted: false;
  signerPermitted: false;
  dispatchPermitted: false;
  productionPermitted: false;
}>;

/**
 * Bounded coordination grant for a previously appointed Owner PIC.
 * This is NOT a DB writer grant or a credential issuer.
 * Refuses all operations if independent worker attestation is unavailable.
 */
export function evaluateGpt02ReaderCustodyCoordination(
  input: ReaderCustodyCoordinationInput,
): ReaderCustodyCoordinationDecision {
  const rule = getExternalAgentRule(PRINCIPAL);
  const allowed = (
    input.authenticatedPrincipal === PRINCIPAL &&
    input.source === "openclaw" &&
    input.projectId === PROJECT &&
    input.environment === "development" &&
    input.scope === GPT02_READER_CUSTODY_SCOPE &&
    ACTIONS.has(input.action) &&
    input.leaseActive === true &&
    input.verifiedHealthy === true &&
    input.workerAttestationVerified === true &&
    rule?.role === "bounded_orchestration_agent" &&
    new Set<string>(rule.capabilities).has(CAPABILITY) &&
    rule.permissions.productionDeploy === false &&
    rule.permissions.gitPush === false &&
    rule.permissions.gitCommit === false
  );
  return {
    allowed,
    scope: GPT02_READER_CUSTODY_SCOPE,
    principal: PRINCIPAL,
    credentialsReadable: false,
    databaseRoleMutationPermitted: false,
    signerPermitted: false,
    dispatchPermitted: false,
    productionPermitted: false,
  };
}
