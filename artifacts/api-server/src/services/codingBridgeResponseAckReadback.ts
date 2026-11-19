/**
 * Minimal DEV read-back projection for one bridge response.
 * The persisted row, not the POST /ack response, is the source of truth.
 * Never return message text, checkpoint data, full metadata, or credentials.
 */
export type CodingBridgeAckReadbackRow = {
  id: string;
  commandId: string;
  kind: string;
  acknowledgedAt: Date | null;
  metadataJson: unknown;
};

export type CodingBridgeAckReadback = {
  id: string;
  commandId: string;
  kind: string;
  acknowledgedAt: string | null;
  e2eCode: "E2E_VERIFIED" | null;
  deliveryCode: "DELIVERY_CONFIRMED" | null;
  verifiedAssistantReply: boolean;
  browserPairingVerified: boolean;
};

export function toCodingBridgeAckReadback(
  row: CodingBridgeAckReadbackRow,
): CodingBridgeAckReadback {
  const metadata =
    row.metadataJson !== null &&
    typeof row.metadataJson === "object" &&
    !Array.isArray(row.metadataJson)
      ? (row.metadataJson as Record<string, unknown>)
      : {};
  const acknowledgedAt =
    row.acknowledgedAt instanceof Date &&
    Number.isFinite(row.acknowledgedAt.getTime())
      ? row.acknowledgedAt.toISOString()
      : null;
  return {
    id: row.id,
    commandId: row.commandId,
    kind: row.kind,
    acknowledgedAt,
    e2eCode: metadata["e2eCode"] === "E2E_VERIFIED" ? "E2E_VERIFIED" : null,
    deliveryCode: metadata["deliveryCode"] === "DELIVERY_CONFIRMED"
      ? "DELIVERY_CONFIRMED" : null,
    verifiedAssistantReply: metadata["verifiedAssistantReply"] === true,
    browserPairingVerified: metadata["browserPairingVerified"] === true,
  };
}
