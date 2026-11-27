import { describe, expect, it, vi } from "vitest";
import { createAiTaskLedgerReconciler } from "../aiTaskLedgerReconciliationService.js";

vi.mock("@workspace/db", () => ({
  aiCodingTasksTable: {},
  aiCodingWorkstreamsTable: {},
  aiCodingBridgeCommandsTable: {},
  db: {},
  pool: {},
}));

vi.mock("../aiTaskLedgerBridgeService.js", () => ({
  ledgerBridgeEnabled: () => false,
  mirrorAiTaskLedgerSourceState: vi.fn(),
}));

const task = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  taskNumber: "CWS-617BA8AE",
  status: "COMPLETED",
  createdAt: new Date("2026-10-14T09:41:34Z"),
  updatedAt: new Date("2026-10-14T09:42:21Z"),
};

const workstream = {
  id: "550e8400-e29b-41d4-a716-446655440010",
  taskNumber: "WS-001",
  status: "COMPLETED",
  createdAt: new Date("2026-10-14T09:43:00Z"),
  updatedAt: new Date("2026-10-14T09:44:00Z"),
  sourceKind: "coding-workstream" as const,
  sessionId: "550e8400-e29b-41d4-a716-446655440099",
};

describe("AI Task terminal reconciliation", () => {
  it("does not access the database or network if the bridge is disabled", async () => {
    const load = vi.fn();
    const publish = vi.fn();
    const reconciler = createAiTaskLedgerReconciler({
      enabled: () => false, load, publish,
    });
    expect(await reconciler.tick()).toEqual({
      scanned: 0, attempted: 0, acknowledged: 0, pending: 0,
    });
    expect(load).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("recovers persisted COMPLETED and FAILED tasks, and stops after receiver confirmation", async () => {
    let clock = Date.parse("2026-10-14T12:00:00Z");
    const load = vi.fn(async () => [
      task,
      { ...task, id: "550e8400-e29b-41d4-a716-446655440002", taskNumber: "CWS-B81560B2", status: "FAILED" },
    ]);
    const publish = vi.fn(async () => ({ synced: true, acknowledged: true }));
    const reconciler = createAiTaskLedgerReconciler({
      enabled: () => true, now: () => clock, load, publish,
    });
    expect(await reconciler.tick()).toMatchObject({
      scanned: 2, attempted: 2, acknowledged: 2, pending: 0,
    });
    expect(publish).toHaveBeenCalledWith({
      externalId: "coding-task:" + task.id,
      title: "AI Core coding task CWS-617BA8AE",
      status: "COMPLETED", version: "terminal",
    });
    clock += 60_001;
    expect(await reconciler.tick()).toMatchObject({ attempted: 0 });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("loads and reconciles terminal workstreams independently from coding tasks", async () => {
    const publish = vi.fn(async () => ({ synced: true, acknowledged: true }));
    const loadTasks = vi.fn(async () => [task]);
    const loadWorkstreams = vi.fn(async () => [
      workstream,
      {
        ...workstream,
        id: "550e8400-e29b-41d4-a716-446655440011",
        taskNumber: "WS-002",
        status: "FAILED",
      },
    ]);
    const reconciler = createAiTaskLedgerReconciler({
      enabled: () => true,
      loadTasks,
      loadWorkstreams,
      loadBridgeCommands: async () => [],
      publish,
    });

    expect(await reconciler.tick()).toMatchObject({
      scanned: 3, attempted: 3, acknowledged: 3, pending: 0,
    });
    expect(loadTasks).toHaveBeenCalledOnce();
    expect(loadWorkstreams).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith({
      externalId: "coding-workstream:" + workstream.id,
      title: "AI Core workstream WS-001",
      sessionId: workstream.sessionId,
      status: "COMPLETED",
      version: "terminal",
    });
  });

  it("mirrors received and completed bridge commands without duplicate dispatch", async () => {
    let clock = Date.parse("2026-10-24T17:00:00Z");
    const bridgeCommand = {
      ...task,
      sourceKind: "bridge-command" as const,
      taskNumber: "550e8400",
      status: "RECEIVED",
    };
    const loadBridgeCommands = vi.fn(async () => [bridgeCommand]);
    const publish = vi.fn(async () => ({ synced: true, acknowledged: false }));
    const reconciler = createAiTaskLedgerReconciler({
      enabled: () => true,
      now: () => clock,
      loadTasks: async () => [],
      loadWorkstreams: async () => [],
      loadBridgeCommands,
      publish,
    });
    expect(await reconciler.tick()).toMatchObject({ scanned: 1, attempted: 1, pending: 0 });
    expect(publish).toHaveBeenCalledWith({
      externalId: "bridge-command:" + bridgeCommand.id,
      title: "AI Core bridge command 550e8400",
      status: "RECEIVED",
      version: "terminal",
    });
    clock += 60_001;
    expect(await reconciler.tick()).toMatchObject({ attempted: 0 });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("reconciles REVIEW_REQUIRED without inventing a terminal ACK", async () => {
    let clock = Date.parse("2026-10-14T12:00:00Z");
    const reviewRequired = {
      ...workstream,
      status: "REVIEW_REQUIRED",
      updatedAt: new Date("2026-10-14T10:00:00Z"),
    };
    const publish = vi.fn(async () => ({
      synced: true,
      observedStatus: "REVIEW_REQUIRED",
      acknowledged: false,
    }));
    const reconciler = createAiTaskLedgerReconciler({
      enabled: () => true,
      now: () => clock,
      loadTasks: async () => [],
      loadWorkstreams: async () => [reviewRequired],
      loadBridgeCommands: async () => [],
      publish,
    });

    expect(await reconciler.tick()).toMatchObject({
      scanned: 1, attempted: 1, acknowledged: 0, pending: 0,
    });
    expect(publish).toHaveBeenCalledWith({
      externalId: "coding-workstream:" + reviewRequired.id,
      title: "AI Core workstream WS-001",
      sessionId: reviewRequired.sessionId,
      status: "REVIEW_REQUIRED",
      version: "review-required",
    });
    clock += 60_001;
    expect(await reconciler.tick()).toMatchObject({ attempted: 0 });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("retries a receiver waiting for ACK, without inventing an ACK on HTTP acceptance", async () => {
    let clock = Date.parse("2026-10-14T12:00:00Z");
    const publish = vi.fn()
      .mockResolvedValueOnce({ synced: true, observedStatus: "WAITING_FOR_ACK", acknowledged: false })
      .mockResolvedValueOnce({ synced: true, observedStatus: "COMPLETED", acknowledged: true });
    const reconciler = createAiTaskLedgerReconciler({
      enabled: () => true,
      now: () => clock,
      load: async () => [task],
      publish,
    });
    expect(await reconciler.tick()).toMatchObject({ attempted: 1, acknowledged: 0, pending: 1 });
    expect(await reconciler.tick()).toMatchObject({ attempted: 0 });
    clock += 60_001;
    expect(await reconciler.tick()).toMatchObject({ attempted: 1, acknowledged: 1, pending: 0 });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("backs off after a transient 503, and uses canonical state on the next attempt", async () => {
    let clock = Date.parse("2026-10-14T12:00:00Z");
    const publish = vi.fn()
      .mockResolvedValueOnce({ synced: false, reason: "remote_error" })
      .mockResolvedValueOnce({ synced: true, observedStatus: "COMPLETED", acknowledged: true });
    const reconciler = createAiTaskLedgerReconciler({
      enabled: () => true, now: () => clock,
      load: async () => [task], publish,
    });
    expect(await reconciler.tick()).toMatchObject({ pending: 1 });
    expect(await reconciler.tick()).toMatchObject({ attempted: 0 });
    clock += 60_001;
    expect(await reconciler.tick()).toMatchObject({ attempted: 1, acknowledged: 1 });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("replays a new terminal revision after a task was completed previously", async () => {
    let updated = task;
    const publish = vi.fn().mockResolvedValue({ synced: true, acknowledged: true });
    const reconciler = createAiTaskLedgerReconciler({
      enabled: () => true,
      load: async () => [updated],
      publish,
    });
    await reconciler.tick();
    updated = { ...task, updatedAt: new Date("2026-10-14T12:00:00Z") };
    await reconciler.tick();
    expect(publish).toHaveBeenCalledTimes(2);
  });
});

describe("prospective DEV passive-only producer scope", () => {
  const since = new Date("2026-11-27T19:08:02.868Z");
  const fresh = { ...task, taskNumber: task.id.slice(0,8), sourceKind: "bridge-command" as const,
    createdAt: new Date("2026-11-28T01:00:00Z"), updatedAt: new Date("2026-11-28T01:00:01Z") };
  const fixedNow = () => Date.parse("2026-11-28T02:00:00Z");

  it("reads only scoped eligible future commands and retains receiver-owned ACK", async () => {
    const legacy = vi.fn(async () => [task]);
    const scoped = vi.fn(async () => [
      fresh, task, { ...fresh, createdAt: new Date("2026-11-27T19:00:00Z") },
      { ...fresh, status: "RECEIVED" }, { ...fresh, sessionId: "other" },
    ]);
    const publish = vi.fn(async () => ({synced: true, acknowledged: false, observedStatus: "WAITING_FOR_ACK"}));
    const reconciler = createAiTaskLedgerReconciler({ enabled: () => true, now: fixedNow,
      readScope: () => ({mode:"dev-passive-ping",since}), load: legacy,
      loadTasks: legacy, loadWorkstreams: legacy, loadBridgeCommands: legacy,
      loadScopedBridgeCommands: scoped, publish });
    expect(await reconciler.tick()).toEqual({scanned:1,attempted:1,acknowledged:0,pending:1});
    expect(legacy).not.toHaveBeenCalled();
    expect(scoped).toHaveBeenCalledWith(0,since);
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      externalId:"bridge-command:"+fresh.id,title:"AI Core bridge command "+fresh.taskNumber,status:"COMPLETED",version:"terminal",
    });
  });

  it("invalid scope pauses without fallback or database reads", async () => {
    const load = vi.fn(async () => [fresh]);
    const publish = vi.fn();
    const r = createAiTaskLedgerReconciler({ enabled: () => true, now: fixedNow,
      readScope: () => ({mode:"blocked"}), load, loadScopedBridgeCommands: load, publish });
    expect(await r.tick()).toEqual({scanned:0,attempted:0,acknowledged:0,pending:0});
    expect(load).not.toHaveBeenCalled();expect(publish).not.toHaveBeenCalled();
  });

  it("a fresh source still retries only publication until independent receiver ACK", async () => {
    let now = fixedNow();
    const publish=vi.fn().mockResolvedValueOnce({synced:true,acknowledged:false,observedStatus:"WAITING_FOR_ACK"})
      .mockResolvedValueOnce({synced:true,acknowledged:true,observedStatus:"COMPLETED"});
    const r=createAiTaskLedgerReconciler({enabled:()=>true,now:()=>now,readScope:()=>({mode:"dev-passive-ping",since}),
      loadScopedBridgeCommands:async()=>[fresh],publish});
    expect(await r.tick()).toMatchObject({attempted:1,acknowledged:0,pending:1});
    expect(await r.tick()).toMatchObject({attempted:0});
    now+=60_001;
    expect(await r.tick()).toMatchObject({attempted:1,acknowledged:1,pending:0});
    now+=60_001;
    expect(await r.tick()).toMatchObject({attempted:0});
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
