import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>();
  const client = { query: vi.fn().mockResolvedValue({}), release: vi.fn(),
    on: vi.fn((name: string, fn: (...args: any[]) => void) => { handlers.set(name, fn); return client; }) };
  const listener = { connect: vi.fn().mockResolvedValue(client), end: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
  const writer = { query: vi.fn().mockResolvedValue({}) };
  return { handlers, client, listener, writer };
});
vi.mock("@workspace/db", () => ({
  PostgresPool: class { constructor() { return fake.listener; } },
  pool: fake.writer,
  resolveDatabaseUrl: () => "postgres://test:test@localhost:5432/test",
}));
vi.mock("../../lib/logger.js", () => ({ logger: { warn: vi.fn() } }));

describe("external-agent durable queue wake-ups", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); fake.handlers.clear(); });

  it("uses a session connection for LISTEN without changing database identity", async () => {
    const { workEventSessionUrl } = await import("../externalAgentWorkEventService.js");
    expect(workEventSessionUrl("postgres://role:secret@aws-1-x.pooler.supabase.com:6543/postgres?sslmode=require"))
      .toBe("postgres://role:secret@aws-1-x.pooler.supabase.com:5432/postgres?sslmode=require");
    expect(workEventSessionUrl("postgres://role:secret@localhost:6543/dev"))
      .toBe("postgres://role:secret@localhost:6543/dev");
  });

  it("shares one LISTEN connection and wakes only the addressed worker", async () => {
    const service = await import("../externalAgentWorkEventService.js");
    const first = vi.fn(), second = vi.fn(), lost = vi.fn();
    const stop = await service.subscribeExternalAgentWork("pc1", first, lost);
    await service.subscribeExternalAgentWork("vps", second, lost);
    expect(fake.listener.connect).toHaveBeenCalledTimes(1);
    expect(fake.client.query).toHaveBeenCalledWith("LISTEN ai_external_work_available_v1");
    const commandId = "11111111-1111-4111-8111-111111111111";
    fake.handlers.get("notification")!({ channel: "ai_external_work_available_v1", payload: JSON.stringify({clientId:"pc1", commandId}) });
    expect(first).toHaveBeenCalledWith(commandId);
    expect(second).not.toHaveBeenCalled();
    stop();
    fake.handlers.get("notification")!({ channel: "ai_external_work_available_v1", payload: JSON.stringify({clientId:"pc1", commandId}) });
    expect(first).toHaveBeenCalledTimes(1);
    fake.handlers.get("notification")!({channel:"ai_external_work_available_v1",payload:"not json"});
    expect(lost).not.toHaveBeenCalled();
    fake.handlers.get("error")!();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(fake.client.release).toHaveBeenCalledWith(true);
  });

  it("publishes a cross-process hint containing no instruction or token", async () => {
    const { notifyExternalAgentWork } = await import("../externalAgentWorkEventService.js");
    await notifyExternalAgentWork("vps", "command-1");
    expect(fake.writer.query).toHaveBeenCalledWith("SELECT pg_notify($1, $2)",
      ["ai_external_work_available_v1", JSON.stringify({ clientId:"vps",commandId:"command-1" })]);
    fake.writer.query.mockRejectedValueOnce(new Error("offline"));
    await expect(notifyExternalAgentWork("vps", "command-2")).resolves.toBeUndefined();
  });
});
