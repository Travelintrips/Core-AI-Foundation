import { describe, expect, it } from "vitest";
import {
  classifyAiCoreChatDispatch,
  DEFAULT_AI_CORE_CHAT_MODE,
  detectRemoteWorkerPreset,
  isAiCoreCapabilityQuery,
} from "../aiCoreChatIntentService.js";

describe("AI Core Chat automatic dispatch", () => {
  it("defaults to one automatic chat mode", () => {
    expect(DEFAULT_AI_CORE_CHAT_MODE).toBe("auto");
  });

  it("recognizes capability questions for deterministic capability reporting", () => {
    expect(isAiCoreCapabilityQuery("saya ingin tau kemampuan anda sebagai asisten")).toBe(true);
    expect(isAiCoreCapabilityQuery("Anda bisa apa?")).toBe(true);
    expect(isAiCoreCapabilityQuery("apa capabilities AI Core?")).toBe(true);
    expect(
      isAiCoreCapabilityQuery("apakah sekarang anda sudah dapat langsung mencari ke database?"),
    ).toBe(true);
    expect(isAiCoreCapabilityQuery("bisa query db langsung?")).toBe(true);
    expect(isAiCoreCapabilityQuery("Agent apa saja yang sudah terinstall disini")).toBe(true);
    expect(isAiCoreCapabilityQuery("Worker apa yang terpasang")).toBe(true);
    expect(isAiCoreCapabilityQuery("jelaskan Temporal")).toBe(false);
  });

  it("keeps normal questions on the answer path", () => {
    const decision = classifyAiCoreChatDispatch(
      "Apa perbedaan Temporal dan n8n untuk orchestration?",
    );

    expect(decision.kind).toBe("ANSWER");
    expect(decision.workload.requiresAgent).toBe(false);
  });

  it("does not confuse a business lookup with repository inspection", () => {
    const decision = classifyAiCoreChatDispatch("Cek booking SC-0992");

    expect(decision.kind).toBe("ANSWER");
    expect(decision.preset).toBeNull();
  });

  it("routes repository inspection to the trusted read-only worker", () => {
    const decision = classifyAiCoreChatDispatch(
      "Cek repository dan validasi test sebelum saya lanjut.",
    );

    expect(decision.kind).toBe("REMOTE_READONLY");
    expect(decision.workload.workload).toBe("REVIEW");
    expect(decision.preset).toBe("test");
  });

  it("routes build and test requests as read-only work", () => {
    expect(detectRemoteWorkerPreset("build repository ini")).toBe("build");
    expect(detectRemoteWorkerPreset("uji test API secara read-only")).toBe("test");
  });

  it("routes Hostinger and GCP operations to the infrastructure executor", () => {
    expect(classifyAiCoreChatDispatch("cek status Hostinger VPS")).toMatchObject({
      kind: "INFRA_OPERATION",
      infrastructureOperation: "HOSTINGER_VPS_STATUS",
    });
    expect(classifyAiCoreChatDispatch("restart GCP ollama VM")).toMatchObject({
      kind: "INFRA_OPERATION",
      infrastructureOperation: "GCP_VM_RESTART",
    });
    expect(classifyAiCoreChatDispatch("cek status OpenClaw dan OpenHands")).toMatchObject({
      kind: "INFRA_OPERATION",
      infrastructureOperation: "EXTERNAL_AGENT_STATUS",
    });
  });

  it("routes explicit bounded OpenClaw delegation to the external-agent queue", () => {
    const decision = classifyAiCoreChatDispatch(
      "Gunakan OpenClaw untuk koordinasikan pemeriksaan integrasi ini.",
    );

    expect(decision.kind).toBe("EXTERNAL_AGENT");
    expect(decision.externalAgentClientId).toBe("gcp-openclaw-main");
    expect(decision.workload.requiresAgent).toBe(false);
  });


  it("routes explicit OpenHands read-only coding work to the OpenHands queue", () => {
    const decision = classifyAiCoreChatDispatch(
      "Gunakan OpenHands untuk review TypeScript repository ini tanpa mengubah file.",
    );

    expect(decision.kind).toBe("EXTERNAL_AGENT");
    expect(decision.externalAgentClientId).toBe("gcp-openhands-coder");
  });

  it("routes explicit n8n workflow work to the n8n queue", () => {
    const decision = classifyAiCoreChatDispatch(
      "Gunakan n8n untuk validasi workflow automation dan webhook ini.",
    );

    expect(decision.kind).toBe("EXTERNAL_AGENT");
    expect(decision.externalAgentClientId).toBe("gcp-n8n-automation");
  });

  it("keeps mutating OpenHands coding work inside the Coding Orchestrator", () => {
    const decision = classifyAiCoreChatDispatch(
      "Gunakan OpenHands untuk perbaiki kode login lalu commit.",
    );

    expect(decision.kind).toBe("CONTROL_PLANE");
    expect(decision.externalAgentClientId).toBe("gcp-openhands-coder");
  });

  it("does not let OpenClaw bypass coding control-plane policy", () => {
    const decision = classifyAiCoreChatDispatch(
      "Gunakan OpenClaw untuk perbaiki kode login dan commit.",
    );

    expect(decision.kind).toBe("CONTROL_PLANE");
    expect(decision.workload.workload).toBe("CODING");
  });

  it("does not let OpenClaw bypass critical approval policy", () => {
    const decision = classifyAiCoreChatDispatch(
      "Pakai OpenClaw untuk deploy ke production sekarang.",
    );

    expect(decision.kind).toBe("CONTROL_PLANE");
    expect(decision.workload.workload).toBe("CRITICAL_ACTION");
    expect(decision.workload.requiresApproval).toBe(true);
  });

  it("routes coding changes directly to the control plane", () => {
    const decision = classifyAiCoreChatDispatch(
      "Perbaiki kode login dan test sampai hijau.",
    );

    expect(decision.kind).toBe("CONTROL_PLANE");
    expect(decision.workload.workload).toBe("CODING");
  });

  it("recognizes creating tests as coding rather than read-only testing", () => {
    const decision = classifyAiCoreChatDispatch(
      "Buat unit test untuk service auth lalu commit perubahannya.",
    );

    expect(decision.kind).toBe("CONTROL_PLANE");
    expect(decision.workload.workload).toBe("CODING");
  });

  it("routes critical actions to the control plane while preserving approval", () => {
    const decision = classifyAiCoreChatDispatch(
      "Deploy perubahan ini ke production.",
    );

    expect(decision.kind).toBe("CONTROL_PLANE");
    expect(decision.workload.workload).toBe("CRITICAL_ACTION");
    expect(decision.workload.requiresApproval).toBe(true);
  });

  it("never sends mutating language to the read-only worker", () => {
    expect(detectRemoteWorkerPreset("cek repo lalu perbaiki file yang salah")).toBeNull();
  });
});
