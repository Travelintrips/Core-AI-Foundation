import { describe, expect, it, vi } from "vitest";
import { createDevBridgeEvidenceReader } from "../services/aiCoreDevBridgeEvidenceReader.js";

describe("DEV bridge database reader", () => {
  it("queries only parameterized job IDs and returns authoritative fields", async () => {
    const query = vi.fn(async () => [{
      id: "36d3e275-4f7e-4b60-b27e-996f2b6456d9", source: "OPENCLAW",
      source_session_id: "android-dev:zfold4-paired-dev-20",
      status: "COMPLETED", callback_received_at: "2026-10-16T06:04:54Z",
      result_verified_at: "2026-10-16T06:04:55Z",
    }]);
    const reader = createDevBridgeEvidenceReader(query);
    const id = "36d3e275-4f7e-4b60-b27e-996f2b6456d9";
    expect((await reader.getJob(id))?.status).toBe("COMPLETED");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE id = $1::uuid"), [id]);
  });
  it("rejects malformed job identifiers before querying", async () => {
    const query = vi.fn(async () => []);
    const reader = createDevBridgeEvidenceReader(query);
    expect(await reader.getJob("anything' OR true")).toBeNull();
    expect(await reader.getJobEvents("not-a-uuid")).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
  it("fails closed when pairing registry is unavailable", async () => {
    const reader = createDevBridgeEvidenceReader(async () => [], "/nonexistent/dev-bridge-registry");
    await expect(reader.isCurrentlyPaired("zfold4-paired-dev-20")).rejects.toThrow();
    expect(await reader.isCurrentlyPaired("../other")).toBe(false);
  });
});
