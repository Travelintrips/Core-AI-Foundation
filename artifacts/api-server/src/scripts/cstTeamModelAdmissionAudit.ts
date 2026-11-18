/** Run via: pnpm --filter @workspace/api-server exec tsx src/scripts/cstTeamModelAdmissionAudit.ts
 * Reads only PostgreSQL catalogs and current grants. NEVER writes, grants,
 * creates roles, creates policies, or enrolls a worker. No secret output.
 */
import { pool } from "@workspace/db";
import {
  projectCstModelAdmissionReadiness,
  type CstModelAdmissionChecks,
} from "../lib/cstTeamModelAdmission.js";

type RoleRow = {
  runtime_role: string;
  jobs_rls_enabled: boolean;
  workers_rls_enabled: boolean;
  jobs_select: boolean; jobs_insert: boolean;
  jobs_missing_update_columns: string[];
  workers_select: boolean; workers_insert: boolean; workers_update: boolean;
};
type PolicyRow = {
  tablename: string; cmd: string; roles: string[];
  qual: string | null; with_check: string | null;
};
async function audit() {
  const devUrl = process.env["SUPABASE_DATABASE_URL_DEV"] ?? "";
  const validDev = process.env["APP_ENV"] === "development" &&
    process.env["NODE_ENV"] === "development" &&
    devUrl.includes("xssrfshdrtdfupgqwfdw") &&
    !process.env["SUPABASE_PROD_DATABASE_URL"];
  if (!validDev) {
    console.log(JSON.stringify(projectCstModelAdmissionReadiness({})));
    return;
  }
  const { rows: roleRows } = await pool.query<RoleRow>(`
    SELECT current_user AS runtime_role,
      (SELECT relrowsecurity FROM pg_class
        WHERE oid = 'ai_platform.ai_jobs'::regclass) AS jobs_rls_enabled,
      (SELECT relrowsecurity FROM pg_class
        WHERE oid = 'ai_platform.ai_workers'::regclass) AS workers_rls_enabled,
      has_table_privilege(current_user,'ai_platform.ai_jobs','SELECT') AS jobs_select,
      has_table_privilege(current_user,'ai_platform.ai_jobs','INSERT') AS jobs_insert,
      ARRAY(
        SELECT column_name FROM unnest(ARRAY[
          'status','started_at','payload_json','updated_at','result_json',
          'completed_at','actual_duration','actual_cost','error_message',
          'retry_count','next_retry_at'
        ]) AS column_name
        WHERE NOT has_column_privilege(
          current_user,'ai_platform.ai_jobs',column_name,'UPDATE'
        )
      ) AS jobs_missing_update_columns,
      has_table_privilege(current_user,'ai_platform.ai_workers','SELECT') AS workers_select,
      has_table_privilege(current_user,'ai_platform.ai_workers','INSERT') AS workers_insert,
      has_table_privilege(current_user,'ai_platform.ai_workers','UPDATE') AS workers_update
  `);
  const r = roleRows[0];
  if (!r) throw Error("MODEL_PREFLIGHT_ROLE_UNAVAILABLE");
  const { rows: policies } = await pool.query<PolicyRow>(`
    SELECT tablename, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname='ai_platform' AND tablename IN ('ai_jobs','ai_workers')
  `);
  const applies=(x:PolicyRow) => x.roles.includes(r.runtime_role) || x.roles.includes("public");
  const eligible = policies.filter(applies);
  const has=(table:string, cmd:string, matcher:(row:PolicyRow)=>boolean) =>
    eligible.some(row=>row.tablename===table && (row.cmd===cmd || row.cmd==="ALL") && matcher(row));
  const hasModel=(value:string|null) => Boolean(value &&
    value.includes("'ollama_model_invocation'") &&
    value.includes("cst-ai-team-company1-dev:"));
  const hasRemote=(value:string|null) => Boolean(value &&
    value.includes("'ollama_remote_pull'") &&
    value.includes("cst-dev-dell-onejob"));
  const checks: CstModelAdmissionChecks={
    DEV_RUNTIME_AND_PROJECT_VERIFIED:true,
    APP_ROLE_EXPECTED:r.runtime_role==="aicore_dev_runtime",
    JOBS_RLS_ENABLED:r.jobs_rls_enabled===true,
    WORKERS_RLS_ENABLED:r.workers_rls_enabled===true,
    JOBS_SELECT_GRANT:r.jobs_select===true,
    JOBS_INSERT_GRANT:r.jobs_insert===true,
    JOBS_REQUIRED_UPDATE_COLUMNS:Array.isArray(r.jobs_missing_update_columns) &&
      r.jobs_missing_update_columns.length===0,
    WORKERS_SELECT_GRANT:r.workers_select===true,
    WORKERS_INSERT_GRANT:r.workers_insert===true,
    WORKERS_UPDATE_GRANT:r.workers_update===true,
    JOBS_MODEL_SELECT_RLS:has("ai_jobs","SELECT",row=>hasModel(row.qual)),
    JOBS_MODEL_INSERT_RLS:has("ai_jobs","INSERT",row=>hasModel(row.with_check)),
    JOBS_MODEL_UPDATE_RLS:has("ai_jobs","UPDATE",row=>hasModel(row.qual)&&hasModel(row.with_check)),
    WORKERS_REMOTE_SELECT_RLS:has("ai_workers","SELECT",row=>Boolean(row.qual)),
    WORKERS_REMOTE_INSERT_RLS:has("ai_workers","INSERT",row=>hasRemote(row.with_check)),
    WORKERS_REMOTE_UPDATE_RLS:has("ai_workers","UPDATE",row=>hasRemote(row.qual)&&hasRemote(row.with_check)),
  };
  const report=projectCstModelAdmissionReadiness(checks);
  console.log(JSON.stringify({project:"CST_DEV",role:r.runtime_role,readOnly:true,
    missingJobUpdateColumns:r.jobs_missing_update_columns,...report}));
}
try {
  await audit();
} catch (e) {
  console.log(JSON.stringify({ status:"unavailable", mode:"CST_DEV_READ_ONLY_RLS_PREFLIGHT_NOT_AUTHORIZATION",
    verifiedOperationalWorker:false, eligibleToDispatch:false,
    reason:e instanceof Error ? e.name : "UNKNOWN" }));
  process.exitCode=2;
} finally {
  await pool.end();
}
