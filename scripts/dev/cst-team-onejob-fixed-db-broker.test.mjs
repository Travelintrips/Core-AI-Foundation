import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import { mkdtempSync, rmSync, chmodSync, writeFileSync, readFileSync, lstatSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import {
  CST_DEV_FIXED_POOLER,CST_DEV_FIXED_SOCKET,
  assertSafeSocketLocation,startOfflineMockBroker,startOperationalCstDevBroker,
} from "./cst-team-onejob-fixed-db-broker.mjs";

function tempPath() {
  const dir=mkdtempSync(join(tmpdir(),"cst-fixed-db-broker-"));
  chmodSync(dir,0o700);
  return {dir,socket:join(dir,"onejob.sock"),clean:()=>rmSync(dir,{recursive:true,force:true})};
}
function tcpServer(handler) {
  const server=createServer(handler);
  return new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      server.removeListener("error",reject);
      resolve({server,port:server.address().port,
        close:()=>new Promise(r=>server.close(r))});
    });
  });
}
function sendAndRead(socketPath,payload) {
  return new Promise((resolve,reject)=>{
    const socket=connect({path:socketPath});
    socket.setTimeout(1700);
    socket.on("connect",()=>socket.write(payload));
    socket.once("data",data=>{resolve(data.toString());socket.destroy()});
    socket.on("error",reject);
    socket.on("timeout",()=>{socket.destroy();reject(new Error("TEST_TIMEOUT"))});
  });
}

test("broker import is inert; operational start cannot be enabled by a flag",()=>{
  assert.deepEqual(CST_DEV_FIXED_POOLER,{
    host:"aws-1-ap-southeast-2.pooler.supabase.com",
    port:6543,project:"xssrfshdrtdfupgqwfdw",
  });
  assert.equal(CST_DEV_FIXED_SOCKET,"/run/cst-onejob-dev-db/pg-pooler.sock");
  const old=process.env.CST_TEAM_DEV_BROKER_ENABLED;
  try {
    process.env.CST_TEAM_DEV_BROKER_ENABLED="true";
    assert.throws(startOperationalCstDevBroker,
      /CST_ONEJOB_BROKER_INDEPENDENT_ACL_AND_DB_TRANSPORT_NOT_VERIFIED/);
  } finally {
    if(old===undefined)delete process.env.CST_TEAM_DEV_BROKER_ENABLED;
    else process.env.CST_TEAM_DEV_BROKER_ENABLED=old;
  }
});

test("offline fixed-destination broker transparently forwards only to injected loopback mock",async()=>{
  const loc=tempPath();
  let dialed=0,rawReceived="";
  const upstream=await tcpServer(socket=>socket.on("data",data=>{
    rawReceived+=data.toString();
    socket.write("MOCK_ONLY_ACK");
  }));
  let broker;
  try {
    broker=await startOfflineMockBroker({
      socketPath:loc.socket,
      dialMock:()=>{dialed++;return connect({host:"127.0.0.1",port:upstream.port})},
    });
    assert.equal(lstatSync(loc.socket).mode&0o777,0o600);
    const fakeOverride='{"host":"prod.example.invalid","port":9999}';
    const payload="FAKE_APP_BYTES:"+fakeOverride;
    const response=await sendAndRead(loc.socket,payload);
    assert.equal(response,"MOCK_ONLY_ACK");
    assert.equal(rawReceived,payload); // payload is not interpreted as destination
    assert.equal(dialed,1);
    assert.deepEqual(broker.snapshot(),{active:1,rejected:0,forwarded:1});
    assert.equal(broker.destination.host,CST_DEV_FIXED_POOLER.host);
  } finally {
    if(broker)await broker.close();
    await upstream.close();
    loc.clean();
  }
});

