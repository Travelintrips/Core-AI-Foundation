import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The transaction fake does not commit pending writes unless BOTH inserts
 * succeed. No Supabase connection, worker enrollment or event subscriber.
 */
const state = vi.hoisted(() => ({
  committed: [] as { table: string; data: Record<string, unknown> }[],
  failAudit: false,
  transactionCalls: 0,
  subscriberLookups: 0,
}));
vi.mock("@workspace/db", () => {
  const aiEventsTable = { __table: "events", eventType: "eventType", status: "status" };
  const aiAuditLogsTable = { __table: "audit" };
  const aiEventSubscriptionsTable = { __table: "subscriptions", eventType: "eventType", status: "status" };
  return {
    aiEventsTable, aiAuditLogsTable, aiEventSubscriptionsTable,
    db: {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        state.transactionCalls++;
        const pending: typeof state.committed = [];
        const tx = {
          insert: (table: { __table: string }) => ({
            values: (data: Record<string, unknown>) => {
              if (table === aiEventsTable) return {
                returning: async () => {
                  pending.push({ table: "events", data });
                  return [{ ...data, id: 1 }];
                },
              };
              if (table === aiAuditLogsTable) return Promise.resolve().then(() => {
                if (state.failAudit) throw Object.assign(
                  new Error("RLS_EVENT_AUDIT_INSERT_DENIED"), { code: "42501" });
                pending.push({ table: "audit", data });
              });
              throw Error("UNEXPECTED_INSERT_TABLE");
            },
          }),
        };
        const result = await fn(tx);
        state.committed.push(...pending);
        return result;
      }),
      select: () => ({
        from: () => ({
          where: async () => { state.subscriberLookups++; return []; },
        }),
      }),
    },
  };
});
vi.mock("../aiAuditService.js", () => ({
  logAudit: vi.fn(),
}));
vi.mock("../eventHandlerRegistry.js", () => ({
  eventHandlerRegistry: {},
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { publishAuditedCstDevModelCompletion } from "../aiEventBusService.js";
import { db } from "@workspace/db";
import { logAudit } from "../aiAuditService.js";

const validCompletion = {
  eventType: "job.completed", sourceModule: "job-engine", sourceId: "482",
  payload: { jobId: 482, workerId: 3628, jobCode: "OLLAMA-B7F9B5E2",
    jobType: "ollama_model_invocation", actualDuration: 9200, actualCost: null },
};

describe("CST-DEV model event + audit transaction (no real DB)", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED", "true");
    state.committed = [];
    state.failAudit = false;
    state.transactionCalls = 0;
    state.subscriberLookups = 0;
    vi.mocked(db.transaction).mockClear();
    vi.mocked(logAudit).mockClear();
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("commits exactly one event and one linked audit, without an independent Final ACK", async () => {
    const result = await publishAuditedCstDevModelCompletion(validCompletion);
    expect(result.eventType).toBe("job.completed");
    expect(state.transactionCalls).toBe(1);
    expect(state.committed).toHaveLength(2);
    expect(state.committed.map(x => x.table)).toEqual(["events", "audit"]);
    const event = state.committed[0].data;
    const audit = state.committed[1].data;
    expect(event.sourceId).toBe("482");
    expect(event.status).toBe("published");
    expect(audit.module).toBe("event-bus");
    expect(audit.action).toBe("event_published");
    expect(audit.resourceId).toBe(event.eventId);
    expect((audit.details as Record<string, unknown>).correlationId).toBe(event.correlationId);
    expect(event).not.toHaveProperty("finalAckVerified");
    expect(event).not.toHaveProperty("attestationVerified");
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("rolls back the event write if the event_published audit is denied by RLS", async () => {
    state.failAudit = true;
    await expect(publishAuditedCstDevModelCompletion(validCompletion))
      .rejects.toMatchObject({ code: "42501" });
    expect(state.transactionCalls).toBe(1);
    expect(state.committed).toHaveLength(0);
    expect(state.subscriberLookups).toBe(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses a wrong job, source, event type, or any non-DEV configuration before DB work", async () => {
    const invalid = [
      { ...validCompletion, sourceId: "483" },
      { ...validCompletion, eventType: "job.failed" },
      { ...validCompletion, sourceModule: "other" },
      { ...validCompletion, payload: { ...validCompletion.payload, workerId: "3628" } },
      { ...validCompletion, payload: { ...validCompletion.payload, jobId: 483 } },
      { ...validCompletion, payload: { ...validCompletion.payload, jobType: "ollama_powershell_execution" } },
    ];
    for (const request of invalid) {
      await expect(publishAuditedCstDevModelCompletion(request))
        .rejects.toThrow("CST_DEV_MODEL_EVENT_AUDIT_SCOPE_INVALID");
    }
    vi.stubEnv("NODE_ENV", "production");
    await expect(publishAuditedCstDevModelCompletion(validCompletion))
      .rejects.toThrow("CST_DEV_MODEL_EVENT_AUDIT_SCOPE_INVALID");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED", "false");
    await expect(publishAuditedCstDevModelCompletion(validCompletion))
      .rejects.toThrow("CST_DEV_MODEL_EVENT_AUDIT_SCOPE_INVALID");
    expect(db.transaction).not.toHaveBeenCalled();
    expect(state.committed).toHaveLength(0);
  });
});
