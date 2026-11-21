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

export const ONE_JOB_OWNER_STAGE_INTENT="APPROVE_ONE_NEW_CST_DEV_MODEL_JOB";
const FRESH_SECONDS=20*60;

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
 if(Object.keys(body).length!==1||
    body.intent!==ONE_JOB_OWNER_STAGE_INTENT)return false;
 try {
  const claims=jwt.verify(i.sessionToken,i.sessionSecret,{
   algorithms:["HS256"],maxAge:"20m",clockTimestamp:now
  });
  if(!claims||typeof claims!=="object"||Array.isArray(claims))return false;
  const fields=Object.keys(claims).sort();
  if(fields.join(",")!=="exp,iat,sub")return false;
  return typeof claims.sub==="number"&&claims.sub===i.ownerUserId &&
    typeof claims.iat==="number"&&claims.iat<=now &&
    now-claims.iat<=FRESH_SECONDS &&
    typeof claims.exp==="number"&&claims.exp>now;
 }catch{return false;}
}
