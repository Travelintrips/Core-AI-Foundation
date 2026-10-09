import { describe, expect, it } from "vitest";
import { selectOpenClawExecutor } from "../openClawFailoverSelectionService.js";

describe("Issue #1007 OpenClaw PC-first failover", () => {
  const online = (clientId: string, eligible = true, availableSlots = 1, activeJobs = 0) =>
    ({ clientId, eligible, availableSlots, activeJobs });
  it("uses PC before VPS or GCP", () => {
    expect(selectOpenClawExecutor([online("openclaw-vps-main"), online("gcp-openclaw-main"), online("openclaw-pc-worker")])).toBe("openclaw-pc-worker");
  });
  it("distributes successive jobs across three PCs as capacity reports fill", () => {
    const nodes = [online("openclaw-pc-worker"), online("openclaw-pc-worker-2"), online("openclaw-pc-worker-3"), online("openclaw-vps-main")];
    expect(selectOpenClawExecutor(nodes)).toBe("openclaw-pc-worker");
    nodes[0].availableSlots = 0;
    expect(selectOpenClawExecutor(nodes)).toBe("openclaw-pc-worker-2");
    nodes[1].availableSlots = 0;
    expect(selectOpenClawExecutor(nodes)).toBe("openclaw-pc-worker-3");
    nodes[2].availableSlots = 0;
    expect(selectOpenClawExecutor(nodes)).toBe("openclaw-vps-main");
  });
  it("prefers the least loaded available PC", () => {
    expect(selectOpenClawExecutor([online("openclaw-pc-worker", true, 2, 2), online("openclaw-pc-worker-2", true, 1, 0)])).toBe("openclaw-pc-worker-2");
  });
  it("avoids unhealthy and saturated nodes", () => {
    expect(selectOpenClawExecutor([online("openclaw-pc-worker", false), online("openclaw-pc-worker-2", true, 0), online("openclaw-pc-worker-3")])).toBe("openclaw-pc-worker-3");
  });
  it("never sends server-only monitoring to any PC", () => {
    expect(selectOpenClawExecutor([online("openclaw-pc-worker"), online("gcp-openclaw-main"), online("openclaw-vps-main")], {preferServer:true})).toBe("openclaw-vps-main");
    expect(selectOpenClawExecutor([online("openclaw-pc-worker")], {preferServer:true})).toBeNull();
  });
  it("fails closed instead of launching a normal job on GCP or an offline executor", () => {
    expect(selectOpenClawExecutor([online("gcp-openclaw-main"), online("openclaw-vps-main", false)])).toBeNull();
  });
});
