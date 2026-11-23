import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { task189Target } from "../../services/task189ReleaseMandate.js";

// This suite has its own disposable PostgreSQL service. It never uses a caller's DSN.
vi.mock("../../services/internalAuthService.js", () => ({
  SESSION_COOKIE_NAME: "qa_session",
  verifySessionToken: (s: string) => s === "fixture-admin" ? { sub: 7 } : s === "other-admin" ? { sub: 8 } : null,
  getInternalUserById: async (id: number) => ({ id, accountType: "internal", status: "active", role: "admin", mustChangePassword:false }),
}));
vi.mock("../../services/aiAuditService.js", () => ({ logAudit: async () => {} }));

describe.skipIf(process.env.TASK189_DISPOSABLE_POSTGRES !== "1")("Task 189 release API with disposable PostgreSQL", () => {
  const host = "task189-fixture.pooler.supabase.com";
  const dsn = `postgresql://fixture.${task189Target.project}:fixture-only@${host}:5432/task189_fixture`;
  const origin = "https://dev.cstlogistic.co.id";
  const path = "/api/ai/agent-runtime/dev/task189-release";
  const app = express();
  const token = randomUUID();
  const other = randomUUID();
  const keys = generateKeyPairSync("ed25519");
  const id = randomUUID();
  let pool: typeof import("@workspace/db").pool;
  const admin = (op:string, body:unknown, session="fixture-admin") => request(app).post(path+op).set("Host", "dev.cstlogistic.co.id")
    .set("Origin",origin).set("Cookie","qa_session="+session).send(body as object);
  const worker = (grantId:string, who=token) => request(app).post(path+"/issue")
    .set("Host","dev.cstlogistic.co.id").set("Authorization","Bearer "+who).send({grantId});
  const digest = (value:string) => createHash("sha256").update(value).digest("hex");

  beforeAll(async () => {
    const addresses = await lookup(host, { all:true });
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.every(a=>a.address==="127.0.0.1")).toBe(true);
    vi.stubEnv("APP_ENV","development");
    vi.stubEnv("SUPABASE_URL_DEV",`https://${task189Target.project}.supabase.co`);
    vi.stubEnv("SUPABASE_DEV_DATABASE_URL",dsn);
    vi.stubEnv("CST_DEV_TASK189_DELEGATION_ENABLED","true");
    vi.stubEnv("CST_DEV_TASK189_REGISTRAR_PUBLIC_DER_B64",keys.publicKey.export({type:"spki",format:"der"}).toString("base64"));
    ({pool}=await import("@workspace/db"));
    expect(pool.options.connectionString).toBe(dsn);
    await pool.query(`CREATE ROLE gpt02_core_prep_login NOLOGIN CONNECTION LIMIT 0;
      CREATE SCHEMA ai_platform;
      CREATE TABLE ai_platform.ai_agent_service_tokens (
        id uuid PRIMARY KEY, name text UNIQUE, token_hash text UNIQUE, scopes text[],is_active boolean DEFAULT true,
        last_used_at timestamptz, expires_at timestamptz,metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE public.ai_execution_jobs(id uuid,task_id int,company_id text,status text,started_at timestamptz,final_ack_verified boolean)`);
    await pool.query("INSERT INTO public.ai_execution_jobs VALUES ($1,189,'default','prepared',NULL,false)",[task189Target.job]);
    await pool.query("INSERT INTO ai_platform.ai_agent_service_tokens(id,name,token_hash,scopes) VALUES ($1,$2,$3,ARRAY['agent:work']),($4,'different-worker',$5,ARRAY['agent:work'])",
      [id,task189Target.principal,digest(token),randomUUID(),digest(other)]);
    const migration = readFileSync(new URL("../../../../../scripts/migrations/20261124_task189_release_delegation.sql",import.meta.url),"utf8");
    const client=await pool.connect();
    try {
      await client.query("SET ai_core.dev_migration_authorized='true'");
      await client.query("SET ai_core.dev_project_ref='xssrfshdrtdfupgqwfdw'");
      await client.query(migration);
    } finally { client.release(); }
    const {default:router}=await import("../task189-release.js");
    app.use(express.json(),cookieParser());
    app.use("/api",router);
  });
  afterAll(async () => { if (pool) await pool.end(); vi.unstubAllEnvs(); });

  it("requires the independent grant, authenticates both actors and issues and consumes the permit once", async () => {
    const status=await request(app).get(path).set("Host","dev.cstlogistic.co.id").set("Cookie","qa_session=fixture-admin").expect(200);
    expect(status.body.credentialId).toBe(id);
    expect(status.body.state).toBe("MANDATE_NOT_REGISTERED");
    const inspect = () => request(app).get(path).set("Host","dev.cstlogistic.co.id").set("Cookie","qa_session=fixture-admin");
    const now=Date.now();
    const packet=(overrides:Record<string,unknown>={})=>{
      const mandate={...task189Target,grantId:randomUUID(),credentialId:id,credentialBinding:status.body.credentialBinding,
        redeemerUserId:7, notBefore:now-1000,expiresAt:now+150000,...overrides};
      return {mandate,signature:sign(null,Buffer.from(JSON.stringify(mandate)),keys.privateKey).toString("base64url")};
    };
    const good=packet();
    const grantId=good.mandate.grantId;
    await worker(grantId).expect(404);
    await request(app).post(path+"/register").set("Host","dev.cstlogistic.co.id").set("Origin",origin)
      .set("Authorization","Bearer "+token).send(good).expect(401);
    await request(app).post(path+"/register").set("Host","dev.cstlogistic.co.id").set("Origin","https://wrong.invalid")
      .set("Cookie","qa_session=fixture-admin").send(good).expect(403);
    await request(app).get(path).set("Host","unrelated.invalid").set("Cookie","qa_session=fixture-admin").expect(404);
    await admin("/register",packet({job:randomUUID()})).expect(400);
    await admin("/register",packet({expiresAt:now-1})).expect(409);
    await admin("/register",packet({credentialBinding:"0".repeat(64)})).expect(403);
    await admin("/register",{...good,signature:"A".repeat(86)}).expect(403);
    const revoked=packet();
    await admin("/register",revoked).expect(200);
    await admin("/revoke",{grantId:revoked.mandate.grantId}).expect(200);
    await admin("/register",revoked).expect(409);
    await worker(revoked.mandate.grantId).expect(409);
    await admin("/register",good).expect(200);
    await admin("/register",good).expect(200);
    expect((await inspect().expect(200)).body.state).toBe("MANDATE_ACTIVE");
    await pool.query("ALTER ROLE gpt02_core_prep_login CONNECTION LIMIT 1");
    expect((await inspect().expect(200)).body.state).toBe("PREPARER_RELOCK_UNVERIFIED");
    await worker(grantId).expect(409);
    await pool.query("ALTER ROLE gpt02_core_prep_login CONNECTION LIMIT 0");
    await pool.query("UPDATE public.ai_execution_jobs SET started_at=now()");
    await worker(grantId).expect(409);
    await pool.query("UPDATE public.ai_execution_jobs SET started_at=NULL");
    await worker(grantId,other).expect(403);
    const rotated=randomUUID();
    await pool.query("UPDATE ai_platform.ai_agent_service_tokens SET token_hash=$1 WHERE id=$2",[digest(rotated),id]);
    await worker(grantId,rotated).expect(403);
    await worker(grantId).expect(401);
    await pool.query("UPDATE ai_platform.ai_agent_service_tokens SET token_hash=$1 WHERE id=$2",[digest(token),id]);
    const results=await Promise.all(Array.from({length:8},()=>worker(grantId).expect(200)));
    const permitId=results[0].body.permitId;
    expect(new Set(results.map(r=>r.body.permitId)).size).toBe(1);
    expect(results.every(r=>r.body.usable===true)).toBe(true);
    const another=packet();
    await admin("/register",another).expect(409);
    await worker(another.mandate.grantId).expect(404);
    expect((await inspect().expect(200)).body.state).toBe("PERMIT_ISSUED");
    await admin("/redeem",{grantId,permitId:randomUUID()}).expect(409);
    await admin("/redeem",{grantId,permitId},"other-admin").expect(403);
    const consumption=await Promise.all([admin("/redeem",{grantId,permitId}),admin("/redeem",{grantId,permitId})]);
    expect(consumption.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await inspect().expect(200)).body.state).toBe("PERMIT_CONSUMED");
    const replay=await worker(grantId).expect(200);
    expect(replay.body).toMatchObject({permitId,usable:false});
    await expect(pool.query("UPDATE task189_release.permit SET consumed_at=NULL,consumed_by=NULL")).rejects.toThrow(/immutable/);
    expect((await pool.query("SELECT count(*)::int AS count FROM task189_release.permit")).rows[0].count).toBe(1);
    expect((await pool.query("SELECT started_at,final_ack_verified FROM public.ai_execution_jobs")).rows[0])
      .toEqual({started_at:null,final_ack_verified:false});
  });
});
