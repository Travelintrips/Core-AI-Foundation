import { describe, expect, it, vi } from "vitest";
import { withCodingWorkspaceReadRetry } from "../localCodingWorkspaceReadService.js";

describe("withCodingWorkspaceReadRetry", () => {
  it("recovers from bounded transient read failures", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("pool reset"))
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValueOnce({ ok: true });

    await expect(
      withCodingWorkspaceReadRetry(operation, { attempts: 3, delayMs: 0 }),
    ).resolves.toEqual({ ok: true });
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("fails after the configured bounded attempts", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("db unavailable"));

    await expect(
      withCodingWorkspaceReadRetry(operation, { attempts: 2, delayMs: 0 }),
    ).rejects.toThrow("db unavailable");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("bounds excessive retry configuration", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("still down"));

    await expect(
      withCodingWorkspaceReadRetry(operation, { attempts: 99, delayMs: 0 }),
    ).rejects.toThrow("still down");
    expect(operation).toHaveBeenCalledTimes(5);
  });
});
