import { describe, expect, it } from "vitest";
import { detectExplicitExternalAgentClientId, isDevChatGptWakeInstruction } from "../externalAgentDispatchService.js";

describe("Issue #980: explicit external-agent routing", () => {
  it("routes each dedicated Dell agent by exact identity", () => {
    for (const role of ["browser", "recovery", "verifier"]) {
      expect(detectExplicitExternalAgentClientId(`gunakan dell-${role} untuk tugas read-only DEV`))
        .toBe(`openclaw-pc-worker-dell-${role}`);
    }
  });


  it("routes the dedicated DELL ChatGPT wake worker by exact identity", () => {
    expect(detectExplicitExternalAgentClientId("gunakan openclaw-dell-chatgpt-wake-dev untuk wake DEV"))
      .toBe("openclaw-dell-chatgpt-wake-dev");
  });

  it("routes the portable GPT02 session worker by account identity", () => {
    expect(detectExplicitExternalAgentClientId("gunakan gpt02 session worker untuk wake DEV"))
      .toBe("openclaw-gpt02-session-dev");
    expect(detectExplicitExternalAgentClientId("gunakan openclaw-gpt02-session-dev untuk wake DEV"))
      .toBe("openclaw-gpt02-session-dev");
  });

  it("requires explicit delegation before selecting dedicated Dell agents", () => {
    expect(detectExplicitExternalAgentClientId("dell-browser belum online")).toBeNull();
  });

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

  it("documents that a named Travelintrips PC can fail over to another eligible PC worker", () => {
    // A named physical PC is not a hard pin to the worker-1 process.
    // Worker selection is performed by chooseActivePc when worker-1 is offline.
    expect(detectExplicitExternalAgentClientId("suruh OpenClaw PC Travelintrips gerakkan mouse")).toBe("openclaw-pc-worker");
  });
});

describe("DEV ChatGPT wake preflight contract", () => {
  const conversation = "6ad4e0a7-9964-83ec-81a6-9db5eb8457ae";
  const event = "a".repeat(64);
  const challenge = "b".repeat(64);

  it("accepts V1 and bounded V2 task payloads", () => {
    expect(isDevChatGptWakeInstruction(
      `DEV_CHATGPT_WAKE_V1 conversation=${conversation} event=${event} challenge=${challenge}`,
    )).toBe(true);
    expect(isDevChatGptWakeInstruction(
      `DEV_CHATGPT_WAKE_V2 conversation=${conversation} event=${event} challenge=${challenge} task=Y2VrIHBhZGEgZGVsbA`,
    )).toBe(true);
  });

  it("rejects freeform, malformed, or unbound V2 instructions", () => {
    expect(isDevChatGptWakeInstruction("cek pada dell ada berapa worker")).toBe(false);
    expect(isDevChatGptWakeInstruction(
      `DEV_CHATGPT_WAKE_V2 conversation=${conversation} event=${event} challenge=${challenge} task=not valid base64url!`,
    )).toBe(false);
    expect(isDevChatGptWakeInstruction(
      `DEV_CHATGPT_WAKE_V2 conversation=${conversation} event=${event} task=Y2Vr`,
    )).toBe(false);
  });
});
