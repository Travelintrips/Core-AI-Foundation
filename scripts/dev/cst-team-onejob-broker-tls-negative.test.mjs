import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import { createSecureContext, TLSSocket } from "node:tls";
import { mkdtempSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { startOfflineMockBroker, CST_DEV_FIXED_POOLER } from "./cst-team-onejob-fixed-db-broker.mjs";
import { makeOneJobUnixSocketStream } from "../../lib/db/src/cstOneJobDevSocketTransport.ts";

const pg=createRequire(new URL("../../lib/db/package.json",import.meta.url))("pg");
const HOST=CST_DEV_FIXED_POOLER.host;

test("the actual pg TLS client rejects an untrusted upstream certificate THROUGH the broker",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"cst-broker-untrusted-tls-"));
  chmodSync(dir,0o700);
  const key=join(dir,"untrusted.key"),cert=join(dir,"untrusted.crt");
  const socketPath=join(dir,"broker.sock");
  execFileSync("openssl",[
    "req","-x509","-newkey","rsa:2048","-nodes","-days","1",
    "-keyout",key,"-out",cert,"-subj","/CN=untrusted.invalid",
    "-addext","subjectAltName=DNS:untrusted.invalid",
  ],{stdio:"ignore",timeout:8000});
  const secureContext=createSecureContext({
    key:readFileSync(key),cert:readFileSync(cert),
  });
  let sslRequest=false;
  const upstream=createServer(raw=>{
    raw.once("data",packet=>{
      sslRequest=packet.length===8&&packet.readUInt32BE(4)===80877103;
      if(!sslRequest){raw.destroy();return;}
      raw.write(Buffer.from("S"));
      const tls=new TLSSocket(raw,{isServer:true,secureContext});
      tls.on("error",()=>{});
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
    broker=await startOfflineMockBroker({
      socketPath,
      dialMock:()=>connect({host:"127.0.0.1",port:upstream.address().port}),
    });
    const client=new pg.Client({
      connectionString:
        "postgresql://cst_team_model_pilot_20261120_abcdef12.xssrfshdrtdfupgqwfdw:"+
        "FAKE_TEST_ONLY@"+HOST+":6543/postgres",
      ssl:{rejectUnauthorized:true},
      stream:makeOneJobUnixSocketStream(socketPath),
      connectionTimeoutMillis:2200,
    });
    try {
      await assert.rejects(client.connect(),error=>
        ["DEPTH_ZERO_SELF_SIGNED_CERT","SELF_SIGNED_CERT_IN_CHAIN",
         "ERR_TLS_CERT_ALTNAME_INVALID"].includes(error?.code)
      );
    } finally { await client.end().catch(()=>{}); }
    assert.equal(sslRequest,true);
    assert.equal(broker.snapshot().forwarded,1);
  } finally {
    if(broker)await broker.close();
    await new Promise(resolve=>upstream.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
