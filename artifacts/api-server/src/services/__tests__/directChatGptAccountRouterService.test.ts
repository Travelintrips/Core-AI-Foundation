import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchDirectChatGptAccountWork,
  parseDirectChatGptAccountRequest,
} from "../directChatGptAccountRouterService.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("directChatGptAccountRouterService", () => {
  it("routes explicit personal-account commands", () => {
    expect(parseDirectChatGptAccountRequest(
      "pakai akun personal: buat checklist kesehatan worker DEV",
    )).toEqual({
      target: "personal",
      instruction: "buat checklist kesehatan worker DEV",
    });
  });

  it("routes explicit travelincars commands", () => {
    expect(parseDirectChatGptAccountRequest(
      "gunakan akun travelincars untuk review hasil test",
    )).toEqual({
      target: "travelincars",
      instruction: "review hasil test",
    });
  });

  it("routes dual-account commands", () => {
    expect(parseDirectChatGptAccountRequest(
      "bagi ke dua akun: cek routing dan laporkan hasil",
    )).toEqual({
      target: "both",
      instruction: "cek routing dan laporkan hasil",
    });
  });

  it("supports automatic least-loaded ChatGPT routing syntax", () => {
    expect(parseDirectChatGptAccountRequest(
      "chatgpt: rangkum status worker hari ini",
    )).toEqual({
      target: "auto",
      instruction: "rangkum status worker hari ini",
    });
  });

  it("does not hijack non-execution discussion", () => {
    expect(parseDirectChatGptAccountRequest(
      "jelaskan perbedaan akun personal dan travelincars",
    )).toBeNull();
  });

  it("fails closed in production before any dispatch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(dispatchDirectChatGptAccountWork({
      target: "personal",
      instruction: "uji aman",
    })).rejects.toMatchObject({
      code: "CAPABILITY_DENIED",
      message: expect.stringContaining("DEV_ONLY"),
    });
  });
});
