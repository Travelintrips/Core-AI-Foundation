import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyAiCoreChatDispatch,
  DEFAULT_AI_CORE_CHAT_MODE,
  detectRemoteWorkerPreset,
  isAiCoreCapabilityQuery,
} from "../aiCoreChatIntentService.js";

describe("AI Core Chat automatic dispatch", () => {
  it.each([
    "Uji koneksi dua arah saja. Balas dengan AI_CORE_TWO_WAY_OK. Jangan mengubah file, konfigurasi, repository, atau melakukan deployment.",
    "Test two-way connection and echo OK",
    "Uji koneksi MCP",
  ])("keeps connectivity checks out of repository execution: %s", (message) => {
    expect(detectRemoteWorkerPreset(message)).toBeNull();
    expect(classifyAiCoreChatDispatch(message).kind).toBe("ANSWER");
  });

  it("still runs an explicitly requested suite while checking connectivity", () => {
    expect(detectRemoteWorkerPreset("Cek koneksi lalu jalankan test API server")).toBe("test");
  });
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
    expect(classifyAiCoreChatDispatch("cek kapasitas Hostinger jika OpenClaw dan n8n dipindahkan")).toMatchObject({
      kind: "INFRA_OPERATION",
      infrastructureOperation: "HOSTINGER_VPS_STATUS",
    });
    expect(classifyAiCoreChatDispatch("cek CPU RAM disk Hostinger untuk migrasi OpenClaw")).toMatchObject({
      kind: "INFRA_OPERATION",
      infrastructureOperation: "HOSTINGER_VPS_STATUS",
    });
    expect(classifyAiCoreChatDispatch("cek status OpenClaw dan OpenHands")).toMatchObject({
      kind: "INFRA_OPERATION",
      infrastructureOperation: "EXTERNAL_AGENT_STATUS",
    });
  });

  it.each([
    ["Hostinger restart VPS production sekarang", "HOSTINGER_VPS_RESTART"],
    ["Hostinger deploy docker project=aicore content=https://example.test/compose.yml ke production", "HOSTINGER_DOCKER_DEPLOY"],
    ["GCP restart VM production sekarang", "GCP_VM_RESTART"],
  ])("routes bounded production operations to the no-worker lane: %s", (message, operation) => {
    const decision = classifyAiCoreChatDispatch(message);
    expect(decision.kind).toBe("INFRA_OPERATION");
    expect(decision.infrastructureOperation).toBe(operation);
    expect(decision.executionLane).toBe("NO_WORKER");
  });

  it.each([
    "rerun GitHub workflow run=37470000000 repo=Travelintrips/Core-AI-Foundation",
    "rerun failed GitHub workflow run=37470000000 repo=Travelintrips/Core-AI-Foundation",
    "cancel GitHub workflow run=37470000000 repo=Travelintrips/Core-AI-Foundation",
    "merge PR #721 repo=Travelintrips/Core-AI-Foundation",
  ])("keeps explicit GitHub operations out of the Coding Orchestrator: %s", (message) => {
    const decision = classifyAiCoreChatDispatch(message);
    expect(decision.kind).toBe("GITHUB_OPERATION");
    expect(decision.executionLane).toBe("NO_WORKER");
  });

  it("routes an existing-commit Hostinger deploy to the no-worker GitHub lane", () => {
    const decision = classifyAiCoreChatDispatch(
      "Lakukan hanya recovery/deploy operasional Core AI Foundation ke Hostinger untuk exact commit 34e9b7ab317458894555c82205f5fe155189babe. Jangan scan/index repo dan jangan ubah kode.",
    );

    expect(decision).toMatchObject({
      kind: "GITHUB_OPERATION",
      githubOperation: "GITHUB_HOSTINGER_NODEJS_DEPLOY",
      executionLane: "NO_WORKER",
    });
  });

  it("keeps real source changes in the Coding Orchestrator even when Hostinger deploy is mentioned", () => {
    const decision = classifyAiCoreChatDispatch(
      "Perbaiki kode login lalu deploy hasilnya ke Hostinger production.",
    );

    expect(decision.kind).toBe("CONTROL_PLANE");
    expect(decision.workload.workload).toBe("CRITICAL_ACTION");
    expect(decision.githubOperation).toBeNull();
  });

  it("does not let incidental infrastructure examples hijack a coding-fix request", () => {
    const decision = classifyAiCoreChatDispatch(
      "Perbaiki routing intent AI Core. Tambahkan regression test seperti 'check GCP VM status' dan 'cek Ollama GPU aktif di production'.",
    );

    expect(decision.kind).toBe("CONTROL_PLANE");
    expect(decision.workload.workload).toBe("CODING");
    expect(decision.infrastructureOperation).toBeNull();
  });

  it.each([
    "cek apakah Ollama GPU aktif di production",
    "cek worker yang aktif",
    "audit production runtime read-only",
    "check GCP VM status",
  ])("keeps read-only runtime requests out of the coding control plane: %s", (message) => {
    const decision = classifyAiCoreChatDispatch(message);
    expect(decision.kind).not.toBe("CONTROL_PLANE");
    expect(decision.workload.requiresAgent).toBe(false);
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

  it.each([
    "buat kalau sudah selesai tidak perlu lagi review manual dari human, lakukan tindakan selanjutnya: merge PR, deploy ke staging, commit langsung ke repository",
    "setelah selesai merge PR, deploy ke staging, commit langsung ke repository",
  ])("does not stop verified autonomous delivery policy at the generic critical approval gate: %s", (message) => {
    const decision = classifyAiCoreChatDispatch(message);
    expect(decision.kind).toBe("CONTROL_PLANE");
    expect(decision.workload.workload).toBe("CODING");
    expect(decision.workload.requiresApproval).toBe(false);
    expect(decision.reason).not.toContain("explicit approval gate");
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


describe("existing CWS lifecycle command wiring", () => {
  it("routes named CWS lifecycle mutations to the existing-task handler before new task creation", () => {
    const source = readFileSync(
      new URL("../../routes/ai-core-chat.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("runExistingCodingTaskLifecycleCommand");
    expect(source).toContain("EXISTING_CWS_TASK");
    expect(source).toContain("disableAutonomousCodingTask(task.id)");
    expect(source).toContain("enableAutonomousCodingTask(task.id, boundedMax, { forceDisabled: true })");
    expect(source).toContain("Tidak ada task duplikat yang dibuat");
  });
});
