import { createHmac, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { aiCodingGithubDeliveriesTable, db } from "@workspace/db";
import { publish } from "./aiEventBusService.js";
import { upsertIncident } from "./incidentAutoRepairService.js";
export function verifyGithubWebhookSignature(rawBody:Buffer,signature:string|undefined,secret:string){if(!signature?.startsWith("sha256=")||!secret)return false;const expected="sha256="+createHmac("sha256",secret).update(rawBody).digest("hex");const a=Buffer.from(signature);const b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
function normalized(payload:any,eventName:string){const repository=payload?.repository?.full_name;const headSha=payload?.check_run?.head_sha??payload?.workflow_run?.head_sha??payload?.pull_request?.head?.sha??null;const conclusion=payload?.check_run?.conclusion??payload?.workflow_run?.conclusion??null;const status=payload?.check_run?.status??payload?.workflow_run?.status??payload?.action??null;return{repository,headSha,conclusion,status,eventName};}
export async function ingestGithubCodingEvent(input:{deliveryId:string;eventName:string;payload:any}){
 const n=normalized(input.payload,input.eventName);if(!n.repository)throw new Error("GitHub payload missing repository.full_name");
 const [old]=await db.select().from(aiCodingGithubDeliveriesTable).where(eq(aiCodingGithubDeliveriesTable.deliveryId,input.deliveryId)).limit(1);if(old)return{delivery:old,duplicate:true};
 const supported=["check_run","workflow_run","pull_request"].includes(input.eventName);
 const [row]=await db.insert(aiCodingGithubDeliveriesTable).values({deliveryId:input.deliveryId,eventName:input.eventName,repository:n.repository,headSha:n.headSha,payloadJson:input.payload,status:supported?"RECEIVED":"IGNORED",processedAt:supported?null:new Date()}).returning();if(!row)throw new Error("Failed to persist GitHub delivery");
 if(!supported)return{delivery:row,duplicate:false,ignored:true};
 const event=await publish({eventType:"coding.github."+input.eventName,sourceModule:"github-webhook",sourceId:row.id,correlationId:input.deliveryId,payload:{deliveryId:input.deliveryId,repository:n.repository,headSha:n.headSha,conclusion:n.conclusion,status:n.status,action:input.payload?.action??null,pullRequestNumber:input.payload?.pull_request?.number??input.payload?.workflow_run?.pull_requests?.[0]?.number??null}});
 if(n.conclusion&&n.conclusion!=="success"&&["failure","timed_out","cancelled","action_required","startup_failure"].includes(String(n.conclusion))){
   await upsertIncident({
     source:"github",
     kind:"workflow_failed",
     title:"GitHub CI/workflow failed",
     summary:`${input.eventName} concluded with ${String(n.conclusion)} for ${n.repository} @ ${n.headSha??"unknown"}`,
     severity:"critical",
     riskClass:"GUARDED",
     repository:n.repository,
     branch:input.payload?.workflow_run?.head_branch??input.payload?.pull_request?.head?.ref??"main",
     headSha:n.headSha,
     fingerprint:`github:${n.repository}:${n.headSha??input.deliveryId}:${input.eventName}:${String(n.conclusion)}`,
     metadata:{deliveryId:input.deliveryId,eventName:input.eventName,conclusion:n.conclusion,status:n.status},
   });
 }
 const [updated]=await db.update(aiCodingGithubDeliveriesTable).set({status:"PUBLISHED",processedAt:new Date()}).where(eq(aiCodingGithubDeliveriesTable.id,row.id)).returning();
 return{delivery:updated??row,event,duplicate:false};
}
