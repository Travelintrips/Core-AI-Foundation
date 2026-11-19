import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({calls:0,rows:[] as Array<Record<string,unknown>>,error:false}));
vi.mock("@workspace/db",()=>({db:{execute:async()=>{mocks.calls++;if(mocks.error)throw Error("permission denied");return {rows:mocks.rows};}}}));
import {getGpt02Job135CrossLedgerReadback,interpretGpt02CrossLedgerCounts}
  from "../gpt02Job135CrossLedgerReadback.js";
const input=()=>({humanReviewId:6,jobId:135,parentCommandId:"83db99f5-cbda-4e60-be71-3090fb411bbb"});
const row={subject_bound:true,parent_event_count:1,job_event_count:0,tagged_child_count:0,review_record_count:2};
describe("job 135 cross-ledger facts are never execution authority",()=>{
 const app=process.env["APP_ENV"],node=process.env["NODE_ENV"];
 beforeEach(()=>{process.env["APP_ENV"]="development";process.env["NODE_ENV"]="development";
   mocks.calls=0;mocks.rows=[row];mocks.error=false;});
 afterEach(()=>{if(app===undefined)delete process.env["APP_ENV"];else process.env["APP_ENV"]=app;
   if(node===undefined)delete process.env["NODE_ENV"];else process.env["NODE_ENV"]=node;});
 it("a clean explicit-tag scan cannot prove absence of untagged work",async()=>{
   expect(await getGpt02Job135CrossLedgerReadback(input())).toMatchObject({
     valid:true,parentEventCount:1,explicitJobEventCount:0,taggedChildCount:0,
     reviewRecordCount:2,legacyUntaggedAttemptsExcluded:false,
     mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false});
   expect(mocks.calls).toBe(1);
 });
 it("unavailable event ledger is explicit, never an empty valid census",async()=>{
   mocks.error=true;
   expect(await getGpt02Job135CrossLedgerReadback(input())).toMatchObject({
     valid:false,reason:"CROSS_LEDGER_READBACK_UNAVAILABLE",
     legacyUntaggedAttemptsExcluded:false,mayCreateCommand:false,
     mayDispatchWorker:false,mayCloseJob:false});
 });
 it("production and invalid UUID fail before querying DB",async()=>{
   process.env["APP_ENV"]="production";
   expect(await getGpt02Job135CrossLedgerReadback(input())).toMatchObject({
     valid:false,reason:"DEV_ONLY",mayDispatchWorker:false});
   process.env["APP_ENV"]="development";
   expect(await getGpt02Job135CrossLedgerReadback({...input(),parentCommandId:"bad"}))
     .toMatchObject({valid:false,reason:"INVALID_CROSS_LEDGER_SUBJECT"});
   expect(mocks.calls).toBe(0);
 });
 it("missing exact Human Review binding is not a valid zero-count census",()=>{
   expect(interpretGpt02CrossLedgerCounts({...row,subject_bound:false,
      parent_event_count:0,job_event_count:0,tagged_child_count:0,
      review_record_count:0})).toMatchObject({
     valid:false,reason:"CROSS_LEDGER_REVIEW_SUBJECT_NOT_BOUND",
     legacyUntaggedAttemptsExcluded:false,mayDispatchWorker:false});
   expect(interpretGpt02CrossLedgerCounts({
      parent_event_count:0,job_event_count:0,tagged_child_count:0,
      review_record_count:0})).toMatchObject({
     valid:false,reason:"CROSS_LEDGER_BINDING_UNVERIFIED"});
 });
 it("absent or malformed counts cannot claim evidence",()=>{
   expect(interpretGpt02CrossLedgerCounts(undefined)).toMatchObject({
     valid:false,reason:"CROSS_LEDGER_SNAPSHOT_MISSING"});
   expect(interpretGpt02CrossLedgerCounts({...row,tagged_child_count:-1}))
     .toMatchObject({valid:false,reason:"CROSS_LEDGER_SNAPSHOT_INVALID"});
   expect(interpretGpt02CrossLedgerCounts({...row,review_record_count:"2"}))
     .toMatchObject({valid:false,reason:"CROSS_LEDGER_SNAPSHOT_INVALID"});
 });
 it("tagged descendants remain a blocker, not permission",()=>{
   expect(interpretGpt02CrossLedgerCounts({...row,tagged_child_count:3})).toMatchObject({
     valid:true,taggedChildCount:3,legacyUntaggedAttemptsExcluded:false,
     mayCreateCommand:false,mayCloseJob:false});
 });
});
