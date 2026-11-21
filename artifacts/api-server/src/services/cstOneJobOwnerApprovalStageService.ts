/**
 * One-use CST-DEV Super Admin approval (existing internal role "owner")
 * + WAITING model job staging. One human consent only.
 *
 * Deliberately fail closed until a separately reviewed DEV migration and
 * bounded writer policy exist. This is not the dispatcher / release gate.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import {getCstOneJobStagingDatabase} from "../lib/cstOneJobStagingDatabase.js";
import {CST_ONEJOB_STAGE_LOGIN} from "../lib/cstOneJobStageDbConfig.js";
import {CST_ONEJOB_PUBLIC_OPERATIONS_CANDIDATE_SHA256} from
 "../lib/cstOneJobOperationsRootCandidate.js";

const SHA = /^[a-f0-9]{40}$/;
const WORKER = /^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const PILOT_PREFIX = "cst-ai-team-company1-dev:pilot-";

export function evaluateCstOneJobStageEnvironment(env: NodeJS.ProcessEnv, buildSha: string) {
  const blockers: string[] = [];
  const check=(ok:boolean,reason:string)=>{if(!ok)blockers.push(reason)};
  check(env.APP_ENV==="development" && env.NODE_ENV==="development",
    "DEV_ONLY");
  check(env.CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED==="true",
    "ONEJOB_APPROVAL_FEATURE_DISABLED");
  check(env.AI_DISPATCHER_ENABLED==="false" &&
    env.OLLAMA_WORKER_RUNTIME_ENABLED==="false",
    "DISPATCH_OR_WORKER_NOT_DISABLED");
  check(!env.SUPABASE_PROD_DATABASE_URL,
    "PROD_DATABASE_ENV_PRESENT");
  check(SHA.test(buildSha) && buildSha===env.CST_TEAM_DEV_APPROVED_SOURCE_SHA,
    "DEV_SOURCE_SHA_NOT_PINNED");
  check(WORKER.test(env.CST_TEAM_DEV_APPROVED_WORKER_NAME ?? ""),
    "ONEJOB_WORKER_NOT_PINNED");
  check(env.CST_DEV_ONEJOB_OPERATIONS_CANDIDATE_FINGERPRINT===
    CST_ONEJOB_PUBLIC_OPERATIONS_CANDIDATE_SHA256,
    "OPERATIONS_PUBLIC_CANDIDATE_NOT_MATCHED");
  return {eligibleForWaitingStage:blockers.length===0,blockers};
}

export async function stageCstDevOneJobForVerifiedOwner(input:{
  ownerUserId:number;
  env:NodeJS.ProcessEnv;
}) {
  if(!Number.isSafeInteger(input.ownerUserId) || input.ownerUserId<1)
    throw Error("VERIFIED_OWNER_ID_REQUIRED");
  let buildSha="";
  try{buildSha=readFileSync(resolve(process.cwd(),".cst-build-sha"),"utf8").trim()}catch{}
  const gate=evaluateCstOneJobStageEnvironment(input.env,buildSha);
  if(!gate.eligibleForWaitingStage)
    throw Error("ONEJOB_STAGE_NOT_READY:"+gate.blockers.join(","));
  const workerName=input.env.CST_TEAM_DEV_APPROVED_WORKER_NAME!;
  // Signed job-specific QA PRE cannot bind the real jobId/approvalId
  // until the same Super Admin creates ONE nonclaimable WAITING job.
  // Require genuine QA PRE, signed job release, limited capability and
  // one-use nonce BEFORE WAITING->QUEUED; never bypass those gates.
  const requestId=PILOT_PREFIX+randomBytes(10).toString("hex");
  const jobCode="OLLAMA-"+randomBytes(4).toString("hex").toUpperCase();
  const payload={
    requestId,modelId:"qwen2.5:3b",
    input:JSON.stringify({
      version:1,
      system:"DEV-only model liveness check. Reply exactly with the requested token.",
      user:"Reply CST_DEV_ONEJOB_PROBE_OK",
    }),
    responseFormat:{type:"text"},
    maxOutputTokens:24,
  };
  const stageDb=getCstOneJobStagingDatabase(input.env);
  return stageDb.transaction(async tx=>{
    // Explicitly request a writable transaction on DEV pooler connections.
    // If the database is read-only or this statement fails, the stage stops.
    await tx.execute(sql`SET TRANSACTION READ WRITE`);
    // SET LOCAL is valid only inside this transaction and automatically
    // clears on COMMIT/ROLLBACK. The separate LOGIN has SET TRUE only for
    // the NOLOGIN writer role. The common Core AI DB pool cannot SET it.
    await tx.execute(sql`SET LOCAL ROLE cst_team_model_pilot_writer`);
    // Current shared aicore_dev_runtime RLS allows coding work only: it
    // cannot safely stage ollama_model_invocation. Require a separately
    // provisioned, exact DEV-only writer principal and reviewed RLS policies,
    // rather than broadening shared runtime grants. No such writer exists yet.
    const boundary=await tx.execute(sql`
      SELECT current_user AS role_name, session_user AS login_role_name,
        EXISTS(
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname='ai_platform' AND p.tablename='ai_jobs'
            AND p.policyname='cst_onejob_stage_insert'
            AND p.cmd='INSERT'
            AND 'cst_team_model_pilot_writer'=ANY(p.roles)
        ) AS job_insert_scoped,
        EXISTS(
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname='ai_platform' AND p.tablename='ai_jobs'
            AND p.policyname='cst_onejob_stage_select'
            AND p.cmd='SELECT'
            AND 'cst_team_model_pilot_writer'=ANY(p.roles)
        ) AS job_read_scoped,
        EXISTS(
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname='ai_platform'
            AND p.tablename='cst_onejob_owner_approvals'
            AND p.policyname='cst_onejob_stage_approval_insert'
            AND p.cmd='INSERT'
            AND 'cst_team_model_pilot_writer'=ANY(p.roles)
        ) AS approval_insert_scoped`);
    const scope=boundary.rows[0] as Record<string,unknown> | undefined;
    if(boundary.rows.length!==1 ||
      scope?.role_name!=='cst_team_model_pilot_writer' ||
      scope?.login_role_name!==CST_ONEJOB_STAGE_LOGIN ||
      scope?.job_insert_scoped!==true ||
      scope?.job_read_scoped!==true ||
      scope?.approval_insert_scoped!==true)
      throw Error("ONEJOB_DEDICATED_WRITER_RLS_NOT_PROVISIONED");

    // Verify the active internal Owner using SELECT-only RLS. PostgreSQL
    // FOR SHARE would require UPDATE privilege on internal_users; that is
    // intentionally NOT granted to the limited pilot writer. This stages
    // WAITING only: queue admission must independently revalidate the Owner
    // under its own audited, transaction-bound permission gate.
    const actor=await tx.execute(sql`
      SELECT id FROM ai_platform.internal_users
      WHERE id=${input.ownerUserId}
        AND role='owner' AND status='active' AND account_type='internal'`);
    if(actor.rows.length!==1)throw Error("OWNER_NOT_ACTIVE_IN_TRANSACTION");
    const index=await tx.execute(sql`
      SELECT i.indisunique,i.indisvalid,i.indisready
      FROM pg_index i
      JOIN pg_class c ON c.oid=i.indexrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='ai_platform'
        AND c.relname='ai_jobs_company1_pilot_request_unique'`);
    const record=index.rows[0] as Record<string,unknown> | undefined;
    if(index.rows.length!==1 || record?.indisunique!==true ||
      record?.indisvalid!==true || record?.indisready!==true)
      throw Error("ONEJOB_UNIQUE_INDEX_NOT_READY");
    // A unique request ID alone cannot protect against two distinct
    // concurrent clicks. The one-active-approval partial UNIQUE index
    // must also be valid/ready; it serializes this Company-1 pilot across
    // transactions and a failed second approval rolls its WAITING job back.
    const singleton=await tx.execute(sql`
      SELECT i.indisunique,i.indisvalid,i.indisready
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a
        ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
      WHERE n.nspname='ai_platform'
        AND c.relname='cst_onejob_one_active_approval'
        AND i.indrelid='ai_platform.cst_onejob_owner_approvals'::regclass
        AND i.indnkeyatts=1 AND a.attname='company_id'
        AND pg_get_expr(i.indpred,i.indrelid)=
          '(status = ANY (ARRAY[''APPROVED''::text, ''CONSUMED''::text]))'`);
    const one=singleton.rows[0] as Record<string,unknown>|undefined;
    if(singleton.rows.length!==1 || one?.indisunique!==true ||
      one?.indisvalid!==true || one?.indisready!==true)
      throw Error("ONEJOB_SINGLE_ACTIVE_INDEX_NOT_READY");

    // The transaction stages a non-claimable WAITING job. No caller can
    // turn it into QUEUED until a distinct verified pilot admission step.
    const result=await tx.execute(sql`
      INSERT INTO ai_platform.ai_jobs
       (job_code,job_type,required_capability,payload_json,priority,
        priority_score,status,max_retry,retry_strategy,created_at,updated_at)
      VALUES (${jobCode},'ollama_model_invocation','ollama_inference',
        ${JSON.stringify(payload)}::jsonb,70,70,'waiting',0,'immediate',now(),now())
      RETURNING id,status,job_code`);
    const job=result.rows[0] as Record<string,unknown> | undefined;
    if(!job || job.status!=="waiting" ||
      !Number.isSafeInteger(Number(job.id)) || Number(job.id)===482)
      throw Error("ONEJOB_WAITING_JOB_NOT_CREATED");
    const jobId=Number(job.id);

    const approvals=await tx.execute(sql`
      INSERT INTO ai_platform.cst_onejob_owner_approvals
       (purpose,status,company_id,model_id,approved_by_user_id,
        request_id,worker_name,source_sha,job_id,expires_at)
      VALUES ('CST_DEV_ONEJOB_MODEL','APPROVED','1','qwen2.5:3b',
       ${input.ownerUserId},${requestId},${workerName},${buildSha},
       ${jobId},now()+interval '20 minutes')
      RETURNING id,expires_at`);
    const approval=approvals.rows[0] as Record<string,unknown> | undefined;
    if(!approval?.id)throw Error("OWNER_APPROVAL_NOT_PERSISTED");

    // Fail the whole transaction if the immutable staging audit fails.
    await tx.execute(sql`
      INSERT INTO ai_platform.ai_audit_logs
       (module,action,resource_type,resource_id,status,details)
      VALUES ('cst-onejob','owner_approved_waiting_job','ai_job',
        ${String(jobId)},'success',
        jsonb_build_object('ownerUserId',${input.ownerUserId},
          'approvalId',${String(approval.id)},'requestId',${requestId},
          'workerName',${workerName},'sourceSha',${buildSha},
          'operationsRootCandidateSha256',${CST_ONEJOB_PUBLIC_OPERATIONS_CANDIDATE_SHA256},
          'sameSuperAdminRootSelection',true,
          'operationsRootTrusted',false,
          'independentQaAdmissionVerified',false,
          'dispatchPermitted',false))`);
    return {
      approvalId:String(approval.id),jobId,jobCode:String(job.job_code),
      requestId,workerName,status:"waiting" as const,
      expiresAt:String(approval.expires_at),
      operationsRootCandidateSha256:CST_ONEJOB_PUBLIC_OPERATIONS_CANDIDATE_SHA256,
      operationsRootTrusted:false,independentQaAdmissionVerified:false,
      admissionReady:false,dispatchPermitted:false,finalAckVerified:false,
    };
  });
}
