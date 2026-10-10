import { describe, expect, it } from "vitest";
import { detectExplicitExternalAgentClientId } from "../externalAgentDispatchService.js";

describe("Issue #980: explicit external-agent routing", () => {
  it("routes a deliberate OpenClaw PC delegation to the PC worker", () => {
    expect(detectExplicitExternalAgentClientId("suruh OpenClaw PC cek deployment")).toBe("openclaw-pc-worker");
  });

  it("recognizes an explicit Travelintrips PC delegation as primary PC", () => {
    expect(detectExplicitExternalAgentClientId("suruh OpenClaw PC Travelintrips uji SSH read-only")).toBe("openclaw-pc-worker");
  });

  it("routes a deliberate OpenClaw VPS delegation to the VPS worker", () => {
    expect(detectExplicitExternalAgentClientId("gunakan OpenClaw VPS untuk cek")).toBe("openclaw-vps-main");
  });

  it("does not hijack a GitHub coding task merely mentioning OpenClaw", () => {
    expect(detectExplicitExternalAgentClientId("perbaiki repo github integrasi OpenClaw melalui PR")).toBeNull();
  });

  it("keeps explicit OpenClaw delegation even when the instruction mentions a repo", () => {
    expect(detectExplicitExternalAgentClientId("suruh OpenClaw PC cek repo github")).toBe("openclaw-pc-worker");
  });

  it("does not delegate a plain mention without an explicit delegation verb", () => {
    expect(detectExplicitExternalAgentClientId("OpenClaw PC belum aktif")).toBeNull();
  });
});
