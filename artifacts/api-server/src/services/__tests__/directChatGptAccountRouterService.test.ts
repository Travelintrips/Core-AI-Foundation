import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchDirectChatGptAccountWork,
  isDirectChatGptAccountReset,
  parseDirectChatGptAccountRequest,
  parseDirectChatGptAccountTarget,
  resolveDirectChatGptAccountTargetFromContext,
} from "../directChatGptAccountRouterService.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("directChatGptAccountRouterService", () => {
  it("selects primary account when multiple are configured", () => {
    vi.stubEnv("CHATGPT_ACCOUNTS", JSON.stringify([
      { name: "acc1", primary: true },
      { name: "acc2" }
    ]));
    const target = resolveDirectChatGptAccountTargetFromContext("test instruction");
    expect(target).toEqual("acc1");
  });

  it("falls back to first account when no primary is configured", () => {
    vi.stubEnv("CHATGPT_ACCOUNTS", JSON.stringify([
      { name: "acc1" },
      { name: "acc2" }
    ]));
    const target = resolveDirectChatGptAccountTargetFromContext("test instruction");
    expect(target).toEqual("acc1");
  });

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

  it("accepts travelincar typo as the travelincars target", () => {
    expect(parseDirectChatGptAccountTarget("@pakai akun travelincar,ya")).toBe("travelincars");
    expect(parseDirectChatGptAccountRequest("@pakai akun travelincar,ya")).toBeNull();
  });

  it("inherits the latest bound account from conversation context", () => {
    expect(resolveDirectChatGptAccountTargetFromContext([
      { role: "user", text: "@pakai akun travelincar,ya" },
      { role: "assistant", text: "Akun ChatGPT DEV travelincars dipilih." },
    ])).toBe("travelincars");
  });

  it("stops inheriting after an explicit account reset", () => {
    expect(isDirectChatGptAccountReset("@lepas akun")).toBe(true);
    expect(resolveDirectChatGptAccountTargetFromContext([
      { role: "user", text: "@pakai akun travelincars" },
      { role: "assistant", text: "Akun dipilih." },
      { role: "user", text: "@lepas akun" },
    ])).toBeNull();
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
