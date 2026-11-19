import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  QA_EGRESS_TABLE,QA_POOLER_PORT,
  renderOneJobQaEgressPolicy,auditOneJobQaKernelEgress,
} from "./cst-team-onejob-nft-egress-qa.mjs";

const approved="203.0.113.7";
const sample={
 nftables:[
  {metainfo:{version:"1.0.9",json_schema_version:1}},
  {table:{family:"inet",name:QA_EGRESS_TABLE,handle:1}},
  {chain:{family:"inet",table:QA_EGRESS_TABLE,name:"output",
    type:"filter",hook:"output",prio:-100,policy:"drop",handle:1}},
  {rule:{family:"inet",table:QA_EGRESS_TABLE,chain:"output",handle:2,expr:[
    {match:{op:"==",left:{payload:{protocol:"ip",field:"daddr"}},right:approved}},
    {match:{op:"==",left:{payload:{protocol:"tcp",field:"dport"}},right:6543}},
    {counter:{packets:10,bytes:2269}},
    {accept:null},
  ]}},
  {rule:{family:"inet",table:QA_EGRESS_TABLE,chain:"output",handle:3,expr:[
    {counter:{packets:4,bytes:240}},
    {drop:null},
  ]}},
 ]
};
const tamper=(fn)=>{const x=structuredClone(sample);fn(x);return x;};
const checkBlocked=(input,expected,reason)=>{
 const r=auditOneJobQaKernelEgress(input,expected);
 assert.equal(r.qaNamespacePolicyVerified,false,JSON.stringify(r));
 assert.ok(r.blockers.includes(reason),JSON.stringify(r.blockers));
 assert.equal(r.operationalAuthority,false);
 assert.equal(r.realDevDatabaseTransportVerified,false);
 assert.equal(r.independentOperationalEgressAclVerified,false);
};

test("default-drop QA policy emits exactly one IPv4+port allowance",()=>{
 const rules=renderOneJobQaEgressPolicy(approved);
 assert.match(rules,/table inet cst_onejob_egress_qa/);
 assert.match(rules,/type filter hook output priority -100; policy drop/);
 assert.match(rules,/ip daddr 203\.0\.113\.7 tcp dport 6543 counter accept/);
 assert.match(rules,/counter drop/);
 assert.doesNotMatch(rules,/ip6|established|oifname|ct state|meta mark|socket/);
 assert.equal(QA_POOLER_PORT,6543);
 for(const invalid of ["",undefined,6,"1.2.3.4;drop all", "::1","10.0.0.1\naccept","192.168.0.999","01.02.03.04"])
   assert.throws(()=>renderOneJobQaEgressPolicy(invalid),/CST_ONEJOB_QA_INVALID_IPV4/);
});

test("actual kernel JSON schema yields QA-only allow-and-deny evidence",()=>{
 const v=auditOneJobQaKernelEgress(sample,approved);
 assert.equal(v.qaNamespacePolicyVerified,true);
 assert.equal(v.allowPackets,10);
 assert.equal(v.denyPackets,4);
 assert.deepEqual(v.blockers,[]);
 assert.equal(v.mode,"DISPOSABLE_NETNS_KERNEL_QA_ONLY");
 assert.equal(v.hostnameCertificateVerifiedByThisCheck,false);
 assert.equal(v.devProjectTenantVerifiedByThisCheck,false);
 assert.equal(v.brokerPeerAuthorizationVerifiedByThisCheck,false);
 assert.equal(v.independentOperationalEgressAclVerified,false);
 assert.equal(v.realDevDatabaseTransportVerified,false);
 assert.equal(v.operationalAuthority,false);
 assert.equal(v.sideEffects,"NONE");
});

