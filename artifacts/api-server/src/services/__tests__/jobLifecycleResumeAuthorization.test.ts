import { describe, expect, it } from "vitest";
import { reviewResumeAuthorization, type ResumeGrantRecord } from "../jobLifecycleResumeAuthorization.js";
const now = new Date("2026-11-08T01:00:00Z");
const grant = (): ResumeGrantRecord => ({
  commandId:"command1",blockerResponseId:"blocker1",checkpointResponseId:"cp1",
  workerId:"worker1",status:"APPROVED",approvedBy:"admin-dev",
  approvedAt:new Date(now.getTime()-60000),expiresAt:new Date(now.getTime()+60000),consumedAt:null,
});
const base = () => ({commandId:"command1",blockerResponseId:"blocker1",checkpointResponseId:"cp1",
  intendedWorkerId:"worker1",grant:grant(),serverRecordVerified:true,now});
describe("DEV resume authorization review never dispatches",()=>{
  it("valid grant only passes further review",()=>{
    expect(reviewResumeAuthorization(base())).toEqual({validForFurtherReview:true,
      reason:"GRANT_REVIEW_VALID",mayDispatchWorker:false,mayCloseJob:false});
  });
  it("missing/unverified grant fails closed",()=>{
    expect(reviewResumeAuthorization({...base(),grant:null}).reason).toBe("NO_GRANT");
    expect(reviewResumeAuthorization({...base(),serverRecordVerified:false}).reason).toBe("UNVERIFIED_SERVER_RECORD");
  });
  it("rejects command, blocker, checkpoint and worker mismatch",()=>{
    for(const [field,reason] of [
      ["commandId","COMMAND_MISMATCH"],["blockerResponseId","BLOCKER_MISMATCH"],
      ["checkpointResponseId","CHECKPOINT_MISMATCH"],["intendedWorkerId","WORKER_MISMATCH"]
    ] as const) {
      expect(reviewResumeAuthorization({...base(),[field]:"other"}).reason).toBe(reason);
    }
  });
  it("pending, revoked and consumed states are never approved",()=>{
    for(const status of ["PENDING","REVOKED","CONSUMED"] as const)
      expect(reviewResumeAuthorization({...base(),grant:{...grant(),status}}).reason).toBe("NOT_APPROVED");
  });
  it("rejects empty approver",()=>{
    expect(reviewResumeAuthorization({...base(),grant:{...grant(),approvedBy:" "}}).reason).toBe("INVALID_APPROVER");
  });
  it("rejects invalid times and future approvals",()=>{
    expect(reviewResumeAuthorization({...base(),now:new Date(NaN)}).reason).toBe("INVALID_TIME");
    expect(reviewResumeAuthorization({...base(),grant:{...grant(),expiresAt:new Date(NaN)}}).reason).toBe("INVALID_TIME");
    expect(reviewResumeAuthorization({...base(),grant:{...grant(),approvedAt:new Date(now.getTime()+1000)}}).reason).toBe("NOT_YET_APPROVED");
    expect(reviewResumeAuthorization({...base(),grant:{...grant(),approvedAt:new Date(now.getTime()+1000),expiresAt:new Date(now.getTime()+100000)}}).reason).toBe("NOT_YET_APPROVED");
  });
  it("rejects expiration at exact boundary",()=>{
    expect(reviewResumeAuthorization({...base(),grant:{...grant(),expiresAt:now}}).reason).toBe("EXPIRED");
  });
  it("rejects replayed/consumed grant",()=>{
    expect(reviewResumeAuthorization({...base(),grant:{...grant(),consumedAt:now}}).reason).toBe("ALREADY_CONSUMED");
  });
});
