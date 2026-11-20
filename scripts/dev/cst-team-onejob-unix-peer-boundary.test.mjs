import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ONEJOB_CANDIDATE,ONEJOB_NETWORK,ONEJOB_SOCKET_DIRECTORY,
  ONEJOB_SOCKET_PATH,projectCstOneJobUnixPeerBoundary,
} from "./cst-team-onejob-unix-peer-boundary.mjs";

const good={
  candidate:{
    name:ONEJOB_CANDIDATE,networkMode:ONEJOB_NETWORK,
    user:"28502:28501",privileged:false,readonlyRootfs:true,
    noNewPrivileges:true,capDrop:["ALL"],capAdd:[],pidMode:"",ipcMode:"",
  },
  broker:{
    user:"28500:28501",privileged:false,readonlyRootfs:true,
    noNewPrivileges:true,capDrop:["ALL"],capAdd:[],networkMode:"none",
  },
  mount:{
    type:"bind",source:ONEJOB_SOCKET_DIRECTORY,
    destination:ONEJOB_SOCKET_DIRECTORY,readonly:true,
  },
  directory:{
    isDirectory:true,isSymlink:false,uid:28500,gid:28501,mode:0o750,
  },
  socket:{
    path:ONEJOB_SOCKET_PATH,isSocket:true,isSymlink:false,
    uid:28500,gid:28501,mode:0o660,
  },
};
function check(replace,blocker){
  const input={
    ...good,
    candidate:{...good.candidate,...replace.candidate},
    broker:{...good.broker,...replace.broker},
    mount:{...good.mount,...replace.mount},
    directory:{...good.directory,...replace.directory},
    socket:{...good.socket,...replace.socket},
  };
  const out=projectCstOneJobUnixPeerBoundary(input);
  assert.equal(out.filesystemBoundaryVerified,false);
  assert.ok(out.blockers.includes(blocker),JSON.stringify(out.blockers));
  assert.equal(out.kernelPeerCredentialsVerified,false);
  assert.equal(out.independentEgressAclVerified,false);
  assert.equal(out.dedicatedRealDevDbTransportVerified,false);
  assert.equal(out.operationalAuthority,false);
}
test("separate non-root UIDs with one dedicated socket GID are valid DAC metadata only",()=>{
  const out=projectCstOneJobUnixPeerBoundary(good);
  assert.equal(out.filesystemBoundaryVerified,true);
  assert.deepEqual(out.blockers,[]);
  assert.equal(out.mode,"PATHNAME_DAC_METADATA_ONLY_NOT_SO_PEERCRED");
  assert.equal(out.kernelPeerCredentialsVerified,false);
  assert.equal(out.independentEgressAclVerified,false);
  assert.equal(out.dedicatedRealDevDbTransportVerified,false);
  assert.equal(out.operationalAuthority,false);
});
test("missing observations never turn into identity approval",()=>{
  const out=projectCstOneJobUnixPeerBoundary();
  assert.equal(out.filesystemBoundaryVerified,false);
  assert.ok(out.blockers.length>=4);
  assert.equal(out.operationalAuthority,false);
});
test("root or privileged DEV candidate fails closed",()=>{
  for(const user of ["", "root", "0:28501", "28502:0", "abc:28501", "999999:28501"])
    check({candidate:{user}},"CANDIDATE_NONROOT_SANDBOX_NOT_VERIFIED");
  for(const change of [
    {privileged:true},{readonlyRootfs:false},{noNewPrivileges:false},
    {capDrop:[]},{capAdd:["CAP_NET_ADMIN"]},{networkMode:"host"},
    {pidMode:"host"},{ipcMode:"host"}, {name:"core-ai-dev"},
  ]) check({candidate:change},"CANDIDATE_NONROOT_SANDBOX_NOT_VERIFIED");
});
test("broker must be a different non-root identity without escalation",()=>{
  for(const user of ["", "0:28501", "28502:28501"])
    check({broker:{user}},user==="28502:28501" ?
      "DISTINCT_UID_SHARED_DEDICATED_GID_REQUIRED" :
      "BROKER_NONROOT_SANDBOX_NOT_VERIFIED");
  for(const change of [
    {privileged:true},{noNewPrivileges:false},{readonlyRootfs:false},
    {capDrop:[]},{capAdd:["SYS_ADMIN"]},{networkMode:"host"},
  ])check({broker:change},"BROKER_NONROOT_SANDBOX_NOT_VERIFIED");
  check({candidate:{user:"28502:28504"}},"DISTINCT_UID_SHARED_DEDICATED_GID_REQUIRED");
});
test("only exact read-only bind mount to the fixed socket directory is accepted",()=>{
  for(const change of [
    {source:"/var/run/docker.sock"},{destination:"/tmp"},
    {readonly:false},{type:"volume"},{source:"/run/cst-onejob-dev-db/../other"},
  ])check({mount:change},"SOCKET_DIRECTORY_EXACT_READONLY_MOUNT_REQUIRED");
  check({mount:{readonly:"true"}},"SOCKET_DIRECTORY_EXACT_READONLY_MOUNT_REQUIRED");
});
test("world-writable, symlink, misowned, wrong-permission sockets are rejected",()=>{
  for(const change of [
    {mode:0o777},{mode:0o770},{mode:0o700},{isSymlink:true},
    {isDirectory:false},{uid:0},{gid:0},{mode:"0750"},
  ])check({directory:change},"SOCKET_PARENT_OWNER_MODE_INVALID");
  for(const change of [
    {mode:0o666},{mode:0o600},{mode:0o777},{isSymlink:true},
    {isSocket:false},{uid:0},{gid:0},{path:"/tmp/fake.sock"},
  ])check({socket:change},"SOCKET_OWNER_MODE_INVALID");
});
test("preflight must preserve independent ACL and peer credential release gates",()=>{
  const gate=readFileSync(new URL("./cst-team-onejob-readiness-gate.mjs",import.meta.url),"utf8");
  assert.match(gate,/BROKER_UNIX_FILESYSTEM_IDENTITY_NOT_VERIFIED/);
  assert.match(gate,/BROKER_KERNEL_PEER_CREDENTIALS_NOT_VERIFIED/);
  assert.match(gate,/candidateBrokerUnixFilesystemVerified:false/);
  assert.match(gate,/candidateBrokerKernelPeerCredentialsVerified:false/);
  assert.match(gate,/CANDIDATE_EGRESS_ACL_NOT_INDEPENDENTLY_VERIFIED/);
  assert.match(gate,/DEDICATED_CST_DEV_DB_TRANSPORT_NOT_VERIFIED/);
});