test("reject concurrent second client and keep one-client bounded transport",async()=>{
  const loc=tempPath();
  const upstream=await tcpServer(()=>{}); // deliberately hold first session
  let broker,first,second;
  try {
    broker=await startOfflineMockBroker({
      socketPath:loc.socket,
      dialMock:()=>connect({host:"127.0.0.1",port:upstream.port}),
    });
    first=connect({path:loc.socket});
    first.on("error",()=>{});
    await once(first,"connect");
    await new Promise(resolve=>setTimeout(resolve,35));
    second=connect({path:loc.socket});
    second.on("error",()=>{});
    await once(second,"connect");
    await new Promise(resolve=>setTimeout(resolve,45));
    assert.equal(broker.snapshot().rejected,1);
    assert.equal(broker.snapshot().active,1);
  } finally {
    first?.destroy();second?.destroy();
    if(broker)await broker.close();
    await upstream.close();
    loc.clean();
  }
});

test("socket path collision, symlink, world-writable parent and bad args fail closed",async()=>{
  const loc=tempPath();
  const occupied=join(loc.dir,"occupied.sock");
  const sentinel="KEEP_EXISTING_FILE";
  writeFileSync(occupied,sentinel);
  const fakeUpstream=()=>{throw Error("NEVER_DIAL");};
  try {
    assert.throws(()=>assertSafeSocketLocation("relative.sock"),/INVALID_SOCKET_PATH/);
    assert.throws(()=>assertSafeSocketLocation(loc.dir+"/../x.sock"),/INVALID_SOCKET_PATH/);
    await assert.rejects(startOfflineMockBroker({
      socketPath:occupied,dialMock:fakeUpstream,
    }),/SOCKET_ALREADY_OCCUPIED/);
    assert.equal(readFileSync(occupied,"utf8"),sentinel);
    const broken=join(loc.dir,"broken.sock");
    symlinkSync(join(loc.dir,"absent-target"),broken);
    await assert.rejects(startOfflineMockBroker({
      socketPath:broken,dialMock:fakeUpstream,
    }),/SOCKET_ALREADY_OCCUPIED/);
    assert.equal(lstatSync(broken).isSymbolicLink(),true);
    chmodSync(loc.dir,0o777);
    await assert.rejects(startOfflineMockBroker({
      socketPath:loc.socket,dialMock:fakeUpstream,
    }),/INSECURE_SOCKET_PARENT/);
    chmodSync(loc.dir,0o700);
    await assert.rejects(startOfflineMockBroker({
      socketPath:loc.socket,dialMock:fakeUpstream,maxConnections:2,
    }),/OFFLINE_TEST_ARGS_DENIED/);
  } finally {chmodSync(loc.dir,0o700);loc.clean();}
});

test("offline mock upstream failure closes the client, never selects a fallback",async()=>{
  const loc=tempPath();
  let broker,upstreamAttempts=0;
  try {
    broker=await startOfflineMockBroker({
      socketPath:loc.socket,
      dialMock:()=>{upstreamAttempts++;throw Error("UPSTREAM_REFUSED")},
    });
    const client=connect({path:loc.socket});
    client.on("error",()=>{});
    await Promise.race([
      once(client,"close"),
      new Promise((_,reject)=>setTimeout(()=>reject(Error("NOT_CLOSED")),1500)),
    ]);
    assert.equal(upstreamAttempts,1);
    assert.equal(broker.snapshot().forwarded,0);
  } finally {
    if(broker)await broker.close();
    loc.clean();
  }
});

test("broker destination contract matches the currently gated client; no network launcher",()=>{
  const client=readFileSync(new URL("../../lib/db/src/cstOneJobDevSocketTransport.ts",import.meta.url),"utf8");
  assert.match(client,/aws-1-ap-southeast-2\.pooler\.supabase\.com/);
  assert.match(client,/\/run\/cst-onejob-dev-db\/pg-pooler\.sock/);
  const source=readFileSync(new URL("./cst-team-onejob-fixed-db-broker.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(source,/createServer\(\).*\.listen\(["']0\.0\.0\.0/);
  assert.doesNotMatch(source,/process\.env\.CST_TEAM_DEV_BROKER_TARGET/);
  assert.match(source,/startOperationalCstDevBroker\(\)/);
  assert.match(source,/INDEPENDENT_ACL_AND_DB_TRANSPORT_NOT_VERIFIED/);
});
