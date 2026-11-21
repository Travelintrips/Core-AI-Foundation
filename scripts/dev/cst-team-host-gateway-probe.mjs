/**
 * CST-DEV one-job: ephemeral, local-only Docker host-gateway probe.
 *
 * An "internal" Docker bridge can still reach the bridge gateway on the VPS.
 * Bind a random TCP listener to that gateway, ask ONLY the existing candidate
 * to try a nonce challenge, then close the listener. No credentials, DNS,
 * database calls, other host services, or persistent port mappings.
 *
 * This is a necessary negative admission check, not a complete proof of
 * destination-scoped egress. The separate scoped DB-read + independent ACL
 * review must also pass. Failure/unavailability ALWAYS returns blocked=false.
 */
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:net";

export const CANDIDATE = "cst-core-onejob-dev-candidate";

const childCode = String.raw`
const net=require("node:net");
const [host,portValue,nonce]=process.argv.slice(1);
const socket=net.connect({host,port:Number(portValue)});
let complete=false;
const done=value=>{if(complete)return;complete=true;console.log(value);socket.destroy()};
socket.setTimeout(1800);
socket.on("connect",()=>socket.write(nonce));
socket.on("data",data=>done(data.toString()==="CST_GATEWAY_ACK"?"REACHABLE":"UNVERIFIED"));
socket.on("error",error=>done(
 ["ECONNREFUSED","ENETUNREACH","EHOSTUNREACH"].includes(error.code)?"DENIED":"UNVERIFIED"));
socket.on("timeout",()=>done("UNVERIFIED"));
`;

function dockerCandidateProbe({ gateway, port, nonce, candidate }) {
  return new Promise(resolve => {
    execFile("docker", [
      "exec", candidate, "node", "-e", childCode, gateway, String(port), nonce,
    ], { encoding:"utf8", timeout:5000, maxBuffer:1024 }, (error, stdout) => {
      resolve(error ? "UNVERIFIED" : stdout.trim());
    });
  });
}

function validIPv4(ip) {
  const parts=typeof ip==="string" ? ip.split(".") : [];
  return parts.length===4 && parts.every(p => /^\d{1,3}$/.test(p) &&
    Number(p)>=0 && Number(p)<=255) && !["0.0.0.0","127.0.0.1"].includes(ip);
}

export async function probeCstDevHostGateway({
  gateway, candidate=CANDIDATE, execCandidate=dockerCandidateProbe,
}={}) {
  if (!validIPv4(gateway) || candidate!==CANDIDATE) {
    return { blocked:false, status:"INVALID_PROBE_SCOPE" };
  }
  const nonce=randomBytes(16).toString("hex");
  let accepted=false;
  const server=createServer(socket => {
    socket.once("data", data => {
      if (data.toString()===nonce) {
        accepted=true;
        socket.end("CST_GATEWAY_ACK");
      } else socket.destroy();
    });
    socket.setTimeout(2500,()=>socket.destroy());
  });
  let listening=false;
  try {
    await new Promise((resolve,reject)=>{
      server.once("error",reject);
      server.listen(0,gateway,()=>{
        server.removeListener("error",reject);
        listening=true;resolve();
      });
    });
    const port=server.address()?.port;
    if (!Number.isInteger(port)) return { blocked:false,status:"LISTENER_NOT_READY" };
    const result=await execCandidate({ gateway, port, nonce, candidate });
    if (accepted || result==="REACHABLE") {
      return { blocked:false,status:"HOST_GATEWAY_REACHABLE" };
    }
    if (result==="DENIED" && !accepted) {
      return { blocked:true,status:"HOST_GATEWAY_PROBE_DENIED" };
    }
    return { blocked:false,status:"HOST_GATEWAY_PROBE_UNVERIFIED" };
  } catch {
    return { blocked:false,status:"HOST_GATEWAY_PROBE_ERROR" };
  } finally {
    if (listening) await new Promise(resolve=>server.close(resolve));
    else server.close();
  }
}
