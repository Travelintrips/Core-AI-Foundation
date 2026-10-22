import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { codingBridgeCommandSchema } from "./coding-bridge-command-schema.js";
import { acknowledgeCodingBridgeResponse, appendCodingBridgeResponse, getCodingBridgeAvailability, listPendingCodingBridgeResponses, listPendingCodingBridgeResponsesForConversation, renewCodingBridgePresence, subscribeCodingBridgeConversation, submitCodingBridgeCommand, unsubscribeCodingBridgeConversation } from "../services/localCodingControlBridgeService.js";
import {
  getCodingWhatsappConfigStatus,
} from "../services/codingWhatsappNotificationService.js";
import {
  decideCodingCriticalApprovalById,
  getCriticalApproval,
  requestCodingCriticalApproval,
} from "../services/codingCriticalApprovalService.js";
import {
  disableAutonomousCodingTask,
  enableAutonomousCodingTask,
  getAutonomousCodingTaskStatus,
  getAutonomousRuntimeStatus,
  recoverAutonomousCodingRuntimeIfDatabaseReady,
  runAutonomousCodingCycle,
} from "../services/localCodingAutonomousRepairService.js";
import { getAiTaskBridgeTimeline, getAiTaskChatGptBridgeTimeline } from "../services/localCodingControlBridgeService.js";
import {
  dispatchExternalAgentWork,
  ExternalAgentDispatchError,
  OPENCLAW_AGENT_CLIENT_ID,
} from "../services/externalAgentDispatchService.js";
import { queueDevBrowserWake, resolveVerifiedDevWakeTarget } from "../services/devChatGptWakeService.js";
const router=Router(); const Uuid=z.string().uuid();

