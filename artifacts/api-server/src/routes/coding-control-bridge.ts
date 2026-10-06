import { Router } from "express";
import { z } from "zod";
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
const router=Router(); const Uuid=z.string().uuid();
router.post("/ai/coding/bridge/commands",async(req,res):Promise<void>=>{const p=z.object({externalCommandId:z.string().min(1).max(200),instruction:z.string().min(1).max(50000),taskId:Uuid.nullish(),source:z.string().min(1).max(50).optional(),commandType:z.string().min(1).max(50).optional(),authority:z.record(z.string(),z.unknown()).optional(),metadata:z.record(z.string(),z.unknown()).optional()}).safeParse(req.body);if(!p.success){res.status(400).json({error:p.error.message});return;}const x=await submitCodingBridgeCommand(p.data);res.status(x.created?201:200).json(x);});
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
  actionType:z.enum(["WORKSTREAM_AI_HANDOFF","MERGE_PR","PRODUCTION_DEPLOY","PRODUCTION_DB_MIGRATION","DESTRUCTIVE_DB_CHANGE","SECURITY_CHANGE","PRODUCTION_SERVICE_RESTART"]),
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
