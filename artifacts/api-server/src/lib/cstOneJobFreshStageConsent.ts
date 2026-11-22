/**
 * One explicit Super Admin business decision for the CST-DEV Company-1 pilot.
 * Existing Core internal_users uses the top-level role "owner" as the
 * Super Admin session mapping. Generic "admin" and "manager" are excluded.
 * Do not add a second human Security/Operations approval or bypass
 * signed technical QA/signer custody with a role name. This checks the app's existing
 * signed numeric-user JWT; it does not issue sessions, passwords, OTPs,
 * staging credentials, dispatch authority or Final ACK.
 *
 * The caller MUST separately requireAuth (fresh DB user readback), enforce
 * the exact DEV HTTPS same-origin and use the dedicated transactional writer.
 */
import jwt from "jsonwebtoken";
import {CST_ONEJOB_PUBLIC_OPERATIONS_CANDIDATE_SHA256} from
 "./cstOneJobOperationsRootCandidate.js";

export const ONE_JOB_OWNER_STAGE_INTENT="APPROVE_ONE_NEW_CST_DEV_MODEL_JOB";
// The click is the fresh business decision. Do not impose a separate 20-minute
// login-age window: a verified, unexpired 12-hour app session may approve once.
// This does not extend the session, signed stage permit or DB LOGIN lease.
const MAX_APP_SESSION_SECONDS=12*60*60;

type ConsentInput={
 sessionToken:unknown; sessionSecret:unknown;
 ownerUserId:unknown; role:unknown; status:unknown;
 accountType:unknown; mustChangePassword:unknown;
 body:unknown; nowSeconds?:number;
};
export function verifyFreshOneJobStageConsent(i:ConsentInput):boolean {
 const now=i.nowSeconds??Math.floor(Date.now()/1000);
 if(!Number.isSafeInteger(now)||now<=0 ||
    !Number.isSafeInteger(i.ownerUserId)||Number(i.ownerUserId)<=0 ||
    i.role!=="owner"||i.status!=="active"||
    i.accountType!=="internal"||i.mustChangePassword===true ||
    typeof i.sessionToken!=="string"||i.sessionToken.length<32 ||
    typeof i.sessionSecret!=="string"||i.sessionSecret.length<32 ||
    !i.body||typeof i.body!=="object"||Array.isArray(i.body))return false;
 const body=i.body as Record<string,unknown>;
 // The same Super Admin click binds exactly one publicly pinned
 // Operations candidate identity, not an arbitrary client-selected key.
 if(Object.keys(body).length!==2||
    body.intent!==ONE_JOB_OWNER_STAGE_INTENT||
    body.operationsRootFingerprint!==CST_ONEJOB_PUBLIC_OPERATIONS_CANDIDATE_SHA256)
   return false;
 try {
  const claims=jwt.verify(i.sessionToken,i.sessionSecret,{
   algorithms:["HS256"],clockTimestamp:now
  });
  if(!claims||typeof claims!=="object"||Array.isArray(claims))return false;
  const fields=Object.keys(claims).sort();
  if(fields.join(",")!=="exp,iat,sub")return false;
  return typeof claims.sub==="number"&&claims.sub===i.ownerUserId &&
    typeof claims.iat==="number"&&claims.iat<=now &&
    typeof claims.exp==="number"&&claims.exp>now &&
    claims.exp>claims.iat &&
    claims.exp-claims.iat<=MAX_APP_SESSION_SECONDS;
 }catch{return false;}
}
