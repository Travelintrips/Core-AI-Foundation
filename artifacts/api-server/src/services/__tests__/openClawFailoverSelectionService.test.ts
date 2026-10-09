import { describe, expect, it } from "vitest";
import { selectOpenClawExecutor } from "../openClawFailoverSelectionService.js";

describe("OpenClaw PC single-active failover", () => {
  const online = (clientId: string, eligible = true, availableSlots = 1, activeJobs = 0) =>
    ({ clientId, eligible, availableSlots, activeJobs });
  it("keeps PC1 active even while it is busy or reports zero slots", () => {
    expect(selectOpenClawExecutor([
      online("openclaw-pc-worker", true, 0, 3),
      online("openclaw-pc-worker-2"),
      online("openclaw-pc-worker-3"),
    ])).toBe("openclaw-pc-worker");
  });
  it("fails over only when the primary becomes unhealthy", () => {
    expect(selectOpenClawExecutor([
      online("openclaw-pc-worker", false),
      online("openclaw-pc-worker-2"),
      online("openclaw-pc-worker-3"),
    ])).toBe("openclaw-pc-worker-2");
  });
  it("keeps backup active after PC1 reconnects until that backup becomes unhealthy", () => {
    const nodes = [online("openclaw-pc-worker"), online("openclaw-pc-worker-2")];
    expect(selectOpenClawExecutor(nodes, { activePcId: "openclaw-pc-worker-2" }))
      .toBe("openclaw-pc-worker-2");
    nodes[1].eligible = false;
    expect(selectOpenClawExecutor(nodes, { activePcId: "openclaw-pc-worker-2" }))
      .toBe("openclaw-pc-worker");
  });
  it("picks PC3 if the first two PCs are offline", () => {
    expect(selectOpenClawExecutor([
      online("openclaw-pc-worker", false),
      online("openclaw-pc-worker-2", false),
      online("openclaw-pc-worker-3"),
    ])).toBe("openclaw-pc-worker-3");
  });
  it("never routes ChatGPT-PC work to VPS or legacy GCP", () => {
    expect(selectOpenClawExecutor([
      online("openclaw-vps-main"), online("gcp-openclaw-main"),
      online("openclaw-pc-worker", false),
      online("openclaw-pc-worker-2", false),
      online("openclaw-pc-worker-3", false),
    ])).toBeNull();
  });
  it("routes server-only monitoring to VPS, not PCs", () => {
    expect(selectOpenClawExecutor([
      online("openclaw-vps-main"), online("openclaw-pc-worker"),
    ], { preferServer: true })).toBe("openclaw-vps-main");
    expect(selectOpenClawExecutor([online("openclaw-pc-worker")], { preferServer: true }))
      .toBeNull();
  });
});
