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

  it("accepts travelincar typo as the travelincars target", () => {  it("handles existing target file scenario", () => {
    const mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      writeFileSync: vi.fn(),
    };
    vi.stubGlobal("fs", mockFs);

    const targetPath = "/path/to/existing/file";
    const instruction = "test instruction";

    expect(() => {
      dispatchDirectChatGptAccountWork(targetPath, instruction);
    }).not.toThrow();

    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    expect(mockFs.existsSync).toHaveBeenCalledWith(targetPath);
  });


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
