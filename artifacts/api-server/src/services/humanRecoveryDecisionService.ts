/**
 * DEV Human Recovery recommendation. A human recommendation is NOT a command
 * resume grant, a signed checkpoint, a worker lease, or a dispatch request.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type HumanRecoveryChoice = "recommend_new_attempt" | "deny_new_attempt";

export function validateHumanRecoverySubject(subject: {
  sourceModule: unknown; status: unknown; assignedUser: unknown;
  payload: unknown; commandId: string; jobId: number; actor: string;
  sourceId?: unknown; requireSourceId?: boolean;
}) {
  const payload = subject.payload && typeof subject.payload === "object" &&
    !Array.isArray(subject.payload) ? subject.payload as Record<string, unknown> : {};
  if (subject.sourceModule !== "ai_core_lifecycle") return "NOT_LIFECYCLE_REVIEW";
  if (subject.status !== "accepted") return "REVIEW_NOT_ACCEPTED";
  if (String(subject.assignedUser ?? "").trim().toLowerCase() !== subject.actor.trim().toLowerCase())
    return "ASSIGNED_HUMAN_REVIEWER_REQUIRED";
  if (payload["commandId"] !== subject.commandId || String(payload["taskId"]) !== String(subject.jobId))
    return "RECOVERY_SUBJECT_MISMATCH";
  if (subject.requireSourceId === true || subject.sourceId !== undefined) {
    const executionId = payload["executionId"];
    if (typeof executionId !== "string" ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(executionId) ||
        subject.sourceId !== "execution:" + executionId)
      return "RECOVERY_EXECUTION_IDENTITY_MISMATCH";
  }
  if (payload["resumeAllowed"] !== false) return "RECOVERY_NOT_FAIL_CLOSED";
  return null;
}

export async function recordHumanRecoveryRecommendation(input: {
  humanTaskId: number; commandId: string; jobId: number;
  actor: string; decision: HumanRecoveryChoice; notes: string;
}) {
  return db.transaction(async tx => {
    const rows = await tx.execute(sql`
      SELECT id,source_module,source_id,status,assigned_user,payload_json
      FROM ai_platform.ai_human_tasks
      WHERE id=${input.humanTaskId} FOR UPDATE
    `);
    const review = rows.rows?.[0];
    if (!review) return { ok: false as const, error: "HUMAN_REVIEW_NOT_FOUND" };
    const error = validateHumanRecoverySubject({
      sourceModule: review["source_module"], sourceId:review["source_id"], status:review["status"],assignedUser:review["assigned_user"],
      payload:review["payload_json"],commandId:input.commandId,jobId:input.jobId,actor:input.actor,
    });
    if(error)return {ok:false as const,error};
    const evidence=await tx.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM ai_platform.ai_human_task_history h WHERE h.task_id=${input.humanTaskId}
          AND h.action='artifact_recovery_verified'
      ) AS evidence_ok,
      EXISTS(
        SELECT 1 FROM ai_platform.ai_coding_bridge_commands c
        WHERE c.id=${input.commandId}::uuid AND c.status='FAILED'
          AND c.metadata_json->>'devOnly'='true'
          AND c.metadata_json->>'capability'='chatgpt:wake'
      ) AS original_command_verified,
      EXISTS(
        SELECT 1 FROM ai_platform.ai_human_task_history h WHERE h.task_id=${input.humanTaskId}
          AND h.action='human_recovery_recommendation'
      ) AS prior_decision
    `);
    const proof=evidence.rows?.[0];
    if(proof?.["prior_decision"]===true)return {ok:false as const,error:"RECOVERY_RECOMMENDATION_ALREADY_RECORDED"};
    if(proof?.["evidence_ok"]!==true || proof?.["original_command_verified"]!==true)
      return {ok:false as const,error:"RECOVERY_EVIDENCE_NOT_VERIFIED"};
    const audit = JSON.stringify({
      decision:input.decision,commandId:input.commandId,jobId:input.jobId,
      notes:input.notes,dispatchAuthorized:false,resumeAllowed:false,checkpointIssued:false,
    });
    const saved=await tx.execute(sql`
      INSERT INTO ai_platform.ai_human_task_history
        (task_id,action,performed_by,notes,old_status,new_status)
      VALUES (${input.humanTaskId},'human_recovery_recommendation',${input.actor},
        ${audit},'accepted','accepted')
      RETURNING id,created_at
    `);
    return {ok:true as const,historyId:Number(saved.rows?.[0]?.["id"]),
      decision:input.decision,dispatchAuthorized:false as const,resumeAllowed:false as const};
  });
}
