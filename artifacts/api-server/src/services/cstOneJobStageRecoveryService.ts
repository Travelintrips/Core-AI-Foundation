/**
 * Recover a potentially committed Super Admin POST without retrying it.
 * Uses the ALREADY-existing dedicated stage login / SET LOCAL writer.
 * No new roles, grants, table mutations, or owner consents.
 */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {sql} from "drizzle-orm";
import {getCstOneJobStagingDatabase} from "../lib/cstOneJobStagingDatabase.js";
import {CST_ONEJOB_STAGE_LOGIN} from "../lib/cstOneJobStageDbConfig.js";
import {evaluateCstOneJobStageEnvironment} from "./cstOneJobOwnerApprovalStageService.js";
import {reviewCstOneJobStageRecovery} from "../lib/cstOneJobStageRecoveryReview.js";

export async function getCstOneJobStageRecoveryForVerifiedOwner(input:{
  ownerUserId:number;env:NodeJS.ProcessEnv
}){
 if(!Number.isSafeInteger(input.ownerUserId)||input.ownerUserId<=0)
   throw Error("ACTIVE_OWNER_SESSION_REQUIRED");
 let sha="";
 try{sha=readFileSync(resolve(process.cwd(),".cst-build-sha"),"utf8").trim()}catch{}
 const gate=evaluateCstOneJobStageEnvironment(input.env,sha);
 if(!gate.eligibleForWaitingStage)throw Error("ONEJOB_RECOVERY_UNAVAILABLE");
 const stageDb=getCstOneJobStagingDatabase(input.env);
 return stageDb.transaction(async tx=>{
  await tx.execute(sql`SET TRANSACTION READ ONLY`);
  await tx.execute(sql`SET LOCAL ROLE cst_team_model_pilot_writer`);
  const identity=await tx.execute(sql`
   SELECT current_user AS writer,session_user AS login,
     current_database() AS database_name`);
  const actor=identity.rows[0] as Record<string,unknown>|undefined;
  if(identity.rows.length!==1||
     actor?.writer!=="cst_team_model_pilot_writer"||
     actor?.login!==CST_ONEJOB_STAGE_LOGIN||
     actor?.database_name!=="postgres")
    throw Error("ONEJOB_RECOVERY_SCOPED_LOGIN_NOT_VERIFIED");
  const owner=await tx.execute(sql`
   SELECT id FROM ai_platform.internal_users
   WHERE id=${input.ownerUserId} AND role='owner'
     AND status='active' AND account_type='internal'`);
  if(owner.rows.length!==1)throw Error("ONEJOB_RECOVERY_OWNER_NOT_ACTIVE");
  // SELECT only the columns explicitly allowed by the scoped writer.
  // LIMIT 2 catches unexpected singleton-index drift.
  const approvals=await tx.execute(sql`
   SELECT id::text AS approval_id,job_id,request_id,source_sha,
     company_id,model_id,status,expires_at::text AS expires_at
   FROM ai_platform.cst_onejob_owner_approvals
   WHERE approved_by_user_id=${input.ownerUserId}
     AND company_id='1' AND model_id='qwen2.5:3b'
     AND status='APPROVED' AND consumed_at IS NULL
   ORDER BY expires_at DESC LIMIT 2`);
  if(approvals.rows.length>1)
    throw Error("ONEJOB_RECOVERY_DUPLICATE_ACTIVE_APPROVAL");
  const approval=approvals.rows[0] as Record<string,unknown>|undefined;
  if(!approval)return reviewCstOneJobStageRecovery({
    approval:null,job:null,expectedSourceSha:sha
  });
  const jobId=Number(approval.job_id);
  if(!Number.isSafeInteger(jobId)||jobId<=482)
    throw Error("ONEJOB_RECOVERY_INVALID_JOB_ID");
  const jobs=await tx.execute(sql`
   SELECT id,job_code,status,job_type,
     payload_json->>'requestId' AS request_id,
     payload_json->>'modelId' AS model_id
   FROM ai_platform.ai_jobs WHERE id=${jobId} LIMIT 2`);
  if(jobs.rows.length>1)throw Error("ONEJOB_RECOVERY_DUPLICATE_JOB");
  return reviewCstOneJobStageRecovery({
    approval,job:jobs.rows[0]??null,expectedSourceSha:sha
  });
 });
}
