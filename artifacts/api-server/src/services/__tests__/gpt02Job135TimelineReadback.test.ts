import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({
  calls:0,
  plan:[] as Array<Array<Record<string,unknown>>>,
  proof:vi.fn(),
}));
vi.mock("@workspace/db",()=>({db:{execute:async()=>({rows:mock.plan[mock.calls++]??[]})}}));
vi.mock("../codingCommandLifecycleEvidence.js",()=>({
  getCodingCommandLifecycleEvidence:mock.proof,
}));
const crossLedgerMock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("../gpt02Job135CrossLedgerReadback.js",()=>({
  getGpt02Job135CrossLedgerReadback:crossLedgerMock.read,
}));
import {getGpt02Job135TimelineReadback,validateGpt02TimelineReadbackInput}
  from "../gpt02Job135TimelineReadback.js";
const parent="83db99f5-cbda-4e60-be71-3090fb411bbb";
const child="41aa961d-ac1e-4e12-a2c8-28ed07ff97cc";
const input=()=>({humanReviewId:6,jobId:135,parentCommandId:parent});
const task=(candidate:string|null=child)=>({
  id:6,status:"accepted",assigned_user:"operator@example.test",
  candidate_command_id:candidate,
});
const response=(kind:string,id:string,commandId:string=child)=>({
  id,command_id:commandId,kind,created_at:new Date("2026-11-08T16:00:00Z"),
  acknowledged_at:new Date("2026-11-08T16:01:00Z"),
});
const proof=(commandId:string)=>({
  found:true,commandId,checkpointResponseId:"checkpoint-1",
  checkpointAttested:true,nativeReceiverAckVerified:true,
});
describe("server-read GPT02 timeline never trusts fabricated final ACK",()=>{
  const oldApp=process.env["APP_ENV"],oldNode=process.env["NODE_ENV"];
  beforeEach(()=>{
    process.env["APP_ENV"]="development";process.env["NODE_ENV"]="development";
    mock.calls=0;mock.plan=[[task()],[{reservations_present:true,candidate_reader_present:true,
       command_links_present:true,leases_present:true,receipts_present:true}],[{can_execute:true}],[{candidate_command_id:child}],[response("COMPLETED","completed-1")]];
    mock.proof.mockImplementation(async(cmd:string)=>proof(cmd));
    crossLedgerMock.read.mockResolvedValue({
      valid:true,reason:"LEGACY_UNTAGGED_HISTORY_NOT_EXCLUDED",
      parentEventCount:1,explicitJobEventCount:0,taggedChildCount:0,
      reviewRecordCount:2,legacyUntaggedAttemptsExcluded:false,
      mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
    });
  });
  afterEach(()=>{
    if(oldApp===undefined)delete process.env["APP_ENV"];else process.env["APP_ENV"]=oldApp;
    if(oldNode===undefined)delete process.env["NODE_ENV"];else process.env["NODE_ENV"]=oldNode;
    mock.proof.mockReset();
    crossLedgerMock.read.mockReset();
  });
  it("rejects production or bad identity before querying DB",async()=>{
    process.env["APP_ENV"]="production";
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:false,reason:"DEV_ONLY",mayDispatchWorker:false,mayCloseJob:false});
    process.env["APP_ENV"]="development";
    expect(validateGpt02TimelineReadbackInput({...input(),parentCommandId:"bad"}))
      .toBe("INVALID_TIMELINE_SUBJECT");
    expect(mock.calls).toBe(0);
  });
  it("staging and unspecified APP_ENV cannot read DEV-only timeline",async()=>{
    process.env["APP_ENV"]="staging";
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:false,reason:"DEV_ONLY",mayDispatchWorker:false,
    });
    delete process.env["APP_ENV"];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:false,reason:"DEV_ONLY",mayDispatchWorker:false,
    });
    expect(mock.calls).toBe(0);
  });
  it("review not bound to exact job and parent is denied",async()=>{
    mock.plan=[[]];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:false,reason:"HUMAN_REVIEW_JOB_BINDING_NOT_FOUND"});
  });
  it("infrastructure schema and disabled flags do not grant issuer authority",async()=>{
    process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"]="false";
    process.env["AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED"]="false";
    try{
      const result=await getGpt02Job135TimelineReadback(input());
      expect(result).toMatchObject({
        ok:true,infrastructure:{
          reservationTablePresent:true,commandLinksTablePresent:true,
          leasesTablePresent:true,releaseReceiptsTablePresent:true,
          reservationMutationsEnabled:false,leaseMutationsEnabled:false,
          issuerVerified:false,legacyExternalAttemptsExcluded:false,
          nativeAckVerified:false,mayCreateCommand:false,mayDispatchWorker:false,
        },mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
      });
    }finally{
      delete process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"];
      delete process.env["AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED"];
    }
  });
  it("absent recovery-ledger schema metadata cannot be treated as installed",async()=>{
    mock.plan=[[task()],[{reservations_present:true,candidate_reader_present:true}]];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:false,reason:"RECOVERY_LEDGER_SCHEMA_READBACK_UNAVAILABLE",
      mayDispatchWorker:false,mayCloseJob:false,
    });
  });
  it("missing reservation migration reads baseline parent without mutation",async()=>{
    mock.plan=[[task(null)],[{reservations_present:false,candidate_reader_present:false,
       command_links_present:false,leases_present:false,receipts_present:false}],
      [response("FAILED","failed-1",parent)]];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:true,reservationSchemaAvailable:false,reservationEvidenceVerified:false,
      status:"ISSUER_NOT_VERIFIED",lastEventKind:"FAILED",
      mayDispatchWorker:false,mayCloseJob:false});
    expect(mock.calls).toBe(3);
  });
  it("DEV schema exists but narrow reader absent: parent timeline remains visible, no candidate assumed",async()=>{
    mock.plan=[[task()],[{reservations_present:true,candidate_reader_present:false,
       command_links_present:false,leases_present:false,receipts_present:false}],
      [response("FAILED","failed-1",parent)]];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:true,reservationSchemaAvailable:true,
      reservationReadbackStatus:"CANDIDATE_READER_NOT_INSTALLED",
      reservationEvidenceVerified:false,status:"ISSUER_NOT_VERIFIED",
      mayDispatchWorker:false,mayCloseJob:false});
    expect(mock.calls).toBe(3);
  });
  it("narrow reader installed but execution denied remains blocked",async()=>{
    mock.plan=[[task()],[{reservations_present:true,candidate_reader_present:true,
       command_links_present:true,leases_present:true,receipts_present:true}],
      [{can_execute:false}],[response("FAILED","failed-1",parent)]];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:true,reservationReadbackStatus:"CANDIDATE_READER_EXECUTE_DENIED",
      reservationEvidenceVerified:false,status:"ISSUER_NOT_VERIFIED",
      mayDispatchWorker:false,mayCloseJob:false});
  });
  it("missing schema probe must not be inferred as no reservation",async()=>{
    mock.plan=[[task()],[]];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:false,reason:"RESERVATION_SCHEMA_READBACK_UNAVAILABLE"});
  });
  it("candidate absent remains issuer-unverified",async()=>{
    mock.plan=[[task(null)],[{reservations_present:false,candidate_reader_present:false,
       command_links_present:false,leases_present:false,receipts_present:false}],[]];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:true,status:"ISSUER_NOT_VERIFIED",progressPercent:null,
      mayDispatchWorker:false,mayCloseJob:false});
    expect(mock.proof).toHaveBeenCalledTimes(1);
  });
  it("COMPLETED response never creates verified output without independent result checker",async()=>{
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:true,status:"BLOCKED_OR_UNVERIFIED",progressPercent:null,
      eligibleForCompletionReview:false,mayDispatchWorker:false,mayCloseJob:false});
    expect(mock.proof).toHaveBeenCalledTimes(2);
    expect(crossLedgerMock.read).toHaveBeenCalledWith(input());
  });
  it("signed checkpoint evidence can show native ACK but never final completion",async()=>{
    mock.plan=[[task()],[{reservations_present:true,candidate_reader_present:true,
       command_links_present:true,leases_present:true,receipts_present:true}],[{can_execute:true}],[{candidate_command_id:child}],[response("CHECKPOINT","checkpoint-1")]];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:true,lastEventKind:"CHECKPOINT",lastNativeAckVerified:true,
      eligibleForCompletionReview:false,mayCloseJob:false});
  });
  it("101 rows fail closed rather than silently truncate timeline",async()=>{
    mock.plan=[[task()],[{reservations_present:true,candidate_reader_present:true,
       command_links_present:true,leases_present:true,receipts_present:true}],[{can_execute:true}],[{candidate_command_id:child}],Array.from({length:101},(_,i)=>response("PROGRESS","r-"+i))];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:false,reason:"TIMELINE_RESPONSE_LIMIT_REACHED"});
    expect(mock.proof).not.toHaveBeenCalled();
  });
  it("invalid kind and command mismatch fail closed",async()=>{
    mock.plan=[[task()],[{reservations_present:true,candidate_reader_present:true,
       command_links_present:true,leases_present:true,receipts_present:true}],[{can_execute:true}],[{candidate_command_id:child}],[response("FORGED_PASS","fake")]];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:false,reason:"TIMELINE_RESPONSE_INVALID"});
    mock.calls=0;mock.plan=[[task()],[{reservations_present:true,candidate_reader_present:true,
       command_links_present:true,leases_present:true,receipts_present:true}],[{can_execute:true}],[{candidate_command_id:child}],[response("ACK","wrong", "a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc")]];
    expect(await getGpt02Job135TimelineReadback(input())).toMatchObject({
      ok:false,reason:"TIMELINE_RESPONSE_INVALID"});
  });
});
