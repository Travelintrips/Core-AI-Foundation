import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../middleware/agentServiceAuth.js", () => ({
  requireAgentServiceScope: (_scope: string, binding: (hash: string) => string) => (req: any, res: any, next: any) => {
    if (req.get("Authorization") !== "Bearer test-valid-agent-presence") {
      res.status(401).json({ error: "NO_SCOPED_AGENT_TOKEN" }); return;
    }
    res.locals.aiAgentService = {
      id: req.get("x-test-service-id") || "service-id-1",
      name: req.get("x-test-service-name") || "openclaw-vps-dev-consumer",
      scopes: ["agent:presence"],
      credentialBinding: binding("a".repeat(64)),
    };
    next();
  },
}));
vi.mock("@workspace/db", () => ({
  assertDevelopmentDatabaseIsolation: vi.fn(),
  pool: { options: { connectionString: "unused-isolated-test" } },
}));
const policy = vi.hoisted(() => ({ evaluated: vi.fn() }));
vi.mock("../../services/gpt02OpenClawReaderCustodyPolicy.js", () => ({
  GPT02_READER_CUSTODY_SCOPE: "GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV",
  evaluateGpt02ReaderCustodyCoordination: (arg: any) => {
    policy.evaluated(arg);
    return { allowed: arg.workerAttestationVerified && arg.leaseActive && arg.verifiedHealthy && arg.action !== "ALTER_ROLE_PASSWORD" };
  },
}));
vi.mock("../../services/externalAgentRegistryService.js", () => ({
  getExternalAgentRegistrySnapshot: async () => [],
}));
import { createGpt02ReaderCustodyBroker } from "../gpt02-reader-custody-broker.js";
function makeApp(opts: { attested?: boolean; active?: boolean; healthy?: boolean; receipt?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  const verifyWorkerAttestation = vi.fn().mockResolvedValue(opts.attested ?? false);
  const readPresence = vi.fn().mockResolvedValue({ active: opts.active ?? true, healthy: opts.healthy ?? true });
  const readDbaCustodyReceipt = vi.fn().mockResolvedValue({ verified: opts.receipt ?? false, receiptId: opts.receipt ? "receipt-safe-1" : null });
  app.use("/api/gpt02-reader-custody", createGpt02ReaderCustodyBroker({
    verifyWorkerAttestation, readPresence, readDbaCustodyReceipt,
  }));
  return { app, verifyWorkerAttestation, readPresence, readDbaCustodyReceipt };
}
const url = "/api/gpt02-reader-custody";
const auth = { Authorization: "Bearer test-valid-agent-presence" };
describe("GPT02 reader custody broker denies unsafe authority", () => {
  beforeEach(() => policy.evaluated.mockClear());
  it("requires an authenticated agent token", async () => {
    const s = makeApp();
    const r = await request(s.app).get(url+"/status");
    expect(r.status).toBe(401);
    expect(s.verifyWorkerAttestation).not.toHaveBeenCalled();
  });
  it("rejects other service-token names even when scoped", async () => {
    const s=makeApp({attested:true,receipt:true});
    const r=await request(s.app).get(url+"/status").set({...auth,"x-test-service-name":"gcp-ai-workers-primary"});
    expect(r.status).toBe(403);
    expect(s.readDbaCustodyReceipt).not.toHaveBeenCalled();
  });
  it("stays locked when independent worker attestation is unavailable", async () => {
    const s=makeApp();
    const r=await request(s.app).get(url+"/status").set(auth);
    expect(r.status).toBe(403);
    expect(r.body.state).toBe("LOCKED");
    expect(s.readDbaCustodyReceipt).not.toHaveBeenCalled();
  });
  it.each([[false,true],[true,false]])("rejects inactive lease or unhealthy state", async (active,healthy)=>{
    const s=makeApp({attested:true,active,healthy});
    const r=await request(s.app).get(url+"/status").set(auth);
    expect(r.status).toBe(403);
  });
  it("reports missing DBA custody without producing credentials", async () => {
    const s=makeApp({attested:true});
    const r=await request(s.app).get(url+"/status").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.state).toBe("AWAITING_AUTHORIZED_DBA");
    expect(r.body.secretExposed).toBe(false);
    expect(r.body.databaseMutationGranted).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/password|dsn|tokenHash/i);
  });
  it("never issues a password and keeps coordinator request pending without custodian", async () => {
    const s=makeApp({attested:true});
    const r=await request(s.app).post(url+"/request").set(auth).send({action:"REQUEST_AUTHORIZED_CUSTODIAN_PROVISIONING"});
    expect(r.status).toBe(409);
    expect(r.body.credentialIssuedByBroker).toBe(false);
    expect(r.body.directPostgresPrivileges).toBe(false);
  });
  it.each(["ALTER_ROLE_PASSWORD","READ_CREDENTIAL","DEPLOY_PRODUCTION","ACTIVATE_SIGNER"])("rejects mutation action %s", async (action)=>{
    const s=makeApp({attested:true,receipt:true});
    const r=await request(s.app).post(url+"/request").set(auth).send({action});
    expect(r.status).toBe(400);
    expect(s.readDbaCustodyReceipt).not.toHaveBeenCalled();
  });
  it("rejects password payload even with allowed action", async ()=>{
    const s=makeApp({attested:true,receipt:true});
    const r=await request(s.app).post(url+"/request").set(auth).send({action:"VERIFY_NON_SECRET_READER_STATUS", password:"should-not-pass"});
    expect(r.status).toBe(400);
  });
  it("only reports a non-secret receipt, never creates it", async ()=>{
    const s=makeApp({attested:true,receipt:true});
    const r=await request(s.app).get(url+"/status").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.receiptId).toBe("receipt-safe-1");
    expect(r.body.databaseMutationGranted).toBe(false);
  });
});
