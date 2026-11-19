import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import {
  createCstDevOneJobSocketOptions, makeOneJobUnixSocketStream,
  CST_ONEJOB_DEV_SOCKET_PATH,
} from "../../lib/db/src/cstOneJobDevSocketTransport.ts";

const DEV_REF = "xssrfshdrtdfupgqwfdw";
const POOLER = "aws-0-ap-southeast-2.pooler.supabase.com";
const USER = "cst_team_model_pilot_20261119_abcdef12." + DEV_REF;
const FAKE_PASSWORD = "synthetic-no-secret-test-password-only";
const goodDsn = "postgresql://" + USER + ":" + FAKE_PASSWORD + "@" +
  POOLER + ":6543/postgres";
const env = Object.freeze({
  APP_ENV: "development", NODE_ENV: "development",
  CST_TEAM_DEV_DB_SOCKET_TRANSPORT_ENABLED: "true",
  CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED: "true",
  SUPABASE_URL_DEV: "https://" + DEV_REF + ".supabase.co",
  CST_TEAM_DEV_APPROVED_JOB_ID: "483",
  CST_TEAM_DEV_APPROVED_WORKER_NAME: "cst-dev-dell-onejob-20261119-abcdef12",
});
const checkRejected = (dsn, changes, reason) => {
  assert.throws(() => createCstDevOneJobSocketOptions(dsn, {...env,...changes}),new RegExp("CST_DEV_ONEJOB_SOCKET_"+reason));
};

test("disabled by default: no changes to ordinary DEV or PROD pool",()=>{
  assert.equal(createCstDevOneJobSocketOptions(goodDsn,{}),undefined);
  assert.equal(createCstDevOneJobSocketOptions(goodDsn,{
    ...env,CST_TEAM_DEV_DB_SOCKET_TRANSPORT_ENABLED:"false"
  }),undefined);
  checkRejected(goodDsn,{CST_TEAM_DEV_DB_SOCKET_TRANSPORT_ENABLED:"yes"},"FLAG_INVALID");
});

test("only exact Company-1 DEV model job and dedicated role can opt in",()=>{
  const opts=createCstDevOneJobSocketOptions(goodDsn,{...env});
  assert.equal(opts?.ssl.rejectUnauthorized,true);
  assert.equal(typeof opts?.stream,"function");
  assert.equal(CST_ONEJOB_DEV_SOCKET_PATH,
    "/run/cst-onejob-dev-db/pg-pooler.sock");
  checkRejected(goodDsn,{NODE_ENV:"production"},"ENVIRONMENT_DENIED");
  checkRejected(goodDsn,{APP_ENV:"production"},"ENVIRONMENT_DENIED");
  checkRejected(goodDsn,{CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED:"false"},"ENVIRONMENT_DENIED");
  checkRejected(goodDsn,{SUPABASE_PROD_DATABASE_URL:"postgresql://FAKE"},"ENVIRONMENT_DENIED");
  checkRejected(goodDsn,{SUPABASE_URL_DEV:"https://nzdweipzckfszczzqtuw.supabase.co"},"PROJECT_IDENTITY_DENIED");
  checkRejected(goodDsn,{CST_TEAM_DEV_APPROVED_JOB_ID:"482"},"ONE_JOB_BINDING_DENIED");
  checkRejected(goodDsn,{CST_TEAM_DEV_APPROVED_JOB_ID:"0"},"ONE_JOB_BINDING_DENIED");
  checkRejected(goodDsn,{CST_TEAM_DEV_APPROVED_WORKER_NAME:"openclaw-vps-main"},"ONE_JOB_BINDING_DENIED");
});

test("pooler hostname, port, login, query TLS overrides all fail closed",()=>{
  const wrongHost=goodDsn.replace(POOLER,"db."+DEV_REF+".supabase.co");
  const wrongProject=goodDsn.replaceAll(DEV_REF,"nzdweipzckfszczzqtuw");
  const wrongRole=goodDsn.replace("cst_team_model_pilot_20261119_abcdef12","postgres");
  const wrongPort=goodDsn.replace(":6543",":5432");
  for(const dsn of [wrongHost,wrongPort,
    goodDsn+"?sslmode=disable",goodDsn+"?sslmode=require",
    goodDsn+"?sslmode=no-verify",goodDsn+"#wrong"]) {
    checkRejected(dsn,{},"POOLER_DESTINATION_DENIED");
  }
  checkRejected(wrongProject,{},"DEDICATED_LOGIN_DENIED");
  checkRejected(wrongRole,{},"DEDICATED_LOGIN_DENIED");
  checkRejected(goodDsn.replace(FAKE_PASSWORD,"weak"),{},"DEDICATED_LOGIN_DENIED");
  checkRejected(goodDsn,{PGSSLMODE:"disable"},"TLS_OVERRIDE_DENIED");
  checkRejected(goodDsn,{PGSSLKEY:"/tmp/unsafe"},"TLS_OVERRIDE_DENIED");
});

test("pg 8.22 sends SSLRequest and correct pooler TLS SNI over injected Unix socket",async()=>{
  // No real network: an ephemeral Unix socket accepts just SSLRequest and
  // TLS ClientHello before deliberately resetting the connection. No auth.
  const requirePg = createRequire(new URL("../../lib/db/package.json",import.meta.url));
  const pg=requirePg("pg");
  const dir=mkdtempSync(join(tmpdir(),"cst-pg-uds-sni-"));
  const sock=join(dir,"mock.sock");
  let requestSeen=false,helloSeen=false,sniSeen=false;
  const server=createServer(socket=>{
    socket.once("data",data=>{
      requestSeen=data.length===8&&data.readUInt32BE(4)===80877103;
      if(!requestSeen){socket.destroy();return;}
      socket.write(Buffer.from("S"));
      socket.once("data",hello=>{
        helloSeen=hello[0]===22;
        sniSeen=hello.includes(Buffer.from(POOLER));
        socket.destroy();
      });
    });
  });
  const listen=()=>new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(sock,()=>{server.removeListener("error",reject);resolve();});
  });
  try {
    await listen();
    const client=new pg.Client({
      connectionString:goodDsn,
      ssl:{rejectUnauthorized:true},
      stream:makeOneJobUnixSocketStream(sock),
      connectionTimeoutMillis:1600,
    });
    try { await assert.rejects(client.connect()); }
    finally { await client.end().catch(()=>{}); }
    assert.equal(requestSeen,true);
    assert.equal(helloSeen,true);
    assert.equal(sniSeen,true);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