async function resolveAiTaskGptOwnerChannel(): Promise<string | undefined> {
  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT value FROM ai_platform.ai_settings
      WHERE is_secret IS FALSE
        AND category = 'guardrail'
        AND key = 'dev.chatgpt_wake.owner_channel'
      LIMIT 1
    `);
    const value = result.rows?.[0]?.["value"];
    return typeof value === "string" && /^ai-engine-oauth:[a-f0-9]{64}$/.test(value.trim())
      ? value.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
router.get("/ai/coding/bridge/ai-task-timeline",async(req,res):Promise<void>=>{
 const externalCommandId=String(req.query["externalCommandId"]??"");
 if(!/^ai-task:[a-zA-Z0-9_-]{1,100}:[1-9][0-9]*$/.test(externalCommandId)){res.status(400).json({error:"INVALID_EXTERNAL_COMMAND_ID"});return;}
 const timeline=await getAiTaskBridgeTimeline(externalCommandId);
 if(!timeline){res.status(404).json({error:"COMMAND_NOT_FOUND"});return;}
 res.json(timeline);
});
/**
 * DEV-only HTTP handshake entry point. Uses the durable coding bridge and
 * OpenClaw worker queue directly; no MCP tool, OAuth pairing, or browser claim.
 * Protected by the app's adminAuthWithExceptions middleware.
 */
router.post("/ai/coding/bridge/sop-handshake-test",async(req,res):Promise<void>=>{
 const host=req.hostname.toLowerCase();
 if(host!=="dev.cstlogistic.co.id"){
  res.status(403).json({error:"DEV_ONLY_HANDSHAKE_TEST"});return;
 }
 const parsed=z.object({
  correlationId:z.string().uuid(),
  instruction:z.literal("HANDSHAKE_CONTINUE"),
  jobId:z.string().trim().min(1).max(160),
  nextStep:z.string().trim().min(1).max(4000),
 }).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_HANDSHAKE_REQUEST"});return;}
 const externalCommandId="handshake-continue:"+parsed.data.correlationId;
 try{
  const result=await submitCodingBridgeCommand({
   externalCommandId,
   instruction:"HANDSHAKE_CONTINUE jobId="+parsed.data.jobId+" correlationId="+parsed.data.correlationId+"; NEXT_STEP: "+parsed.data.nextStep+"; SOP Resource-First, Human-Last: Do not stop after one failed command. Diagnose root cause. Use all authorized recovery paths. Coordinate with AI Core and OpenClaw on authorized PCs/VPS. Do not repeat identical commands without a technical reason. Retest after each fix. Never claim PASS without verification evidence. Preserve job identity and action log for resumption. Report completion or critical blockers. Return actual results and evidence through the existing authenticated HTTP bridge.",
   source:"handshake-http",
   commandType:"HANDSHAKE_CONTINUE",
   assignedClientId:OPENCLAW_AGENT_CLIENT_ID,
   metadata:{correlationId:parsed.data.correlationId,jobId:parsed.data.jobId,environment:"DEV",transport:"HTTP"},
  });
  res.status(result.created?202:200).json({
   commandId:result.command.id,
   externalCommandId,
   jobId:parsed.data.jobId,
   correlationId:parsed.data.correlationId,
   status:result.created?"QUEUED":"ALREADY_QUEUED",
   transport:"HTTP",
   workerDispatched:false,
   callbackVerified:false,
   e2eVerified:false,
   verificationStatus:"UNKNOWN_UNVERIFIED",
  });
 }catch{
  res.status(503).json({error:"HANDSHAKE_QUEUE_UNAVAILABLE",correlationId:parsed.data.correlationId,e2eVerified:false});
 }
});
router.post("/ai/coding/bridge/commands",async(req,res):Promise<void>=>{
 const p=codingBridgeCommandSchema.safeParse(req.body);
 if(!p.success){res.status(400).json({error:"INVALID_BRIDGE_COMMAND",details:p.error.flatten()});return;}
 try {
  const x=await submitCodingBridgeCommand(p.data);
  res.status(x.created?201:200).json(x);
 } catch(error) {
  const requestId=String(req.headers["x-request-id"]??res.getHeader("X-Request-Id")??"unknown");
  console.error("[coding-bridge] command submission failed",{
   requestId,
   source:p.data.source??"chatgpt",
   externalCommandId:p.data.externalCommandId,
   error:error instanceof Error?error.message:String(error),
  });
  const stage = error instanceof Error && "bridgeStage" in error && typeof error.bridgeStage === "string" ? error.bridgeStage : "UNKNOWN_STAGE";
  res.status(500).json({error:"BRIDGE_COMMAND_SUBMISSION_FAILED",stage,requestId});
 }
});

router.post("/ai/coding/bridge/ai-task-chatgpt-dispatch",async(req,res):Promise<void>=>{
 const p=z.object({
  accountAlias:z.string().regex(/^GPT[0-9]{2,4}$/),
  instruction:z.string().trim().min(1).max(2000),
  jobAlias:z.string().trim().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  correlationId:z.string().regex(/^ai-task:[A-Za-z0-9_-]{1,100}:[1-9][0-9]*:[A-Za-z0-9_-]{8,80}$/)
 }).strict().safeParse(req.body);
 if(!p.success){res.status(400).json({error:p.error.message});return;}
 try{
  const expectedOwnerChannel=p.data.accountAlias==="GPT01"
   ? await resolveAiTaskGptOwnerChannel()
   : undefined;
  const target=await resolveVerifiedDevWakeTarget(
   p.data.accountAlias,
   req.hostname,
   expectedOwnerChannel,
  );
  const eventId=randomBytes(32).toString("hex");
  const queued=await queueDevBrowserWake({
   ownerChannel:target.ownerChannel,
   targetConversationId:target.targetConversationId,
   eventId,
   correlationId:p.data.correlationId,
   instruction:p.data.instruction,
   jobAlias:p.data.jobAlias??null,
   requestHost:req.hostname,
   expectedWorkerId:target.workerId,
   ...(target.wakeBinding?{expectedBindingFingerprint:target.wakeBinding.bindingFingerprint}:{})
  });
  res.status(queued.created?202:200).json({
   created:queued.created,
   commandId:queued.commandId,
   clientId:queued.clientId,
   eventId,
   correlationId:p.data.correlationId,
   accountAlias:p.data.accountAlias,
   status:queued.created?"QUEUED":"ALREADY_QUEUED"
  });
 }catch(error){
  const code=error instanceof Error?error.message:"DEV_CHATGPT_WAKE_UNAVAILABLE";
  res.status(code.includes("UNVERIFIED")||code.includes("DENIED")||code.includes("MISMATCH")?403:503).json({
   error:code,
   executed:false
  });
 }
});
router.get("/ai/coding/bridge/ai-task-chatgpt-timeline",async(req,res):Promise<void>=>{
 const commandId=String(req.query["commandId"]??"");
 const correlationId=String(req.query["correlationId"]??"");
 if(!Uuid.safeParse(commandId).success||
    !/^ai-task:[A-Za-z0-9_-]{1,100}:[1-9][0-9]*:[A-Za-z0-9_-]{8,80}$/.test(correlationId)){
  res.status(400).json({error:"INVALID_CHATGPT_TIMELINE_KEY"});return;
 }
 const timeline=await getAiTaskChatGptBridgeTimeline(commandId,correlationId);
 if(!timeline){res.status(404).json({error:"COMMAND_NOT_FOUND"});return;}
 res.json(timeline);
});
router.post("/ai/coding/bridge/ai-task-dispatch",async(req,res):Promise<void>=>{
 const p=z.object({
  externalCommandId:z.string().regex(/^ai-task:[a-zA-Z0-9_-]{1,100}:[1-9][0-9]*$/),
  instruction:z.string().trim().min(1).max(50000),
  preferredClientId:z.string().trim().min(1).max(200).optional(),
  metadata:z.record(z.string(),z.unknown()).optional()
 }).strict().safeParse(req.body);
 if(!p.success){res.status(400).json({error:p.error.message});return;}
 try{
  const x=await dispatchExternalAgentWork({
   clientId:p.data.preferredClientId??OPENCLAW_AGENT_CLIENT_ID,
   instruction:p.data.instruction,
   source:"ai-task-hub",
   externalCommandId:p.data.externalCommandId,
   metadata:{
    ...(p.data.metadata??{}),
    origin:"ai-task-hub",
    environment:"development",
    productionAllowed:false
   }
  });
  res.status(x.created?201:200).json({created:x.created,clientId:x.clientId,command:x.command});
 }catch(error){
  if(error instanceof ExternalAgentDispatchError){
   res.status(error.code==="AGENT_UNAVAILABLE"?503:403).json({
    error:error.code,
    message:error.message,
    executed:false
   });
   return;
  }
  throw error;
 }
});
router.get("/ai/coding/bridge/responses",async(req,res):Promise<void>=>{const p=z.coerce.number().int().min(1).max(100).optional().safeParse(req.query["limit"]);if(!p.success){res.status(400).json({error:p.error.message});return;}const responses=await listPendingCodingBridgeResponses(p.data??50);res.json({responses,total:responses.length});});
router.post("/ai/coding/bridge/responses/:id/ack",async(req,res):Promise<void>=>{const p=Uuid.safeParse(req.params["id"]);if(!p.success){res.status(400).json({error:p.error.message});return;}const x=await acknowledgeCodingBridgeResponse(p.data);if(!x){res.status(404).json({error:"Bridge response not found"});return;}res.json(x);});
router.post("/ai/coding/bridge/responses",async(req,res):Promise<void>=>{const p=z.object({commandId:Uuid,taskId:Uuid.nullish(),kind:z.enum(["ACK","PROGRESS","CHECKPOINT","BLOCKER","COMPLETED","FAILED"]),message:z.string().min(1).max(50000),checkpoint:z.record(z.string(),z.unknown()).optional(),metadata:z.record(z.string(),z.unknown()).optional()}).safeParse(req.body);if(!p.success){res.status(400).json({error:p.error.message});return;}res.status(201).json(await appendCodingBridgeResponse(p.data));});
router.post("/ai/coding/bridge/presence/:clientId/heartbeat",async(req,res):Promise<void>=>{const p=z.object({clientId:z.string().min(1).max(200),source:z.string().min(1).max(50).optional(),leaseSeconds:z.number().int().min(30).max(300).optional(),metadata:z.record(z.string(),z.unknown()).optional()}).safeParse({...req.body,clientId:req.params["clientId"]});if(!p.success){res.status(400).json({error:p.error.message});return;}res.json(await renewCodingBridgePresence(p.data));});
router.get("/ai/coding/bridge/presence/:clientId",async(req,res):Promise<void>=>{const clientId=req.params["clientId"];if(!clientId||clientId.length>200){res.status(400).json({error:"Invalid clientId"});return;}res.json(await getCodingBridgeAvailability(clientId));});


router.post("/ai/coding/bridge/subscriptions",async(req,res):Promise<void>=>{
 const p=z.object({
  conversationId:z.string().min(1).max(200),
  eventTypes:z.array(z.enum(["COMPLETED","FAILED","MERGED","DEPLOYED"])).min(1).max(4).optional(),
  leaseSeconds:z.number().int().min(30).max(300).optional()
 }).strict().safeParse(req.body??{});
 if(!p.success){res.status(400).json({error:p.error.message});return;}
 const subscription=await subscribeCodingBridgeConversation(p.data);
 res.status(201).json({subscription});
});
router.get("/ai/coding/bridge/subscriptions/:conversationId/events",async(req,res):Promise<void>=>{
 const conversationId=String(req.params["conversationId"]??"").trim();
 const limit=z.coerce.number().int().min(1).max(100).optional().safeParse(req.query["limit"]);
 if(!conversationId||conversationId.length>200){res.status(400).json({error:"Invalid conversationId"});return;}
 if(!limit.success){res.status(400).json({error:limit.error.message});return;}
 const events=await listPendingCodingBridgeResponsesForConversation({conversationId,limit:limit.data??50});
 res.json({conversationId,events,total:events.length});
});
router.delete("/ai/coding/bridge/subscriptions/:conversationId",async(req,res):Promise<void>=>{
 const conversationId=String(req.params["conversationId"]??"").trim();
 if(!conversationId||conversationId.length>200){res.status(400).json({error:"Invalid conversationId"});return;}
 const unsubscribed=await unsubscribeCodingBridgeConversation(conversationId);
 res.json({conversationId,unsubscribed});
});



router.post("/ai/coding/tasks/:id/autonomous/start",async(req,res):Promise<void>=>{
 const id=Uuid.safeParse(req.params["id"]);
 const body=z.object({maxCycles:z.number().int().min(5).max(100).optional()}).strict().safeParse(req.body??{});
 if(!id.success){res.status(400).json({error:"Invalid task id"});return;}
 if(!body.success){res.status(400).json({error:body.error.message});return;}
 await enableAutonomousCodingTask(id.data,body.data.maxCycles,{forceDisabled:true});
 const cycle=await runAutonomousCodingCycle(id.data);
 res.status(202).json({enabled:true,cycle});
});
router.post("/ai/coding/tasks/:id/autonomous/stop",async(req,res):Promise<void>=>{
 const id=Uuid.safeParse(req.params["id"]);
 if(!id.success){res.status(400).json({error:"Invalid task id"});return;}
 await disableAutonomousCodingTask(id.data);
 res.json({enabled:false,taskId:id.data});
});
router.post("/ai/coding/tasks/:id/autonomous/run-once",async(req,res):Promise<void>=>{
 const id=Uuid.safeParse(req.params["id"]);
 if(!id.success){res.status(400).json({error:"Invalid task id"});return;}
 const cycle=await runAutonomousCodingCycle(id.data);
 res.json(cycle);
});
router.get("/ai/coding/tasks/:id/autonomous",async(req,res):Promise<void>=>{
 const id=Uuid.safeParse(req.params["id"]);
 if(!id.success){res.status(400).json({error:"Invalid task id"});return;}
 const status=await getAutonomousCodingTaskStatus(id.data);
 if(!status){res.status(404).json({error:"Autonomous task state not found"});return;}
 res.json(status);
});

router.post("/ai/coding/bridge/critical-approvals",async(req,res):Promise<void>=>{
 const p=z.object({
  taskId:Uuid.nullish(),
  commandId:Uuid.nullish(),
  actionType:z.enum(["PRODUCTION_DB_MIGRATION","DESTRUCTIVE_DB_CHANGE","SECURITY_CHANGE"]),
  summary:z.string().min(1).max(4000),
  metadata:z.record(z.string(),z.unknown()).optional(),
  ttlMinutes:z.number().int().min(2).max(30).optional()
 }).strict().safeParse(req.body);
 if(!p.success){res.status(400).json({error:p.error.message});return;}
 const result=await requestCodingCriticalApproval(p.data);
 res.status(result.reused?200:201).json({
  approval:result.approval,
  reused:result.reused,
  notificationTokenReturned:!result.reused&&Boolean(result.token)
 });
});
router.get("/ai/coding/bridge/critical-approvals/:id",async(req,res):Promise<void>=>{
 const p=Uuid.safeParse(req.params["id"]);
 if(!p.success){res.status(400).json({error:"Invalid approval id"});return;}
 const approval=await getCriticalApproval(p.data);
 if(!approval){res.status(404).json({error:"Critical approval not found"});return;}
 res.json(approval);
});

router.post("/ai/coding/bridge/critical-approvals/:id/decision",async(req,res):Promise<void>=>{
 const id=Uuid.safeParse(req.params["id"]);
 const body=z.object({
  decision:z.enum(["APPROVE","REJECT"]),
  actor:z.string().min(1).max(200).optional()
 }).strict().safeParse(req.body??{});
 if(!id.success){res.status(400).json({error:"Invalid approval id"});return;}
 if(!body.success){res.status(400).json({error:body.error.message});return;}
 try{
  const approval=await decideCodingCriticalApprovalById({
   approvalId:id.data,
   decision:body.data.decision,
   actor:body.data.actor??"admin-api"
  });
  res.json({accepted:true,approval});
 }catch(error){
  const code=error instanceof Error?error.message:String(error);
  const status=
   code==="APPROVAL_NOT_FOUND"
    ?404
    :["APPROVAL_EXPIRED","APPROVAL_NOT_PENDING","APPROVAL_RACE_LOST"].includes(code)
      ?409
      :500;
  res.status(status).json({error:code});
 }
});

router.get("/ai/coding/bridge/runtime-status",async(_req,res):Promise<void>=>{
 const autonomousRecovery=await recoverAutonomousCodingRuntimeIfDatabaseReady();
 const autonomous=getAutonomousRuntimeStatus();
 const whatsapp=getCodingWhatsappConfigStatus();
 const githubConfigured=Boolean(process.env["AI_CODING_GITHUB_TOKEN"]?.trim());
 const incomingSecretConfigured=Boolean(process.env["AI_CODING_WA_INCOMING_SECRET"]?.trim());
 const allowedSendersConfigured=Boolean(process.env["AI_CODING_WA_ALLOWED_SENDERS"]?.trim());
 const buildCommitSha=(process.env["CST_BUILD_COMMIT_SHA"]??"unknown").trim()||"unknown";
 const production=process.env["NODE_ENV"]==="production";
 const ready=
  autonomous.configured&&
  autonomous.running&&
  whatsapp.baseUrl&&
  whatsapp.apiKey&&
  whatsapp.to&&
  githubConfigured&&
  incomingSecretConfigured&&
  allowedSendersConfigured;
 res.status(ready?200:503).json({
  ready,
  production,
  buildCommitSha,
  autonomous,
  autonomousRecovery,
  dependencies:{
   githubConfigured,
   whatsapp,
   incomingSecretConfigured,
   allowedSendersConfigured
  }
 });
});
router.get("/ai/coding/bridge/whatsapp-status",async(_req,res):Promise<void>=>{res.json({configured:getCodingWhatsappConfigStatus()});});
router.post("/ai/coding/bridge/whatsapp-test",async(_req,res):Promise<void>=>{
 const configured=getCodingWhatsappConfigStatus();
 const ok=configured.baseUrl&&configured.apiKey&&configured.to;
 res.status(ok?200:503).json({
  ok,
  configured,
  policy:"critical_human_review_only",
  message:ok
   ?"WhatsApp admin siap. Notifikasi otomatis hanya dikirim untuk critical human review."
   :"WhatsApp admin belum lengkap konfigurasinya."
 });
});
export default router;
