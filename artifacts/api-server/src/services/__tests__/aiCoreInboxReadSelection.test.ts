import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { execute: mocks.execute } }));
import { InboxReadRequest, buildAiCoreInboxReadQuery } from "../aiCoreInboxReadSelection.js";
import { markAiCoreChatInboxRead } from "../aiCoreChatInboxService.js";

const first = "a1111111-1111-4111-8111-111111111111";
const second = "b2222222-2222-4222-8222-222222222222";
const dialect = new PgDialect();
describe("Inbox read receipt requires explicit selected IDs", () => {
  it("rejects omitted, empty, malformed, oversized and extra fields at HTTP boundary", () => {
    for (const body of [undefined, null, {}, {ids:[]}, {ids:null}, {ids:first},
      {ids:[first,"bad"]}, {ids:Array(101).fill(first)}, {ids:[first],all:true}]) {
      expect(InboxReadRequest.safeParse(body).success).toBe(false);
    }
    expect(InboxReadRequest.safeParse({ids:[first]}).success).toBe(true);
    expect(InboxReadRequest.safeParse({ids:Array(100).fill(first)}).success).toBe(true);
  });
  it("invalid selections cannot generate an update statement", () => {
    for (const ids of [undefined,null,[],first,[first,"bad"],Array(101).fill(first)]) {
      expect(buildAiCoreInboxReadQuery(ids)).toBeNull();
    }
  });
  it("binds exactly the selected UUID and retains the original read timestamp", () => {
    const query = buildAiCoreInboxReadQuery([first]);
    expect(query).not.toBeNull();
    const compiled = dialect.sqlToQuery(query!);
    expect(compiled.sql).toContain("SET read_at = COALESCE(read_at, NOW())");
    expect(compiled.sql).toContain("WHERE id IN ($1::uuid)");
    expect(compiled.params).toEqual([first]);
    expect(compiled.sql).not.toContain(first);
    expect(compiled.sql).not.toContain("WHERE read_at IS NULL");
  });
  it("deduplicates selected UUIDs, without binding a malformed PG array", () => {
    const query = buildAiCoreInboxReadQuery([first,second,first.toUpperCase()]);
    const compiled = dialect.sqlToQuery(query!);
    expect(compiled.sql).toContain("WHERE id IN ($1::uuid, $2::uuid)");
    expect(compiled.params).toEqual([first,second]);
  });
  it("service refuses invalid internal calls before touching the database", async () => {
    mocks.execute.mockReset();
    for (const ids of [undefined,null,[],[first,"bad"],Array(101).fill(first)]) {
      expect(await markAiCoreChatInboxRead(ids as unknown as string[])).toBe(0);
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("service executes one bounded selected-ID update using existing schema", async () => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce({ rows: [{ ready:true }] });
    mocks.execute.mockResolvedValueOnce({ rows: [{ id:first }] });
    expect(await markAiCoreChatInboxRead([first])).toBe(1);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const compiled = dialect.sqlToQuery(mocks.execute.mock.calls[1]![0]);
    expect(compiled.sql).toContain("WHERE id IN ($1::uuid)");
    expect(compiled.params).toEqual([first]);
    expect(compiled.sql).not.toMatch(/acknowledged_at|job_events|ai_coding_bridge_responses/);
  });
  it("HTTP route validates before invoking the same selected-ID service", () => {
    const route = readFileSync(new URL("../../routes/ai-core-chat.ts",import.meta.url),"utf8");
    expect(route).toContain('import { InboxReadRequest } from "../services/aiCoreInboxReadSelection.js"');
    const readRoute = route.split('router.post("/ai/core-chat/inbox/read"')[1].split('router.get("/ai/core-chat/tasks/')[0];
    expect(readRoute.indexOf("InboxReadRequest.safeParse")).toBeLessThan(readRoute.indexOf("markAiCoreChatInboxRead(parsed.data.ids)"));
    expect(readRoute).toContain("res.status(400)");
    expect(readRoute).not.toContain("acknowledged_at");
  });
});
