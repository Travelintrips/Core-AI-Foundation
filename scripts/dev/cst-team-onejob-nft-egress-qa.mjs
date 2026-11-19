/**
 * CST one-job: independently inspect a namespace-only kernel nftables policy.
 *
 * This is an offline QA evidence projector, NOT a firewall installer, DNS
 * resolver, broker launcher, DB authenticator or operational release gate.
 * The actual destination IP still requires separately approved provenance;
 * an observed QA ruleset can never be promoted to operational authority.
 */
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const QA_EGRESS_TABLE = "cst_onejob_egress_qa";
export const QA_POOLER_PORT = 6543;

function address(ip) {
  if (typeof ip !== "string" || isIP(ip)!==4 ||
      !/^[0-9.]+$/.test(ip)) throw Error("CST_ONEJOB_QA_INVALID_IPV4");
  return ip;
}

/** Does not invoke nft or modify networking. For disposable netns rehearsal. */
export function renderOneJobQaEgressPolicy(allowedIPv4) {
  const ip=address(allowedIPv4);
  return `table inet ${QA_EGRESS_TABLE} {
 chain output {
  type filter hook output priority -100; policy drop;
  ip daddr ${ip} tcp dport ${QA_POOLER_PORT} counter accept
  counter drop
 }
}
`;
}

const positiveInt=x=>Number.isSafeInteger(x)&&x>=0;
function counter(expr) {
  return expr && typeof expr==="object" && expr.counter &&
    positiveInt(expr.counter.packets) && positiveInt(expr.counter.bytes);
}
function exactAddressMatch(expr,allowed) {
  const m=expr?.match;
  return m?.op==="==" && m?.left?.payload?.protocol==="ip" &&
    m?.left?.payload?.field==="daddr" && m.right===allowed &&
    Object.keys(m.left.payload).length===2 &&
    Object.keys(m.left).length===1 &&
    Object.keys(m).sort().join(",")==="left,op,right";
}
function exactPortMatch(expr) {
  const m=expr?.match;
  return m?.op==="==" && m?.left?.payload?.protocol==="tcp" &&
    m?.left?.payload?.field==="dport" && m.right===QA_POOLER_PORT &&
    Object.keys(m.left.payload).length===2 &&
    Object.keys(m.left).length===1 &&
    Object.keys(m).sort().join(",")==="left,op,right";
}
function exactTerminal(expr,key) {
  return expr && typeof expr==="object" &&
    Object.keys(expr).length===1 &&
    Object.prototype.hasOwnProperty.call(expr,key) && expr[key]===null;
}
function belongsTo(r) {
  return r?.family==="inet" && r?.table===QA_EGRESS_TABLE;
}

/** The 2-rule default-drop nft -j kernel readback is the only valid shape.
 * Kernel counters must prove actual allowed and denied packets were observed.
 */
export function auditOneJobQaKernelEgress(nftJson, expectedIPv4) {
  const blockers=[];
  let allowPackets=0,denyPackets=0;
  try {
    const ip=address(expectedIPv4);
    const parts=nftJson?.nftables;
    if(!Array.isArray(parts)) throw Error("NO_NFT_JSON");
    const objects=parts.filter(p=>!p?.metainfo);
    const tables=objects.filter(p=>p?.table).map(p=>p.table);
    const chains=objects.filter(p=>p?.chain).map(p=>p.chain);
    const rules=objects.filter(p=>p?.rule).map(p=>p.rule);
    if(objects.length!==4 || tables.length!==1 || chains.length!==1 ||
       rules.length!==2)throw Error("UNEXPECTED_KERNEL_OBJECTS");
    if(!belongsTo(tables[0]) || tables[0].name!==QA_EGRESS_TABLE)
      throw Error("WRONG_TABLE");
    const chain=chains[0];
    if(!belongsTo(chain) || chain.name!=="output" ||
       chain.type!=="filter" || chain.hook!=="output" ||
       chain.policy!=="drop" || chain.prio!==-100)
      throw Error("OUTPUT_CHAIN_NOT_STRICT");
    if(!rules.every(r=>belongsTo(r)&&r.chain==="output"))
      throw Error("FOREIGN_RULES");
    const [allow,deny]=rules.map(r=>r.expr);
    if(!Array.isArray(allow)||allow.length!==4||
       !exactAddressMatch(allow[0],ip) || !exactPortMatch(allow[1]) ||
       !counter(allow[2]) || !exactTerminal(allow[3],"accept"))
      throw Error("UNBOUNDED_ALLOW_RULE");
    if(!Array.isArray(deny)||deny.length!==2||
       !counter(deny[0]) || !exactTerminal(deny[1],"drop"))
      throw Error("DEFAULT_DROP_RULE_MISSING");
    allowPackets=allow[2].counter.packets;
    denyPackets=deny[0].counter.packets;
    if(allowPackets<1||denyPackets<1)
      throw Error("ALLOW_DENY_TRAFFIC_NOT_BOTH_OBSERVED");
  } catch(error) {
    blockers.push(error?.message||"KERNEL_EVIDENCE_UNAVAILABLE");
  }
  return {
    mode:"DISPOSABLE_NETNS_KERNEL_QA_ONLY",
    qaNamespacePolicyVerified:blockers.length===0,
    allowPackets,denyPackets,blockers,
    hostnameCertificateVerifiedByThisCheck:false,
    devProjectTenantVerifiedByThisCheck:false,
    brokerPeerAuthorizationVerifiedByThisCheck:false,
    independentOperationalEgressAclVerified:false,
    realDevDatabaseTransportVerified:false,
    operationalAuthority:false,
    sideEffects:"NONE",
  };
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  let source;
  try { source=JSON.parse(readFileSync(0,"utf8")); }
  catch { source=null; }
  const verdict=auditOneJobQaKernelEgress(source,process.argv[2]);
  console.log(JSON.stringify(verdict,null,2));
  if(!verdict.qaNamespacePolicyVerified)process.exitCode=2;
}
