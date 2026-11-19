import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mock = vi.hoisted(() => ({ calls: [] as unknown[], rows: [] as Array<Record<string,unknown>> }));
vi.mock("@workspace/db", () => ({
  db: { execute: async (query: unknown) => { mock.calls.push(query); return { rows: mock.rows }; } },
}));
import { listDevDellQueuedWakeCommandIds, DEV_DELL_WAKE_CLIENT_ID } from "../gpt02DevQueuedWakeService.js";

const valid = "83db99f5-cbda-4e60-be71-3090fb411bbb";
beforeEach(() => {
  mock.calls = [];
  mock.rows = [];
  process.env["PUBLIC_APP_URL"] = "https://dev.cstlogistic.co.id";
});
afterEach(() => { delete process.env["PUBLIC_APP_URL"]; });

describe("DEV DELL targeted SSE recovery quarantine", () => {
  it("blocks wrong public URL or wrong client before DB", async () => {
    process.env["PUBLIC_APP_URL"] = "https://prod.cstlogistic.co.id";
    expect(await listDevDellQueuedWakeCommandIds(DEV_DELL_WAKE_CLIENT_ID)).toEqual([]);
    process.env["PUBLIC_APP_URL"] = "https://dev.cstlogistic.co.id";
    expect(await listDevDellQueuedWakeCommandIds("not-dell")).toEqual([]);
    expect(mock.calls).toHaveLength(0);
  });
  it("query excludes every recovery marker by presence, even false/null, and restricts ordinary wake", async () => {
    const result = await listDevDellQueuedWakeCommandIds(DEV_DELL_WAKE_CLIENT_ID);
    expect(result).toEqual([]);
    expect(mock.calls).toHaveLength(1);
    const compiled = new PgDialect().sqlToQuery(mock.calls[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
    const normalized = compiled.sql.replace(/\s+/g, " ");
    expect(normalized).toContain("status = 'RECEIVED'");
    expect(normalized).toContain("assignedClientId");
    expect(normalized).toContain("ai_platform.gpt02_dev_generic_claim_allowed(id) IS TRUE");
    for (const key of ["gpt02Recovery", "gpt02RecoveryParentCommandId",
      "recoveryParentCommandId", "recovery_parent_command_id", "parentCommandId"]) {
      expect(normalized).toContain(key);
    }
    expect(normalized).toContain("metadata_json ?| ARRAY");
    expect(normalized).toContain("metadata_json ? 'parentCommandId'");
    expect(normalized).toContain("AND NOT (");
    expect(normalized).toContain("LIMIT 128");
    expect(compiled.params).toEqual([DEV_DELL_WAKE_CLIENT_ID]);
  });
  it("query remains fail-closed if the durable exclusion function is missing or denied", async () => {
    mock.rows = [];
    mock.calls = [];
    // A missing database function must NOT be silently replaced by a permissive path.
    // This test verifies the query retains its mandatory gate.
    await listDevDellQueuedWakeCommandIds(DEV_DELL_WAKE_CLIENT_ID);
    const compiled = new PgDialect().sqlToQuery(mock.calls[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(compiled.sql.match(/gpt02_dev_generic_claim_allowed/g)).toHaveLength(1);
  });
  it("returns only valid IDs, never derives worker authority from returned rows", async () => {
    mock.rows = [{id:valid},{id:"invalid"},{id:42},{id:null}];
    expect(await listDevDellQueuedWakeCommandIds(DEV_DELL_WAKE_CLIENT_ID)).toEqual([valid]);
  });
});
