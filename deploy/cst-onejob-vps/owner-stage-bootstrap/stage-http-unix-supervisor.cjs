"use strict";
/**
 * Source-only Gate-A HTTP transport. Runs solely in --network none.
 * Local application TCP :3000 is bridged only to a host-visible, group-
 * restricted AF_UNIX socket. No remote TCP dial or Docker host ports.
 */
const fs = require("node:fs");
const net = require("node:net");
const {spawn} = require("node:child_process");
const {join} = require("node:path");

const UID = 28502, GID = 28501, NGINX_GROUP = 33;
const DIR = "/run/cst-onejob-stage-http";
const SOCKET = join(DIR,"api.sock");
function refuse(reason) {
  throw new Error("CST_ONEJOB_STAGE_HTTP_"+reason);
}
if (process.getuid?.() !== UID || process.getgid?.() !== GID ||
    !process.getgroups?.().includes(NGINX_GROUP))
  refuse("NONROOT_IDENTITY_DENIED");
const st = fs.lstatSync(DIR);
if (!st.isDirectory() || st.isSymbolicLink() || st.uid!==UID ||
    st.gid!==NGINX_GROUP || (st.mode & 0o7777)!==0o2750)
  refuse("SOCKET_PARENT_UNTRUSTED");
try {fs.lstatSync(SOCKET);refuse("SOCKET_PATH_ALREADY_EXISTS");}
catch(error){if(error.code!=="ENOENT")throw error;}

let child, closing = false;
const server=net.createServer(inbound=>{
  const upstream=net.connect({host:"127.0.0.1",port:3000});
  const cleanup=()=>{inbound.destroy();upstream.destroy();};
  inbound.on("error",cleanup);
  upstream.on("error",cleanup);
  inbound.pipe(upstream);
  upstream.pipe(inbound);
});
function shutdown(signal="SIGTERM") {
  if(closing)return;
  closing=true;
  if(child && !child.killed) child.kill(signal);
  server.close();
  try {fs.unlinkSync(SOCKET);} catch(e){if(e.code!=="ENOENT") process.exitCode=1;}
}
process.on("SIGTERM",()=>shutdown());
process.on("SIGINT",()=>shutdown("SIGINT"));
server.on("error",()=>{shutdown();process.exitCode=1;});
server.listen(SOCKET,()=>{
  fs.chmodSync(SOCKET,0o660);
  child=spawn(process.execPath,["scripts/hostinger-start.cjs"],{
    cwd:"/app",stdio:"inherit",env:process.env,
  });
  child.on("error",()=>{shutdown();process.exitCode=1;});
  child.on("exit",(code,signal)=>{
    shutdown();
    process.exitCode=signal?1:(code??1);
  });
});