test("wrong source policy and wrong destination are never trusted",()=>{
 checkBlocked(sample,"198.51.100.99","UNBOUNDED_ALLOW_RULE");
 checkBlocked(sample,"203.0.113.7; DROP","CST_ONEJOB_QA_INVALID_IPV4");
 checkBlocked(null,approved,"NO_NFT_JSON");
 checkBlocked({},approved,"NO_NFT_JSON");
 checkBlocked(tamper(x=>{x.nftables[1].table.name="filter"}),approved,"WRONG_TABLE");
 checkBlocked(tamper(x=>{x.nftables[2].chain.policy="accept"}),approved,"OUTPUT_CHAIN_NOT_STRICT");
 checkBlocked(tamper(x=>{x.nftables[2].chain.hook="forward"}),approved,"OUTPUT_CHAIN_NOT_STRICT");
 checkBlocked(tamper(x=>{x.nftables[2].chain.prio=0}),approved,"OUTPUT_CHAIN_NOT_STRICT");
});
test("extra IPv6, host, alternate port or second allowance invalidates proof",()=>{
 checkBlocked(tamper(x=>{x.nftables.push(structuredClone(x.nftables[3]));}),approved,"UNEXPECTED_KERNEL_OBJECTS");
 checkBlocked(tamper(x=>{x.nftables[3].rule.expr[0].match.left.payload.protocol="ip6"}),approved,"UNBOUNDED_ALLOW_RULE");
 checkBlocked(tamper(x=>{x.nftables[3].rule.expr[1].match.right=443}),approved,"UNBOUNDED_ALLOW_RULE");
 checkBlocked(tamper(x=>{x.nftables[3].rule.expr.push({accept:null})}),approved,"UNBOUNDED_ALLOW_RULE");
 checkBlocked(tamper(x=>{x.nftables[4].rule.expr[1]={accept:null}}),approved,"DEFAULT_DROP_RULE_MISSING");
 checkBlocked(tamper(x=>{x.nftables[3].rule.chain="input"}),approved,"FOREIGN_RULES");
});
test("both observed packet counters are mandatory, not merely a synthetic rule shape",()=>{
 checkBlocked(tamper(x=>{x.nftables[3].rule.expr[2].counter.packets=0}),approved,
  "ALLOW_DENY_TRAFFIC_NOT_BOTH_OBSERVED");
 checkBlocked(tamper(x=>{x.nftables[4].rule.expr[0].counter.packets=0}),approved,
  "ALLOW_DENY_TRAFFIC_NOT_BOTH_OBSERVED");
 checkBlocked(tamper(x=>{x.nftables[4].rule.expr[0].counter.bytes=-1}),approved,
  "DEFAULT_DROP_RULE_MISSING");
});

test("QA source must not change runtime firewall or authorize pilot",()=>{
 const source=readFileSync(new URL("./cst-team-onejob-nft-egress-qa.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/execFile|spawn\(|iptables -I|nft -f|docker run|child_process/);
 assert.match(source,/operationalAuthority:false/);
 assert.match(source,/independentOperationalEgressAclVerified:false/);
});

test("dynamic module import cannot trigger CLI stdin or a side effect",()=>{
  const path=fileURLToPath(new URL("./cst-team-onejob-nft-egress-qa.mjs",import.meta.url));
  const r=spawnSync(process.execPath,[
    "--input-type=module","-e",
    'await import(process.argv[1]);console.log("IMPORT_ONLY_NO_READ");',
    path,approved,
  ],{encoding:"utf8",input:"",timeout:2000});
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stdout.trim(),"IMPORT_ONLY_NO_READ");
});

test("explicit --audit-kernel-qa CLI reads only supplied kernel JSON",()=>{
  const path=fileURLToPath(new URL("./cst-team-onejob-nft-egress-qa.mjs",import.meta.url));
  const run=(ip)=>spawnSync(process.execPath,[path,"--audit-kernel-qa",ip],
    {encoding:"utf8",input:JSON.stringify(sample),timeout:2000});
  const ok=run(approved);
  assert.equal(ok.status,0,ok.stderr);
  const evidence=JSON.parse(ok.stdout);
  assert.equal(evidence.qaNamespacePolicyVerified,true);
  assert.equal(evidence.operationalAuthority,false);
  const denied=run("198.51.100.99");
  assert.equal(denied.status,2,denied.stderr);
  assert.equal(JSON.parse(denied.stdout).qaNamespacePolicyVerified,false);
});
