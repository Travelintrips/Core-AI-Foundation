import { describe, it, expect, vi } from "vitest";
import { retryRequest } from "../retryLogic";

describe("retryRequest transient error handling", () => {
  it("retries on 503 errors and succeeds on third attempt", async () => {
    const mockRequest = vi.fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200, data: "ok" });

    const result = await retryRequest(mockRequest, { retries: 3 });
    expect(result).toEqual({ status: 200, data: "ok" });
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });

  it("does not retry on non-503 errors and throws immediately", async () => {
    const mockRequest = vi.fn().mockRejectedValue(new Error("Bad Request"));
    await expect(retryRequest(mockRequest, { retries: 3 })).rejects.toThrow("Bad Request");
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
