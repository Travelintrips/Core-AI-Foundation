import { describe, expect, it, vi } from "vitest";
const dbMock = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(), asc: vi.fn(), eq: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: dbMock,
  aiCodingTasksTable: { id: "id", status: "status" },
  aiCodingBridgeResponsesTable: {
    id:"id", kind:"kind", commandId:"commandId",
    taskId:"taskId", createdAt:"createdAt", acknowledgedAt:"acknowledgedAt",
  },
}));
import { getCodingTaskCompletionEvidence } from "../codingTaskCompletionEvidence.js";
function chain(result: unknown) {
  const value: any = { from: () => value, where: () => value, limit: async () => result,
    orderBy: async () => result };
  return value;
}
describe("read-only task evidence", () => {
  it("fails closed without a task", async () => {
    dbMock.select.mockReturnValueOnce(chain([]));
    expect((await getCodingTaskCompletionEvidence("test")).notificationAuthorized).toBe(false);
  });
  it("rejects ACK from an unrelated command", async () => {
    dbMock.select.mockReturnValueOnce(chain([{status:"COMPLETED"}]))
      .mockReturnValueOnce(chain([{id:"a",kind:"ACK",commandId:"old",createdAt:new Date(),acknowledgedAt:null},
        {id:"b",kind:"COMPLETED",commandId:"new",createdAt:new Date(),acknowledgedAt:null}]));
    const result = await getCodingTaskCompletionEvidence("test");
    expect(result.found).toBe(true);
    if (result.found) expect(result.bridgeCompleted).toBe(false);
  });
  it("never grants notification based on bridge completion alone", async () => {
    dbMock.select.mockReturnValueOnce(chain([{status:"COMPLETED"}]))
      .mockReturnValueOnce(chain([{id:"a",kind:"ACK",commandId:"c",createdAt:new Date(),acknowledgedAt:null},
        {id:"b",kind:"COMPLETED",commandId:"c",createdAt:new Date(),acknowledgedAt:null}]));
    const result = await getCodingTaskCompletionEvidence("test");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.hasAck).toBe(true);
      expect(result.bridgeCompleted).toBe(true);
      expect(result.notificationAuthorized).toBe(false);
    }
  });
});
