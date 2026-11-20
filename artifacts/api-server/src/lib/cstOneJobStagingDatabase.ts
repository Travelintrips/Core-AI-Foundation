/**
 * One-connection DEV staging pool, isolated from the normal Core AI DB pool.
 *
 * A separate unprivileged LOGIN can assume only the NOLOGIN writer for the
 * duration of an authenticated Owner staging transaction. This module does
 * not provision credentials or roles and never falls back to @workspace/db.db.
 * It creates no network connection unless the Owner stage endpoint is called
 * with all the existing feature/environment gates satisfied.
 */
import {createHash} from "node:crypto";
import {drizzle} from "drizzle-orm/node-postgres";
import {PostgresPool} from "@workspace/db";
import {
  CST_ONEJOB_STAGE_URL_KEY,reviewCstOneJobStageDatabaseConfig,
} from "./cstOneJobStageDbConfig.js";

let holder:{
  urlDigest:string;
  database:ReturnType<typeof drizzle>;
} | null=null;

export function getCstOneJobStagingDatabase(env:NodeJS.ProcessEnv) {
  const review=reviewCstOneJobStageDatabaseConfig(env);
  if(!review.readyForDedicatedConnection)
    throw Error("ONEJOB_STAGING_DATABASE_UNAVAILABLE:"+review.blockers.join(","));
  const url=env[CST_ONEJOB_STAGE_URL_KEY]!;
  const urlDigest=createHash("sha256").update(url).digest("hex");
  if(holder){
    if(holder.urlDigest!==urlDigest)
      throw Error("ONEJOB_STAGING_DATABASE_CREDENTIAL_CHANGED_RESTART_REQUIRED");
    return holder.database;
  }
  // sslmode=verify-full is REQUIRED in the already validated connection URL.
  // No search_path startup option: the Supabase transaction pooler rejects it.
  // Staging sets TRANSACTION READ WRITE explicitly after BEGIN, avoiding any
  // driver-specific, unsupported connection 'verify' callback.
  const pool=new PostgresPool({
    connectionString:url,
    max:1,
    min:0,
    idleTimeoutMillis:5_000,
    connectionTimeoutMillis:3_500,
    application_name:"cst-dev-onejob-staging-only",
  });
  const database=drizzle(pool);
  holder={urlDigest,database};
  return database;
}
