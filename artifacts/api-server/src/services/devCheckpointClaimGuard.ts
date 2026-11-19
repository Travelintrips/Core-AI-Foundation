/** A generic bridge response is not a trusted Ed25519 checkpoint issuer. */
export function assertNoSelfAttestedCheckpoint(kind: string, metadata: Record<string, unknown>): void {
  if (kind !== "CHECKPOINT") return;
  if (["verified", "checkpointVerified", "verifiedAssistantReply", "attestationVerified", "verifiedAttestation"].some((key) => metadata[key] === true) || metadata["attestation"] !== undefined) {
    throw new Error("DEV_CHECKPOINT_ATTESTATION_ISSUER_REQUIRED");
  }
}
