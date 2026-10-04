// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./ai-core-chat.tsx", import.meta.url),
  "utf8",
);

describe("AI Core voice library UI", () => {
  it("loads and renders the provider voice library", () => {
    expect(source).toContain('apiFetch<VoiceLibraryResponse>("/api/ai/core-chat/voices")');
    expect(source).toContain('data-testid="button-open-voice-library"');
    expect(source).toContain('data-testid="voice-library-panel"');
    expect(source).toContain('data-testid="input-search-voice-library"');
    expect(source).toContain('data-testid={`voice-library-item-${voice.voiceId}`}');
  });

  it("persists a selected provider voice and keeps it on Standard transport", () => {
    expect(source).toContain('const VOICE_LIBRARY_ID_KEY = "ai_core_voice_library_id_v1"');
    expect(source).toContain('setSelectedLibraryVoiceId(voice.voiceId)');
    expect(source).toContain('selectVoiceTransportMode("standard")');
    expect(source).toContain('localStorage.setItem(VOICE_LIBRARY_ID_KEY, selectedLibraryVoiceId)');
  });

  it("uses the selected provider voice for replies and bypasses browser streaming TTS", () => {
    expect(source).toContain('/api/ai/core-chat/voices/${encodeURIComponent(voiceId)}/${endpoint}');
    expect(source).toContain('endpoint: "preview" | "speak" = "preview"');
    expect(source).toContain('(voicePreset === "cloned" || Boolean(selectedLibraryVoiceId))');
    expect(source).toContain('(voicePreset === "cloned" || selectedLibraryVoiceId) && completeStreamReply.trim()');
  });

  it("keeps provider-library and cloned/browser selections mutually exclusive", () => {
    expect(source).toContain('setSelectedLibraryVoiceId("");\n      setVoicePreset("cloned")');
    expect(source).toContain('cancelQueuedVoiceOutput();\n                        setSelectedLibraryVoiceId("");');
    expect(source).toContain("Realtime tetap memakai voice OpenAI Realtime.");
  });
});
