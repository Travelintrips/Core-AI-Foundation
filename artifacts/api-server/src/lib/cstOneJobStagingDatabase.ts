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
import {PostgresPool,createPinnedCstOneJobPgConnection} from "@workspace/db";
import {
  CST_ONEJOB_STAGE_LOGIN,
  resolveCstOneJobStageDatabaseCredential,
  reviewCstOneJobStageDatabaseConfig,
} from "./cstOneJobStageDbConfig.js";

let holder:{
  urlDigest:string;
  database:ReturnType<typeof drizzle>;
} | null=null;

export function getCstOneJobStagingDatabase(env:NodeJS.ProcessEnv) {
  const review=reviewCstOneJobStageDatabaseConfig(env);
  if(!review.readyForDedicatedConnection)
    throw Error("ONEJOB_STAGING_DATABASE_UNAVAILABLE:"+review.blockers.join(","));
  // The existing systemd credential is delivered privately as
  // CREDENTIALS_DIRECTORY/database-url. Never log or expose the string.
  const resolved=resolveCstOneJobStageDatabaseCredential(env);
  if(resolved.blocker||!resolved.value)
    throw Error("ONEJOB_STAGING_DATABASE_PROTECTED_CREDENTIAL_UNAVAILABLE");
  const url=resolved.value;
  const urlDigest=createHash("sha256").update(url).digest("hex");
  if(holder){
    if(holder.urlDigest!==urlDigest)
      throw Error("ONEJOB_STAGING_DATABASE_CREDENTIAL_CHANGED_RESTART_REQUIRED");
    return holder.database;
  }
  // Keep the validated URL out of node-postgres: its sslmode query option
  // overrides an explicit ssl.ca. A missing or mismatched pinned CA fails
  // closed before any network connection.
  const pinned=createPinnedCstOneJobPgConnection(url,CST_ONEJOB_STAGE_LOGIN);
  const pool=new PostgresPool({
    ...pinned,
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
