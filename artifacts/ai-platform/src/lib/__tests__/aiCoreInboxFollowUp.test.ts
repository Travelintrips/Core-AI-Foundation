import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { isInboxFollowUp, markOneInboxRead, selectInboxFollowUp, INBOX_READ_PATH } from "../aiCoreInboxFollowUp";
const id = "11111111-1111-4111-8111-111111111111";
const rows = [
  { id: "failed-unread", eventType: "FAILED", readAt: null },
  { id: "failed-read", eventType: "FAILED", readAt: "2026-11-21T00:00:00Z" },
  { id: "blocked", eventType: "BLOCKED", readAt: null },
  { id: "completed", eventType: "COMPLETED", readAt: null },
  { id: "billing", eventType: "BILLING_ALERT", readAt: null },
  { id: "merged", eventType: "MERGED", readAt: "2026-11-21T00:00:00Z" },
];
describe("AI Core inbox follow-up", () => {
  it("filters FAILED and BLOCKED regardless of read state without changing stored rows", () => {
    const before = JSON.stringify(rows);
    const view = selectInboxFollowUp(rows, "attention");
    expect(view.rows.map(x => x.id)).toEqual(["failed-unread", "failed-read", "blocked"]);
    expect(view.counts).toEqual({ all: 6, attention: 3, unread: 4 });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("keeps unrelated and unknown event types outside attention", () => {
    for (const eventType of ["COMPLETED", "MERGED", "DEPLOYED", "BILLING_ALERT", "failed", "UNKNOWN"]) {
      expect(isInboxFollowUp({ eventType, readAt: null })).toBe(false);
    }
  });
  it("unread filter is separate from attention and loaded counts are bounded", () => {
    expect(selectInboxFollowUp(rows, "unread").rows.map(x => x.id)).toEqual(["failed-unread","blocked","completed","billing"]);
    expect(selectInboxFollowUp(rows, "all").rows).toEqual(rows);
    expect(selectInboxFollowUp([], "attention").counts).toEqual({all:0,attention:0,unread:0});
  });
  it("explicit action submits exactly one inbox ID through existing read path", async () => {
    const send = vi.fn(async () => ({ updated: 1 }));
    await markOneInboxRead(id, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(INBOX_READ_PATH,{method:"POST",body:JSON.stringify({ids:[id]})});
  });
  it("never sends empty or malformed IDs or repeats failed calls", async () => {
    const send = vi.fn(async () => ({ updated: 1 }));
    for (const bad of ["", "not-a-uuid", id + "," + id, "{}"]) {
      await expect(markOneInboxRead(bad, send)).rejects.toThrow();
    }
    expect(send).not.toHaveBeenCalled();
    const unavailable = vi.fn(async () => { throw new Error("fixture failure"); });
    await expect(markOneInboxRead(id, unavailable)).rejects.toThrow("fixture failure");
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
  it("does not treat invalid or zero/multiple-row receipts as success", async () => {
    for (const value of [null, {}, {updated:0}, {updated:2}, {updated:"1"}]) {
      await expect(markOneInboxRead(id, async () => value)).rejects.toThrow();
    }
  });
  it("opening/filtering never marks all read; server GET remains authoritative", () => {
    const page = readFileSync(new URL("../../pages/ai-core-chat.tsx", import.meta.url), "utf8");
    const toggle = page.split("function toggleInbox() {")[1].split("async function markInboxItemRead")[0];
    expect(toggle).toContain("setInboxOpen(open => !open)");
    expect(toggle).not.toMatch(/apiFetch|markOneInboxRead|setInboxUnread|setInboxMessages|POST/);
    const mark = page.split("async function markInboxItemRead")[1].split("function clearChat")[0];
    expect(mark).toContain("await markOneInboxRead(item.id");
    expect(mark).not.toMatch(/setInboxUnread|setInboxMessages|acknowledge|retryOpenClawSubmission\(/);
    expect(page).toContain("onClick={() => setInboxFilter(filter)}");
    expect(page).toContain("onClick={() => void markInboxItemRead(item)}");
    expect(page).toContain("Inbox tidak dapat dibaca. Ini bukan berarti tidak ada laporan.");
    expect(page).toContain("Tanda dibaca bukan ACK hasil");
    expect(page).toContain("Perlu tindak lanjut — periksa bukti sumber");
  });
});
