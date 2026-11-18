/** CST-DEV ONLY: read-only reconciliation of one existing model job.
 * Usage: pnpm --filter @workspace/api-server exec tsx
 *        src/scripts/cstTeamCompletionEvidenceAudit.ts 482
 *
 * BEGIN READ ONLY, bound parameters, no role elevation, INSERT, replay,
 * event backfill or subscriber dispatch. NEVER prints database secrets.
 */
import { pool } from "@workspace/db";
import {
  projectCstModelCompletionEvidence,
  type CompletionJobRow,
  type CompletionJobAuditRow,
  type CompletionWorkerRow,
  type CompletionEventRow,
  type CompletionEventAuditRow,
} from "../lib/cstTeamCompletionEvidenceProjection.js";

async function run() {
  const jobId = Number(process.argv[2]);
  const devDsn = process.env["SUPABASE_DATABASE_URL_DEV"] ?? "";
  if (!Number.isSafeInteger(jobId) || jobId < 1 ||
      process.env.APP_ENV !== "development" ||
      process.env.NODE_ENV !== "development" ||
      !devDsn.includes("xssrfshdrtdfupgqwfdw") ||
      Boolean(process.env["SUPABASE_PROD_DATABASE_URL"])) {
    throw Error("CST_DEV_EVIDENCE_AUDIT_SCOPE_DENIED");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const scope = await client.query<{ runtime_role: string; event_select: boolean; audit_select: boolean }>(`
      SELECT current_user AS runtime_role,
        has_table_privilege(current_user,'ai_platform.ai_events','SELECT') AS event_select,
        has_table_privilege(current_user,'ai_platform.ai_audit_logs','SELECT') AS audit_select
    `);
    const auth = scope.rows[0];
    if (!auth || auth.runtime_role !== "aicore_dev_runtime" ||
        !auth.event_select || !auth.audit_select) {
      throw Error("CST_DEV_EVIDENCE_READER_NOT_AUTHORIZED");
    }
    const { rows: jobs } = await client.query<CompletionJobRow>(`
      SELECT id,job_code,status,job_type,
        payload_json->>'requestId' AS request_id,
        payload_json->>'modelId' AS model_id,
        result_json IS NOT NULL AS has_result
      FROM ai_platform.ai_jobs WHERE id=$1
    `,[jobId]);
    const { rows: jobAudits } = await client.query<CompletionJobAuditRow>(`
      SELECT resource_id,details->>'workerId' AS worker_id
      FROM ai_platform.ai_audit_logs
      WHERE module='job-engine' AND action='job_completed'
        AND resource_type='ai_job' AND resource_id=$1
      ORDER BY id LIMIT 10
    `,[String(jobId)]);
    const workerId = Number(jobAudits.length===1 ? jobAudits[0].worker_id : "");
    const { rows: workers } = Number.isSafeInteger(workerId) && workerId > 0
      ? await client.query<CompletionWorkerRow>(`
          SELECT id,worker_name,provider_slug,runtime_kind,model_id
          FROM ai_platform.ai_workers WHERE id=$1
        `,[workerId]) : {rows:[] as CompletionWorkerRow[]};
    const { rows: events } = await client.query<CompletionEventRow>(`
      SELECT event_id,event_type,source_module,source_id,status,correlation_id,
        payload_json->>'jobId' AS payload_job_id,
        payload_json->>'workerId' AS payload_worker_id,
        payload_json->>'jobCode' AS payload_job_code,
        payload_json->>'jobType' AS payload_job_type
      FROM ai_platform.ai_events
      WHERE event_type='job.completed'
        AND source_module='job-engine' AND source_id=$1
      ORDER BY id LIMIT 10
    `,[String(jobId)]);
    const eventIds=events.map(e=>e.event_id);
    const { rows: eventAudits } = eventIds.length
      ? await client.query<CompletionEventAuditRow>(`
          SELECT resource_id,
            details->>'correlationId' AS correlation_id,
            details->>'eventType' AS event_type,
            details->>'sourceModule' AS source_module
          FROM ai_platform.ai_audit_logs
          WHERE module='event-bus' AND action='event_published'
            AND resource_type='ai_event'
            AND resource_id=ANY($1::text[])
          ORDER BY id LIMIT 10
        `,[eventIds]) : {rows:[] as CompletionEventAuditRow[]};
    const result = projectCstModelCompletionEvidence({
      requestedJobId:jobId,
      job:jobs[0]??null,jobAudits,worker:workers[0]??null,
      events,eventAudits,
    });
    console.log(JSON.stringify({
      project:"CST_DEV",checkedAt:new Date().toISOString(),
      readOnlyTransaction:true,runtimeRole:auth.runtime_role,
      sourceJobCount:jobs.length,jobAuditCount:jobAudits.length,
      eventCount:events.length,eventAuditCount:eventAudits.length,
      ...result,
    }));
    // A read-only audit can execute successfully while its evidence is still
    // blocked by RLS or missing. Never export shell exit 0 in that case:
    // CI/agents must not convert "audit ran" into "operational PASS".
    if (result.status !== "event_and_audit_persisted") process.exitCode = 4;
  } finally {
    await client.query("ROLLBACK").catch(()=>{});
    client.release();
  }
}
run().catch((e:unknown)=>{
  const safeName = e instanceof Error &&
    (e.message.startsWith("CST_DEV_") ? e.message : "")
      ? (e as Error).message : "CST_DEV_EVIDENCE_READ_UNAVAILABLE";
  console.log(JSON.stringify({mode:"CST_DEV_READ_ONLY_PERSISTENCE_NOT_DELIVERY",
    status:"unavailable",reason:safeName,finalAckVerified:false}));
  process.exitCode=2;
}).finally(async()=>{await pool.end()});
