import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import { mkdtempSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CST_DEV_FIXED_POOLER,startOfflineMockBroker,
} from "./cst-team-onejob-fixed-db-broker.mjs";
import {
  makeOneJobUnixSocketStream, createCstDevOneJobSocketOptions,
} from "../../lib/db/src/cstOneJobDevSocketTransport.ts";

const CA_FIXTURE=fileURLToPath(new URL("./fixtures/supabase-root-2021-public-qa.crt",import.meta.url));
const REF="xssrfshdrtdfupgqwfdw";
const POOLER=CST_DEV_FIXED_POOLER.host;
const USER="cst_team_model_pilot_20261120_abcdef12."+REF;
const DSN="postgresql://"+USER+":synthetic-fake-password-not-real@"+
  POOLER+":6543/postgres";
const environment={
  APP_ENV:"development",NODE_ENV:"development",
  CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED:"true",
  CST_TEAM_DEV_DB_SOCKET_TRANSPORT_ENABLED:"true",
  SUPABASE_URL_DEV:"https://"+REF+".supabase.co",
  CST_TEAM_DEV_APPROVED_JOB_ID:"483",
  CST_TEAM_DEV_APPROVED_WORKER_NAME:"cst-dev-dell-onejob-20261120-abcdef12",
};
const pg=createRequire(new URL("../../lib/db/package.json",import.meta.url))("pg");

test("Postgres SSLRequest/TLS SNI cross the fixed offline UDS broker without auth or external egress",async()=>{
  const temp=mkdtempSync(join(tmpdir(),"cst-pg-fixed-broker-e2e-"));
  chmodSync(temp,0o700);
  const socket=join(temp,"test.sock");
  let sslRequest=false,tlsHello=false,expectedSni=false,receivedConnections=0;
  const upstream=createServer(s=>{
    receivedConnections++;
    s.once("data",bytes=>{
      sslRequest=bytes.length===8 &&
        bytes.readUInt32BE(0)===8 &&
        bytes.readUInt32BE(4)===80877103;
      if(!sslRequest){s.destroy();return;}
      s.write(Buffer.from("S"));
      s.once("data",hello=>{
        tlsHello=hello[0]===22;
        expectedSni=hello.includes(Buffer.from(POOLER));
        s.destroy(); // Stop BEFORE PostgreSQL credentials are requested.
      });
    });
  });
  let broker;
  try {
    await new Promise((resolve,reject)=>{
      upstream.once("error",reject);
      upstream.listen(0,"127.0.0.1",()=>{
        upstream.removeListener("error",reject);resolve();
      });
    });
    const port=upstream.address().port;
    broker=await startOfflineMockBroker({
      socketPath:socket,
      dialMock:()=>connect({host:"127.0.0.1",port}),
    });
    const opts=createCstDevOneJobSocketOptions(DSN,environment,CA_FIXTURE);
    assert.equal(opts.ssl.rejectUnauthorized,true);
    // The production fixed path is deliberately replaced ONLY in this test.
    const client=new pg.Client({
      connectionString:DSN,ssl:opts.ssl,
      stream:makeOneJobUnixSocketStream(socket),
      connectionTimeoutMillis:1700,
    });
    try { await assert.rejects(client.connect()); }
    finally { await client.end().catch(()=>{}); }
    assert.equal(receivedConnections,1);
    assert.equal(sslRequest,true);
    assert.equal(tlsHello,true);
    assert.equal(expectedSni,true);
    assert.equal(broker.snapshot().forwarded,1);
  } finally {
    if(broker)await broker.close();
    await new Promise(resolve=>upstream.close(resolve));
    rmSync(temp,{recursive:true,force:true});
  }
});
