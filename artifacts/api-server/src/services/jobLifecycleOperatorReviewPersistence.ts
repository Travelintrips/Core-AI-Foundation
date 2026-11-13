/** DEV-only durable audit of an already signed operator REVIEW INTENT.
 * No grants, leases, resume or dispatch. Revalidates live DB relationships
 * in the same INSERT statement, and fails closed if no row is inserted.
 */
import {sql} from "drizzle-orm";
import {db} from "@workspace/db";
import {verifyOperatorApprovalProof,type OperatorApprovalProof} from "./jobLifecycleOperatorApprovalProof.js";
import {isTrustedDevReviewWriterReady} from "./jobLifecycleReviewWriterReadiness.js";

export async function persistSignedDevOperatorReviewIntent(input:{
 proof:OperatorApprovalProof;trustedPublicKeyDerBase64:string|undefined;
 operatorUserId:number;operatorRole:"owner"|"admin";now:Date;
}):Promise<{recorded:boolean;reason:string;recordId?:string;mayIssueGrant:false;mayDispatchWorker:false}>{
 const deny=(reason:string)=>({recorded:false,reason,mayIssueGrant:false as const,mayDispatchWorker:false as const});
 if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]==="production"||
    process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"]!=="true")return deny("DEV_DISABLED");
 // Defense in depth: direct service calls cannot bypass the HTTP route gate.
 if(!isTrustedDevReviewWriterReady())return deny("TRUSTED_REVIEW_WRITER_NOT_IMPLEMENTED");
 const p=input.proof;
 if(!Number.isSafeInteger(input.operatorUserId)||input.operatorUserId<1||
    p.operatorId!=="internal:"+input.operatorUserId||p.operatorRole!==input.operatorRole)
   return deny("OPERATOR_IDENTITY_MISMATCH");
 const verification=verifyOperatorApprovalProof({proof:p,
   expectedCommandId:p.commandId,expectedCheckpointResponseId:p.checkpointResponseId,
   expectedBlockerResponseId:p.blockerResponseId,expectedWorkerId:p.workerId,
   now:input.now,serverPublicKeyDerBase64:input.trustedPublicKeyDerBase64});
 if(!verification.validForReview)return deny("SIGNATURE_"+verification.reason);
 try{
   // Server-owned transaction boundary: lock command in one statement, then
   // use a fresh statement snapshot for latest response, DEV worker and
   // operator checks. Native receipt/ACK verification remains in backend,
   // not in SQL; neither step issues a resume grant.
   // This is deliberately only an audit record with a unique nonce.
   // Two independent SQL statements in one READ COMMITTED transaction:
   // (1) acquire row lock, possibly waiting for a concurrent response FK lock;
   // (2) read response history with a NEW snapshot after the wait.
   // A single INSERT ... SELECT ... FOR UPDATE can use a stale statement
   // snapshot of responses even after waiting for the command row lock.
   const result=await db.transaction(async tx=>{
     const locked=await tx.execute(sql`
       SELECT id FROM ai_platform.ai_coding_bridge_commands
       WHERE id=${p.commandId}::uuid FOR UPDATE
     `);
     if((locked.rows??[]).length!==1)return {rows:[]};
     return tx.execute(sql`
    INSERT INTO ai_platform.dev_gpt02_operator_review_intents
    (command_id,checkpoint_response_id,blocker_response_id,operator_user_id,
     operator_role,worker_id,nonce,proof_json,signed_at,expires_at)
    SELECT c.id,cp.id,bl.id,u.id,u.role,${p.workerId},${p.nonce},
      ${JSON.stringify(p)}::jsonb,${p.issuedAt}::timestamptz,${p.expiresAt}::timestamptz
    FROM (
      SELECT id,status,metadata_json
      FROM ai_platform.ai_coding_bridge_commands
      WHERE id=${p.commandId}::uuid
      FOR UPDATE
    ) c
    JOIN ai_platform.ai_coding_bridge_responses cp
       ON cp.command_id=c.id AND cp.id=${p.checkpointResponseId}::uuid AND cp.kind='CHECKPOINT'
    JOIN ai_platform.ai_coding_bridge_responses bl
       ON bl.command_id=c.id AND bl.id=${p.blockerResponseId}::uuid AND bl.kind='BLOCKER'
    JOIN ai_platform.internal_users u
       ON u.id=${input.operatorUserId} AND u.role=${input.operatorRole}
       AND u.status='active' AND u.account_type='internal'
       AND u.must_change_password IS FALSE
    WHERE c.id=${p.commandId}::uuid AND c.status='PROCESSING'
      AND c.metadata_json->>'devOnly'='true'
      AND c.metadata_json->>'capability'='chatgpt:wake'
      AND c.metadata_json->>'assignedClientId'='openclaw-dell-chatgpt-wake-dev'
      AND cp.acknowledged_at IS NOT NULL
      AND cp.created_at<bl.created_at
      AND bl.id=(SELECT r.id FROM ai_platform.ai_coding_bridge_responses r
                 WHERE r.command_id=c.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1)
      AND NOT EXISTS(SELECT 1 FROM ai_platform.ai_coding_bridge_responses terminal
        WHERE terminal.command_id=c.id AND terminal.kind IN ('FAILED','COMPLETED'))
      AND clock_timestamp()<${p.expiresAt}::timestamptz
    RETURNING id
     `);
   });
   const id=result.rows?.[0]?.["id"];
   if(typeof id!=="string")return deny("DATABASE_EVIDENCE_CHANGED_OR_DENIED");
   return {recorded:true,reason:"SIGNED_REVIEW_INTENT_AUDITED_NOT_A_GRANT",recordId:id,
     mayIssueGrant:false,mayDispatchWorker:false};
 }catch{return deny("AUDIT_PERSISTENCE_FAILED")}
}
