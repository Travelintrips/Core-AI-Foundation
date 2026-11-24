/**
 * Dedicated owner-session reader for isolated WAITING-only DEV staging.
 *
 * The existing Core AI internal_session cookie and SESSION_SECRET are reused,
 * but no shared Core DB pool or broad aicore_dev_runtime role is needed.
 * The full authenticated Owner role/status/password-change state is re-read
 * from the dedicated stage LOGIN via READ ONLY + SET LOCAL limited writer.
 * No auth via reverse-proxy header, caller-provided user ID, API key,
 * test credential or claimed browser role.
 */
import type {Request,Response,NextFunction} from "express";
import jwt from "jsonwebtoken";
import {sql} from "drizzle-orm";
import type {InternalUser} from "@workspace/db";
import {SESSION_COOKIE_NAME} from "../services/internalAuthService.js";
import {getCstOneJobStagingDatabase} from "../lib/cstOneJobStagingDatabase.js";
import {CST_ONEJOB_STAGE_LOGIN} from "../lib/cstOneJobStageDbConfig.js";
import {cstOneJobStageSessionId} from "../lib/cstOneJobStageSessionClaims.js";

export async function requireCstOneJobStageOwner(
 req:Request,res:Response,next:NextFunction
):Promise<void>{
 res.setHeader("Cache-Control","no-store");
 const env=process.env;
 // Anonymous users must be rejected before any DB or feature-flag check.
 const cookie=(req.cookies as Record<string,unknown>|undefined)?.[SESSION_COOKIE_NAME];
 if(typeof cookie!=="string"||cookie.length<32){
  res.status(401).json({error:"OWNER_SESSION_REQUIRED"});return;
 }
 const secret=env.SESSION_SECRET;
 if(typeof secret!=="string"||secret.length<32){
  res.status(503).json({error:"OWNER_SESSION_ISSUER_UNAVAILABLE"});return;
 }
 let ownerUserId:number|null=null;
 try{
  // Existing Core JWT issued in the original app, NOT reissued here.
  const claims=jwt.verify(cookie,secret,{
   algorithms:["HS256"],maxAge:"12h"
  });
  ownerUserId=cstOneJobStageSessionId(
   claims,Math.floor(Date.now()/1000)
  );
 }catch{
  res.status(401).json({error:"OWNER_SESSION_INVALID"});return;
 }
 if(ownerUserId===null){
  res.status(401).json({error:"OWNER_SESSION_INVALID"});return;
 }
 // Fail closed on the active Core shared runtime and in PROD. No Owner DB
 // access is attempted until the exact isolated stage feature is enabled.
 if(env.APP_ENV!=="development"||env.NODE_ENV!=="development"||
  env.CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED!=="true"||
  env.AI_DISPATCHER_ENABLED!=="false"||
  env.OLLAMA_WORKER_RUNTIME_ENABLED!=="false"||
  env.SUPABASE_PROD_DATABASE_URL){
  res.status(503).json({error:"CST_DEV_ONEJOB_STAGE_DISABLED"});
  return;
 }
 let row:Record<string,unknown>|null=null;
 try{
  const stage=getCstOneJobStagingDatabase(env);
  row=await stage.transaction(async tx=>{
   await tx.execute(sql`SET TRANSACTION READ ONLY`);
   await tx.execute(sql`SET LOCAL ROLE cst_team_model_pilot_writer`);
   const checked=await tx.execute(sql`
      SELECT current_user AS writer,session_user AS login,
       current_database() AS database_name`);
   const identity=checked.rows[0] as Record<string,unknown>|undefined;
   if(checked.rows.length!==1||
    identity?.writer!=="cst_team_model_pilot_writer"||
    identity?.login!==CST_ONEJOB_STAGE_LOGIN||
    identity?.database_name!=="postgres")
    throw Error("CST_DEV_AUTH_ROLE_SCOPE_INVALID");
   const owners=await tx.execute(sql`
    SELECT id,role,status,account_type,must_change_password
    FROM ai_platform.internal_users
    WHERE id=${ownerUserId} AND role='owner'
      AND status='active' AND account_type='internal'
    LIMIT 2`);
   if(owners.rows.length!==1)return null;
   return owners.rows[0] as Record<string,unknown>;
  });
 }catch{
  // No DSN, SQL, JWT payload, email or user ID in response.
  res.status(503).json({error:"CST_DEV_OWNER_READER_UNAVAILABLE"});return;
 }
 if(!row || Number(row.id)!==ownerUserId ||
  row.role!=="owner"||row.status!=="active"||
  row.account_type!=="internal"||row.must_change_password!==false){
  res.status(403).json({error:"ACTIVE_OWNER_PASSWORD_RESET_REQUIRED"});
  return;
 }
 // Compatibility with the three original stage handlers only.
 // NO other normal Core AI route uses this intentionally narrow principal.
 req.internalUser={
  id:ownerUserId,role:"owner",status:"active",
  accountType:"internal",mustChangePassword:false
 } as unknown as InternalUser;
 next();
}
