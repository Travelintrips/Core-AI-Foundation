import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { excludeHealthyCstDevPilotFromAgeOnlyRecovery } from
  "../cstOneJobLiveWorkerRecoveryPredicate.js";

const dialect = new PgDialect();
function rendered(env:{APP_ENV?:string;NODE_ENV?:string;CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED?:string}){
  return dialect.sqlToQuery(sql`SELECT id FROM ai_platform.ai_jobs WHERE
    status = 'running' AND started_at < NOW() - interval '10 minutes'
    ${excludeHealthyCstDevPilotFromAgeOnlyRecovery(env)}`).sql;
}
describe("CST-DEV pilot is not failed by age alone",()=>{
  it("protects only a uniquely bound live model worker with fresh lease + heartbeat",()=>{
    const query = rendered({APP_ENV:"development",NODE_ENV:"development",
      CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED:"true"});
    for(const required of [
      "AND NOT (", "cst-ai-team-company1-dev:pilot-", "ollama_model_invocation",
      "w.current_job = ai_platform.ai_jobs.id",
      "w.lease_expires_at > NOW()",
      "w.last_heartbeat > NOW() - INTERVAL '60 seconds'",
      "w.status = 'busy'", "w.running_jobs > 0",
      "w.runtime_kind = 'ollama_remote_pull'",
      "w.model_id = 'qwen2.5:3b'"
    ]) expect(query).toContain(required);
    // started_at remains a candidate selector, not an unconditional failure:
    // if a live worker owns the pilot job it is excluded irrespective of age.
    expect(query).toContain("started_at < NOW() - interval '10 minutes'");
  });
  it("never shields PROD, nondevelopment, or an unverified deployment",()=>{
    for(const env of [
      {},{APP_ENV:"production",NODE_ENV:"production",
        CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED:"true"},
      {APP_ENV:"development",NODE_ENV:"development"},
      {APP_ENV:"development",NODE_ENV:"development",
        CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED:"false"},
      {APP_ENV:"development",NODE_ENV:"production",
        CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED:"true"},
      {APP_ENV:"production",NODE_ENV:"development",
        CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED:"true"}
    ]){
      expect(rendered(env)).not.toContain("cst-ai-team-company1-dev:pilot-");
    }
  });
  it("is applied to BOTH independently running age-recovery paths",()=>{
    const dispatcher=readFileSync(
      new URL("../../services/jobDispatcherService.ts",import.meta.url),"utf8");
    const remote=readFileSync(
      new URL("../../services/remoteOllamaWorkerService.ts",import.meta.url),"utf8");
    for(const source of [dispatcher,remote])
      expect(source).toContain("excludeHealthyCstDevPilotFromAgeOnlyRecovery(process.env)");
  });
});
