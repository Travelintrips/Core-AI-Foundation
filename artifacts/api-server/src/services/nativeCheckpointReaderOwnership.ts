/** Conservative native DELL reader ownership proof; neither ACKs nor closes a tab. */
export type NativeReaderRecord = {
  eventId: string;
  conversationId: string;
  originalRawTargetId: string;
  readerRawTargetId: string;
  pageUrl: string;
  preopenTargetIds: string[];
  status: string;
  disposition: string;
  originalFocusRestored: boolean;
  capturedAt: number;
};

export type NativeReaderTab = { type: string; url: string; id: string };
const hex32 = /^[0-9a-f]{32}$/i;
const hex64 = /^[0-9a-f]{64}$/i;
const convId = /^[0-9a-f-]{36}$/i;
export function verifyNativeCheckpointReaderOwnership(input: {
  record: NativeReaderRecord | null;
  expectedEventId: string;
  expectedConversationId: string;
  expectedReaderId: string;
  expectedOriginalId: string;
  tabs: readonly NativeReaderTab[];
}): boolean {
  const { record, expectedEventId, expectedConversationId, expectedReaderId, expectedOriginalId, tabs } = input;
  if (!record || !hex64.test(expectedEventId) || !convId.test(expectedConversationId) ||
      !hex32.test(expectedReaderId) || !hex32.test(expectedOriginalId) ||
      expectedReaderId === expectedOriginalId ||
      record.eventId !== expectedEventId || record.conversationId !== expectedConversationId ||
      record.originalRawTargetId !== expectedOriginalId ||
      record.readerRawTargetId !== expectedReaderId ||
      record.status !== "CAPTURE_VERIFIED" ||
      record.disposition !== "PRESERVED_RECONCILIATION_REQUIRED" ||
      record.originalFocusRestored !== true ||
      !Number.isFinite(record.capturedAt) ||
      record.pageUrl !== `https://chatgpt.com/c/${expectedConversationId}` ||
      !Array.isArray(record.preopenTargetIds) ||
      !record.preopenTargetIds.includes(expectedOriginalId) ||
      record.preopenTargetIds.includes(expectedReaderId)) return false;
  const matches = tabs.filter(x => x.type === "page" && x.url === record.pageUrl);
  // If the original tab vanished or a third tab appeared, ownership is ambiguous.
  return matches.length === 2 &&
    matches.filter(x => x.id === expectedOriginalId).length === 1 &&
    matches.filter(x => x.id === expectedReaderId).length === 1;
}
