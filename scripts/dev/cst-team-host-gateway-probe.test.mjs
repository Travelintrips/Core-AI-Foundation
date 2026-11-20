import assert from "node:assert/strict";
import { connect } from "node:net";
import test from "node:test";
import { probeCstDevHostGateway, CANDIDATE } from "./cst-team-host-gateway-probe.mjs";

const gateway="127.0.0.2"; // local-only alias; no external network
function legitimateConnection({gateway,port,nonce}) {
  return new Promise(resolve=>{
    const socket=connect({host:gateway,port});
    socket.setTimeout(1500);
    socket.on("connect",()=>socket.write(nonce));
    socket.on("data",data=>{socket.end();resolve(
      data.toString()==="CST_GATEWAY_ACK" ? "REACHABLE" : "UNVERIFIED"
    )});
    socket.on("error",()=>resolve("UNVERIFIED"));
    socket.on("timeout",()=>{socket.destroy();resolve("UNVERIFIED")});
  });
}

test("an accessible Docker host gateway DENIES pilot admission",async()=>{
  const result=await probeCstDevHostGateway({
    gateway,candidate:CANDIDATE,execCandidate:legitimateConnection,
  });
  assert.equal(result.blocked,false);
  assert.equal(result.status,"HOST_GATEWAY_REACHABLE");
});
test("explicit network-layer denied connection is a necessary isolation signal",async()=>{
  const result=await probeCstDevHostGateway({
    gateway,candidate:CANDIDATE,execCandidate:async()=>"DENIED",
  });
  assert.equal(result.blocked,true);
  assert.equal(result.status,"HOST_GATEWAY_PROBE_DENIED");
});
test("unverified or failed process execution cannot be mistaken for isolation",async()=>{
  for(const probe of [
    async()=> "UNVERIFIED",
    async()=>{throw Error("docker unavailable")},
    async()=> "REACHABLE",
  ]) {
    const result=await probeCstDevHostGateway({
      gateway,candidate:CANDIDATE,execCandidate:probe,
    });
    assert.equal(result.blocked,false);
  }
});
test("invalid endpoint, arbitrary container or missing inputs fail closed",async()=>{
  for (const input of [
    {gateway:"",candidate:CANDIDATE},
    {gateway:"0.0.0.0",candidate:CANDIDATE},
    {gateway:"127.0.0.1",candidate:CANDIDATE},
    {gateway:"db.nzdweipzckfszczzqtuw.supabase.co",candidate:CANDIDATE},
    {gateway,candidate:"core-ai-dev"},
  ]) {
    const result=await probeCstDevHostGateway(input);
    assert.equal(result.blocked,false);
    assert.equal(result.status,"INVALID_PROBE_SCOPE");
  }
});
