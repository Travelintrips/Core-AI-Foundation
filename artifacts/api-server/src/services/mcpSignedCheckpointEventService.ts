import { verifyDevSopCheckpointReceipt } from "./devSopCheckpointIssuer.js";

/** Exact-owner MCP checkpoint eligibility. Never uses worker assertions alone. */
export function verifiedSignedCheckpointMcpEvent(input: {
  kind: string;
  commandId: string;
  checkpoint: Record<string, unknown>;
  metadata: Record<string, unknown>;
  issuerPrivateKeyDerBase64?: string;
}): "CHECKPOINT" | null {
  if (input.kind !== "CHECKPOINT") return null;
  return verifyDevSopCheckpointReceipt({
    receipt: input.metadata["checkpointReceipt"],
    responseMetadata: input.metadata,
    checkpoint: input.checkpoint,
    commandId: input.commandId,
    issuerPrivateKeyDerBase64: input.issuerPrivateKeyDerBase64,
  }) ? "CHECKPOINT" : null;
}
