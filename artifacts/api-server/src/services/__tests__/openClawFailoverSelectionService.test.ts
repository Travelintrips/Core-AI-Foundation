import { describe, expect, it } from "vitest";
import { selectOpenClawExecutor } from "../openClawFailoverSelectionService.js";

describe("OpenClaw executor selection", () => {
  const online = (clientId: string, eligible: boolean) => ({ clientId, eligible });
  it("prefers PC whenever both are healthy", () => {
    expect(selectOpenClawExecutor([online("openclaw-vps-main", true), online("openclaw-pc-worker", true)])).toBe("openclaw-pc-worker");
  });
  it("uses VPS if PC is unavailable", () => {
    expect(selectOpenClawExecutor([online("openclaw-vps-main", true), online("openclaw-pc-worker", false)])).toBe("openclaw-vps-main");
  });
  it("uses legacy worker only if the new hosts are both unavailable", () => {
    expect(selectOpenClawExecutor([online("gcp-openclaw-main", true), online("openclaw-pc-worker", false)])).toBe("gcp-openclaw-main");
  });
  it("routes direct server monitoring to the VPS/legacy server, not a healthy PC", () => {
    expect(selectOpenClawExecutor([
      online("openclaw-pc-worker", true),
      online("gcp-openclaw-main", true),
      online("openclaw-vps-main", false),
    ], { preferServer: true })).toBe("gcp-openclaw-main");
  });
  it("fails closed when only the PC is available for server monitoring", () => {
    expect(selectOpenClawExecutor([online("openclaw-pc-worker", true)], { preferServer: true })).toBeNull();
  });
  it("does not pretend that an offline executor is available", () => {
    expect(selectOpenClawExecutor([online("openclaw-vps-main", false), online("openclaw-pc-worker", false)])).toBeNull();
  });
});
