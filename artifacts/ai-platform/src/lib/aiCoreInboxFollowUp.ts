/** UI classification only: opening/reading an inbox item is not an ACK,
 * execution result, resolution, or retry authorization. Counts cover only
 * the records returned by the existing bounded inbox list. */
export type InboxFollowUpFilter = "all" | "attention" | "unread";
type InboxObservation = { eventType: string; readAt: string | null };
export function isInboxFollowUp(item: InboxObservation): boolean {
  return item.eventType === "FAILED" || item.eventType === "BLOCKED";
}
export function selectInboxFollowUp<T extends InboxObservation>(items: readonly T[], filter: InboxFollowUpFilter) {
  const attention = items.filter(isInboxFollowUp);
  const unread = items.filter(item => item.readAt === null);
  return {
    rows: filter === "attention" ? attention : filter === "unread" ? unread : items,
    counts: { all: items.length, attention: attention.length, unread: unread.length },
  };
}
export const INBOX_READ_PATH = "/api/ai/core-chat/inbox/read";
type InboxReadTransport = (path: string, init: RequestInit) => Promise<unknown>;
/** Only an explicit single-item action uses the existing session-authenticated
 * read endpoint. Never send an empty object or empty list (legacy mark-all). */
export async function markOneInboxRead(id: string, send: InboxReadTransport): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid inbox item ID");
  }
  const result = await send(INBOX_READ_PATH, { method: "POST", body: JSON.stringify({ ids: [id] }) });
  if (!result || typeof result !== "object" || !("updated" in result) || result.updated !== 1) {
    throw new Error("Inbox read receipt not confirmed");
  }
}
