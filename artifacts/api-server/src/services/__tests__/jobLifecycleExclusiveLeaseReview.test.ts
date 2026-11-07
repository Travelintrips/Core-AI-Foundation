import { describe, expect, it } from "vitest";
import { reviewExclusiveResumeLease, type ResumeCommandLease } from "../jobLifecycleExclusiveLeaseReview.js";
const now = new Date("2026-11-08T01:00:00Z");
const lease=():ResumeCommandLease=>({ commandId:"cmd",ownerWorkerId:"pc1",token:"lease-token",
  fencingVersion:4,acquiredAt:new Date(now.getTime()-60000),
  expiresAt:new Date(now.getTime()+60000),releasedAt:null });
const base=()=>({commandId:"cmd",intendedWorkerId:"pc1",expectedToken:"lease-token",
  minimumFencingVersion:4,lease:lease(),serverRecordVerified:true,now});
describe("exclusive resume command lease read-only assessment",()=>{
 it("valid lease only allows further review",()=>expect(reviewExclusiveResumeLease(base())).toEqual({
   validForFurtherReview:true,reason:"LEASE_REVIEW_VALID",mayDispatchWorker:false,mayCloseJob:false}));
 it("missing or unverified records deny",()=>{
   expect(reviewExclusiveResumeLease({...base(),lease:null}).reason).toBe("NO_LEASE");
   expect(reviewExclusiveResumeLease({...base(),serverRecordVerified:false}).reason).toBe("UNVERIFIED_LEASE");
 });
 it("cannot use another command or another worker presence",()=>{
   expect(reviewExclusiveResumeLease({...base(),commandId:"other"}).reason).toBe("COMMAND_MISMATCH");
   for(const worker of ["pc2","pc3"])
     expect(reviewExclusiveResumeLease({...base(),intendedWorkerId:worker}).reason).toBe("WORKER_MISMATCH");
 });
 it("rejects wrong token and stale fencing version",()=>{
   expect(reviewExclusiveResumeLease({...base(),expectedToken:"replayed"}).reason).toBe("TOKEN_MISMATCH");
   expect(reviewExclusiveResumeLease({...base(),minimumFencingVersion:5}).reason).toBe("INVALID_FENCING_VERSION");
   expect(reviewExclusiveResumeLease({...base(),minimumFencingVersion:0}).reason).toBe("INVALID_FENCING_VERSION");
 });
 it("rejects expired released future and malformed leases",()=>{
   expect(reviewExclusiveResumeLease({...base(),lease:{...lease(),expiresAt:now}}).reason).toBe("LEASE_EXPIRED");
   expect(reviewExclusiveResumeLease({...base(),lease:{...lease(),releasedAt:now}}).reason).toBe("LEASE_RELEASED");
   expect(reviewExclusiveResumeLease({...base(),lease:{...lease(),acquiredAt:new Date(now.getTime()+200000),expiresAt:new Date(now.getTime()+300000)}}).reason).toBe("NOT_YET_ACQUIRED");
   expect(reviewExclusiveResumeLease({...base(),now:new Date(NaN)}).reason).toBe("INVALID_TIME");
 });
});
