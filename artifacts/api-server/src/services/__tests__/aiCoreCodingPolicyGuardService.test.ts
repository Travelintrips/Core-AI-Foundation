import { describe, expect, it } from "vitest";
import {
  aiCoreCodingDeniedResponse,
  isAiCoreCodingCommandBlocked,
} from "../aiCoreCodingPolicyGuardService.js";

describe("AI Core Chat coding policy refusal", () => {
  it.each([
    "@Perbaiki kode login dan update repository",
    "Buat kode untuk endpoint baru",
    "Gunakan Coding Orchestrator untuk perbaiki kode login dan test sampai hijau.",
    "Jalankan satu job uji Temporal Coding Worker VPS Hostinger TEST_ONLY tanpa merge atau deploy.",
    "# ubah kode backend untuk memperbaiki login",
  ])("rejects a coding instruction without worker dispatch: %s", message => {
    expect(isAiCoreCodingCommandBlocked(message)).toBe(true);
  });

  it.each([
    "Cek status worker Temporal VPS tanpa membuat job",
    "Cek repository dan validasi test sebelum saya lanjut.",
    "Apa perbedaan Temporal dan n8n?",
    "@restart GCP ollama VM",
    "Jalankan test repository read-only",
  ])("does not mislabel non-coding operations as permission failures: %s", message => {
    expect(isAiCoreCodingCommandBlocked(message)).toBe(false);
  });

  it("returns the requested human-readable refusal, not NO_WORKER", () => {
    const response = aiCoreCodingDeniedResponse();
    expect(response["blocked"]).toBe(true);
    expect(response["reason"]).toBe("coding_not_permitted");
    expect(response["executionLane"]).toBe("POLICY_BLOCKED");
    expect(response["reply"]).toMatch(/^Saya tidak diperbolehkan/);
    expect(String(response["reply"])).not.toMatch(/no[ _-]?worker/i);
  });
});
