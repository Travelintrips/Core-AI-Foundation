import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import {
  mkdtempSync, chmodSync, chownSync, rmSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startOfflineMockBroker } from "./cst-team-onejob-fixed-db-broker.mjs";

function listener() {
  let count=0;
  const s=createServer(client=>{
    count++;
    client.once("data",bytes=>client.end("TEST_ACK:"+bytes.toString()));
  });
  return new Promise((resolve,reject)=>{
    s.once("error",reject);
    s.listen(0,"127.0.0.1",()=>{
      s.removeListener("error",reject);
      resolve({server:s, port:s.address().port,
        count:()=>count,
        close:()=>new Promise(r=>s.close(r))});
    });
  });
}
const clientCode=String.raw`
const net=require("node:net"),sock=process.argv[1];
const s=net.connect({path:sock});
s.setTimeout(3500);
let received=false;
s.on("connect",()=>s.write("OFFLINE_ONLY"));
s.on("data",bytes=>{
  received=true;
  console.log("CLIENT_ACK="+bytes.toString());
  s.end();
});
s.on("error",e=>console.log("CLIENT_ERROR="+(e.code||"UNKNOWN")));
s.on("timeout",()=>{console.log("CLIENT_TIMEOUT");s.destroy();process.exitCode=5});
s.on("close",()=>{console.log("CLIENT_CLOSED="+(!received))});
`;
async function connectAs(path,identity={}) {
  return await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,["-e",clientCode,path],{
      uid:identity.uid,gid:identity.gid,stdio:["ignore","pipe","pipe"],
    });
    let stdout="",stderr="";
    child.stdout.on("data",data=>stdout+=data.toString());
    child.stderr.on("data",data=>stderr+=data.toString());
    child.once("error",reject);
    child.once("close",code=>resolve({code,stdout,stderr}));
  });
}
test("accepted UNIX connection undergoes kernel fd3 peer verification before mock upstream dial",async t=>{
  if(process.platform!=="linux" || process.getuid===undefined) t.skip("Linux only");
  const root=process.getuid()===0;
  const selfUid=process.getuid(),selfGid=process.getgid();
  if(!root && (!selfUid || !selfGid)) t.skip("requires positive Linux identity");
  const expectedUid=root?28502:selfUid+1;
  const expectedGid=root?28501:selfGid;
  const dir=mkdtempSync(join(tmpdir(),"cst-kernel-peer-broker-"));
  const sock=join(dir,"mock.sock");
  let broker;
  const upstream=await listener();
  try {
    if(root) {
      chownSync(dir,28500,expectedGid);
      chmodSync(dir,0o750);
    }
    broker=await startOfflineMockBroker({
      socketPath:sock,
      dialMock:()=>connect({host:"127.0.0.1",port:upstream.port}),
      peerIdentity:{uid:expectedUid,gid:expectedGid},
    });
    if(root)chownSync(sock,28500,expectedGid);
    assert.equal(statSync(sock).mode & 0o777,0o660);
    // Unprivileged CI can exercise a mismatched kernel UID but may not
    // impersonate another Linux UID. Root VPS also runs the positive proof.
    const wrong=root
      ? await connectAs(sock,{uid:28503,gid:expectedGid})
      : await connectAs(sock);
    assert.equal(wrong.code,0,wrong.stderr);
    assert.ok(wrong.stdout.includes("CLIENT_CLOSED=true"),wrong.stdout);
    assert.equal(upstream.count(),0,"invalid peer must not dial upstream");
    assert.equal(broker.snapshot().rejected,1);
    assert.equal(broker.snapshot().kernelPeerVerified,0);

    if(root) {
      const legitimate=await connectAs(sock,{uid:expectedUid,gid:expectedGid});
      assert.equal(legitimate.code,0,legitimate.stderr);
      assert.ok(legitimate.stdout.includes("CLIENT_ACK=TEST_ACK:OFFLINE_ONLY"),
        legitimate.stdout);
      assert.equal(upstream.count(),1);
      assert.equal(broker.snapshot().kernelPeerVerified,1);
      assert.equal(broker.snapshot().forwarded,1);
      // A separate GID is denied by the kernel's path/socket DAC.
      const denied=await connectAs(sock,{uid:28504,gid:28505});
      assert.equal(denied.code,0,denied.stderr);
      assert.ok(denied.stdout.includes("CLIENT_ERROR=EACCES"),denied.stdout);
      assert.equal(upstream.count(),1);
    }
  } finally {
    if(broker)await broker.close();
    await upstream.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
test("peer verification cannot be enabled with missing/root/shared identity",async()=>{
  const upstream=await listener();
  const dir=mkdtempSync(join(tmpdir(),"cst-invalid-peer-config-"));
  const socketPath=join(dir,"reject.sock");
  try {
    for(const identity of [
      {uid:0,gid:28501},{uid:28502,gid:0},{uid:28502,gid:"28501"},
      {uid:28502,gid:-1},{uid:28502},{uid:process.getuid?.(),gid:28501},
    ]) {
      await assert.rejects(
        startOfflineMockBroker({socketPath,peerIdentity:identity,
          dialMock:()=>connect({host:"127.0.0.1",port:upstream.port})}),
        /INVALID_OR_SHARED_PEER_IDENTITY/
      );
    }
    assert.equal(upstream.count(),0);
  } finally {await upstream.close();rmSync(dir,{recursive:true,force:true})}
});
