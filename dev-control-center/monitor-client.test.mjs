import test from "node:test";
import assert from "node:assert/strict";
import {readCodingJobs,normalizeJobs,canOperate} from "./monitor-client.mjs";
test("authenticated same-origin read and bounded jobs",async()=>{
 let args;
 const fetchMock=async (...x)=>{args=x;return {ok:true,status:200,json:async()=>({jobs:[{id:"job-1",application:"Fleet",status:"RUNNING"}]})};};
 assert.equal((await readCodingJobs(fetchMock))[0].status,"RUNNING");
 assert.equal(args[0],"/api/dev-center/jobs");
 assert.equal(args[1].credentials,"same-origin");
});
test("denies unauthenticated fetch",async()=>{
 await assert.rejects(()=>readCodingJobs(async()=>({ok:false,status:401})),/AUTH_REQUIRED/);
});
test("rejects malformed payload and unknown statuses",()=>{
 assert.throws(()=>normalizeJobs({}),/INVALID_JOBS_RESPONSE/);
 assert.deepEqual(normalizeJobs({jobs:[{id:"x",status:"SUCCEEDED_DEPLOYED"}]}),[]);
});
test("mutating controls are denied without role or safe transition",()=>{
 const job={status:"RUNNING"};
 assert.equal(canOperate({principal:{roles:["dev.read"]},job,operation:"stop"}),false);
 assert.equal(canOperate({principal:{roles:["dev.control"]},job,operation:"stop"}),true);
 assert.equal(canOperate({principal:{roles:["dev.control"]},job,operation:"retry"}),false);
});
