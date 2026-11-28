import { describe, expect, it } from "vitest";
import { canUseHumanAssistance, canUseJobMonitorActions, createJobMonitorPollGate, jobMonitorAvailability, jobMonitorCount, parseHumanAssistanceSnapshot, parseJobMonitorSnapshot } from "../jobMonitorAvailability";

const job = { id:"fixture-1", title:"Synthetic job", source:"AI Core Engine", status:"FAILED" };
const assistance = { job_key:"engine:1", task_code:"FIXTURE-1", status:"assigned", resumeAllowed:false as const };

describe("DEV job monitor read availability", () => {
  it("distinguishes initial loading and unavailable from a verified empty snapshot", () => {
    expect(jobMonitorAvailability(true,null,null,[])).toBe("loading");
    expect(jobMonitorAvailability(false,null,null,[])).toBe("unavailable");
    expect(jobMonitorAvailability(false,"fixture-time",null,[])).toBe("ready");
    expect(jobMonitorCount(0,"loading")).toBe("—");
    expect(jobMonitorCount(0,"unavailable")).toBe("—");
    expect(jobMonitorCount(0,"ready")).toBe("0");
  });
  it("never treats partial-source zero as complete evidence", () => {
    const availability = jobMonitorAvailability(false,"fixture-time",null,["AI_TASK_BRIDGE_UNAVAILABLE"]);
    expect(availability).toBe("partial");
    expect(jobMonitorCount(0,availability)).toBe("—");
    expect(jobMonitorCount(4,availability)).toBe("4*");
    expect(canUseJobMonitorActions(availability)).toBe(false);
  });
  it("errors override last successful timestamp and partial warnings", () => {
    expect(jobMonitorAvailability(false,"old-time","HTTP 503",["AI_TASK_BRIDGE_UNAVAILABLE"])).toBe("unavailable");
    expect(jobMonitorCount(4,"unavailable")).toBe("—");
  });
  it("validates actual monitor payload and rejects absent or malformed data", () => {
    expect(parseJobMonitorSnapshot({jobs:[job],warnings:[]})).toEqual({jobs:[job],warnings:[]});
    expect(parseJobMonitorSnapshot({jobs:[]})).toEqual({jobs:[],warnings:[]});
    for (const invalid of [null,{}, {jobs:null},{jobs:[{}]},{jobs:[{...job,status:0}]},{jobs:[],warnings:null},{jobs:[],warnings:"ERROR"},{jobs:[],warnings:[1]}]) {
      expect(() => parseJobMonitorSnapshot(invalid)).toThrow("Format data monitoring tidak valid.");
    }
  });
  it("does not interpret missing or malformed human assistance as no existing request", () => {
    expect(parseHumanAssistanceSnapshot({requests:[]})).toEqual({});
    for (const invalid of [null,{}, {requests:null},{requests:[{}]},{requests:[{...assistance,resumeAllowed:true}]}]) {
      expect(() => parseHumanAssistanceSnapshot(invalid)).toThrow("HUMAN_ASSISTANCE_UNAVAILABLE");
    }
  });
  it("keeps newest source assistance row and explicit non-resume status", () => {
    expect(parseHumanAssistanceSnapshot({requests:[assistance,{...assistance,task_code:"OLDER",status:"completed"}]})).toEqual({"engine:1":assistance});
  });
  it("allows actions only on available source evidence and independently available assistance", () => {
    for (const state of ["loading","partial","unavailable"] as const) {
      expect(canUseJobMonitorActions(state)).toBe(false);
      expect(canUseHumanAssistance(state,"ready")).toBe(false);
    }
    expect(canUseJobMonitorActions("ready")).toBe(true);
    expect(canUseHumanAssistance("ready","loading")).toBe(false);
    expect(canUseHumanAssistance("ready","unavailable")).toBe(false);
    expect(canUseHumanAssistance("ready","ready")).toBe(true);
  });
  it("skips overlapping reads and releases lock after success and failure", async () => {
    const gate = createJobMonitorPollGate();
    let finish!: () => void;
    let calls = 0;
    const first = gate.run(() => { calls++; return new Promise<void>(resolve => { finish = resolve; }); });
    expect(await gate.run(async () => { calls++; })).toBe(false);
    expect(calls).toBe(1);
    finish();
    expect(await first).toBe(true);
    await expect(gate.run(async () => { throw new Error("fixture abort"); })).rejects.toThrow("fixture abort");
    expect(await gate.run(async () => { calls++; })).toBe(true);
    expect(calls).toBe(2);
  });
});
