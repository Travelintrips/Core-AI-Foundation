import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks=vi.hoisted(()=>({
  execute:vi.fn(),transaction:vi.fn(),calls:0,recorded:[] as string[],
}));
vi.mock("@workspace/db",()=>({db:{transaction:async(fn:(tx:unknown)=>unknown)=>fn({execute:mocks.execute})}}));
import {recordHumanRecoveryRecommendation,validateHumanRecoverySubject} from "../humanRecoveryDecisionService.js";

const input={
 humanTaskId:6,commandId:"83db99f5-cbda-4e60-be71-3090fb411bbb",jobId:135,
 actor:"admcst001@gmail.com",decision:"recommend_new_attempt" as const,
 notes:"Original artifact verified; recommend new controlled DEV attempt only.",
};
const task={id:6,source_module:"ai_core_lifecycle",status:"accepted",assigned_user:"admcst001@gmail.com",
 payload_json:{commandId:input.commandId,taskId:135,resumeAllowed:false}};
beforeEach(()=>{
 mocks.calls=0;
 mocks.execute.mockReset().mockImplementation(async()=>{
   mocks.calls++;
   if(mocks.calls===1)return {rows:[task]};
   if(mocks.calls===2)return {rows:[{evidence_ok:true,original_command_verified:true,prior_decision:false}]};
   return {rows:[{id:19,created_at:new Date()}]};
 });
});
describe("human recovery recommendation remains fail closed",()=>{
 it("rejects actor spoof, wrong command, different job, and resume enabled",()=>{
   expect(validateHumanRecoverySubject({sourceModule:task.source_module,status:task.status,
    assignedUser:task.assigned_user,payload:task.payload_json,commandId:input.commandId,jobId:135,actor:"intruder@example.com"}))
    .toBe("ASSIGNED_HUMAN_REVIEWER_REQUIRED");
   expect(validateHumanRecoverySubject({sourceModule:task.source_module,status:task.status,
    assignedUser:task.assigned_user,payload:task.payload_json,commandId:"wrong",jobId:135,actor:input.actor}))
    .toBe("RECOVERY_SUBJECT_MISMATCH");
   expect(validateHumanRecoverySubject({sourceModule:task.source_module,status:task.status,
    assignedUser:task.assigned_user,payload:task.payload_json,commandId:input.commandId,jobId:136,actor:input.actor}))
    .toBe("RECOVERY_SUBJECT_MISMATCH");
   expect(validateHumanRecoverySubject({sourceModule:task.source_module,status:task.status,
    assignedUser:task.assigned_user,payload:{...task.payload_json,resumeAllowed:true},commandId:input.commandId,jobId:135,actor:input.actor}))
    .toBe("RECOVERY_NOT_FAIL_CLOSED");
 });
 it("requires accepted review",()=>{
   expect(validateHumanRecoverySubject({sourceModule:task.source_module,status:"assigned",
    assignedUser:task.assigned_user,payload:task.payload_json,commandId:input.commandId,jobId:135,actor:input.actor}))
    .toBe("REVIEW_NOT_ACCEPTED");
 });
 it("records only audit recommendation, never dispatch permission",async()=>{
   const x=await recordHumanRecoveryRecommendation(input);
   expect(x).toMatchObject({ok:true,historyId:19,decision:"recommend_new_attempt",
      dispatchAuthorized:false,resumeAllowed:false});
   expect(mocks.execute).toHaveBeenCalledTimes(3);
 });
 it("denial is also a recorded audit, not a command",async()=>{
   const x=await recordHumanRecoveryRecommendation({...input,decision:"deny_new_attempt"});
   expect(x).toMatchObject({ok:true,decision:"deny_new_attempt",dispatchAuthorized:false,resumeAllowed:false});
 });
 it("duplicate decision fails closed",async()=>{
   mocks.execute.mockImplementationOnce(async()=>({rows:[task]}))
    .mockImplementationOnce(async()=>({rows:[{evidence_ok:true,original_command_verified:true,prior_decision:true}]}));
   const x=await recordHumanRecoveryRecommendation(input);
   expect(x).toMatchObject({ok:false,error:"RECOVERY_RECOMMENDATION_ALREADY_RECORDED"});
   expect(mocks.execute).toHaveBeenCalledTimes(2);
 });
 it("missing evidence or invalid original command blocks recommendation",async()=>{
   mocks.execute.mockImplementationOnce(async()=>({rows:[task]}))
    .mockImplementationOnce(async()=>({rows:[{evidence_ok:false,original_command_verified:true,prior_decision:false}]}));
   const x=await recordHumanRecoveryRecommendation(input);
   expect(x).toMatchObject({ok:false,error:"RECOVERY_EVIDENCE_NOT_VERIFIED"});
   expect(mocks.execute).toHaveBeenCalledTimes(2);
 });
});
