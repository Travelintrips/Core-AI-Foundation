/**
 * jobs.ts — AI Job Engine API (Phase 5)
 *
 * GET    /ai/jobs                    — list jobs (filter: status, jobType, deptId, limit, offset)
 * POST   /ai/jobs                    — enqueue a new job
 * GET    /ai/jobs/stats              — queue stats dashboard
 * GET    /ai/jobs/:id                — get single job
 * PATCH  /ai/jobs/:id/cancel         — cancel job
 * PATCH  /ai/jobs/:id/retry          — manually trigger retry
 * PATCH  /ai/jobs/:id/priority       — reprioritize
 * GET    /ai/workers                 — list workers
 * POST   /ai/workers                 — register / upsert worker
 * PATCH  /ai/workers/:id/heartbeat   — worker heartbeat
 * PATCH  /ai/workers/:id/status      — update worker status
 * POST   /ai/queue/pause             — pause queue (queued → waiting)
 * POST   /ai/queue/resume            — resume queue (waiting → queued)
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { eq, and, inArray, desc, sql, gte } from "drizzle-orm";
import {
  CreateJobBody,
  ListJobsQueryParams,
  ReprioritizeJobBody,
  RegisterWorkerBody,
  PauseQueueBody,
  ResumeQueueBody,
} from "@workspace/api-zod";
import { db, aiJobsTable, aiWorkersTable } from "@workspace/db";
import {
  enqueue,
  reprioritize,
  pauseQueue,
  resumeQueue,
} from "../services/queueManagerService.js";
import {
  cancelJob,
  heartbeat as workerHeartbeat,
} from "../services/jobWorkerService.js";
import { logAudit } from "../services/aiAuditService.js";
import { publishSafe } from "../services/aiEventBusService.js";

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const JOB_STATUSES = [
  "queued", "waiting", "running", "retrying",
  "completed", "failed", "cancelled", "blocked",
] as const;

const WORKER_STATUSES = ["online", "offline", "maintenance", "busy", "idle"] as const;

// Aliases matching the original local names for readability
const EnqueueBody      = CreateJobBody;
const ListJobsQuery    = ListJobsQueryParams;
const ReprioritizeBody = ReprioritizeJobBody;

// Legacy links now return to the existing AI Core frontend and its ordinary
// internal session. There is no second DEV monitoring login or standalone UI.
router.get("/dev-center/login", (_req, res): void => {
  if (process.env["APP_ENV"] !== "development") { res.sendStatus(404); return; }
  res.redirect(302, "/login");
});
router.get("/dev-center/dashboard", (_req, res): void => {
  if (process.env["APP_ENV"] !== "development") { res.sendStatus(404); return; }
  res.redirect(302, "/");
});
router.get("/dev-center/login.js", (_req, res): void => { res.sendStatus(410); });
router.get("/dev-center/dashboard.js", (_req, res): void => { res.sendStatus(410); });
router.get("/dev-center/dashboard.css", (_req, res): void => { res.sendStatus(410); });

// Read-only DEV monitoring. Values are grounded in job records; never infer a percentage
// from status or claim that a worker/owner exists when no assignment evidence is stored.
router.get("/dev-center/jobs", async (req, res): Promise<void> => {
  if (process.env["APP_ENV"] !== "development") { res.sendStatus(404); return; }
  try {
    const jobs = await db.select({id:aiJobsTable.id,jobCode:aiJobsTable.jobCode,jobType:aiJobsTable.jobType,status:aiJobsTable.status,payload:aiJobsTable.payloadJson,result:aiJobsTable.resultJson,employeeId:aiJobsTable.employeeId,departmentId:aiJobsTable.departmentId,error:aiJobsTable.errorMessage,updatedAt:aiJobsTable.updatedAt}).from(aiJobsTable).orderBy(sql`CASE WHEN ${aiJobsTable.status} IN ('queued','waiting','running','retrying','blocked') THEN 0 ELSE 1 END`,desc(aiJobsTable.updatedAt)).limit(100);
    const states:Record<string,string>={queued:"QUEUED",waiting:"WAITING",running:"RUNNING",retrying:"RETRYING",blocked:"BLOCKED",failed:"FAILED",completed:"COMPLETED",cancelled:"CANCELLED"};
    const read=(v:unknown):Record<string,unknown>=>v && typeof v==="object" && !Array.isArray(v)?v as Record<string,unknown>:{};
    const str=(v:unknown):string=>typeof v==="string"?v.slice(0,180):"";
    const [bridgeResult, executionResult] = await Promise.allSettled([
      db.execute(sql`SELECT id::text AS id, source, external_id, title, status, owner, created_at, updated_at FROM ai_task_bridge.jobs ORDER BY CASE WHEN status IN ('QUEUED','RUNNING','REVIEW_REQUIRED') THEN 0 ELSE 1 END, updated_at DESC LIMIT 100`),
      db.execute(sql`SELECT e.id::text AS id,e.task_id,e.external_id,e.command_id::text AS command_id,e.title,e.source,e.status,e.progress,e.worker_id,e.worker_type,e.assigned_client_id,e.error_message,e.final_ack_verified,e.metadata,e.updated_at,t.assigned_to
        FROM public.ai_execution_jobs e LEFT JOIN public.ai_tasks t ON t.id=e.task_id ORDER BY CASE WHEN e.status IN ('received','processing','dispatching','verifying','review_required','blocked') THEN 0 ELSE 1 END, e.updated_at DESC LIMIT 100`),
    ]);
    const warnings:string[]=[];
    if(bridgeResult.status==="rejected")warnings.push("AI_TASK_BRIDGE_UNAVAILABLE");
    if(executionResult.status==="rejected")warnings.push("AI_EXECUTION_JOBS_UNAVAILABLE");
    const bridgeRows=bridgeResult.status==="fulfilled"?bridgeResult.value.rows:[];
    const executionRows=executionResult.status==="fulfilled"?executionResult.value.rows:[];
    const bridgeRefs=new Set(bridgeRows.map(row=>String(row["external_id"]??"")));
    const items:Record<string,unknown>[]=jobs.map(j=>{const p=read(j.payload),r=read(j.result);const explicitProgress=r["verifiedProgress"]??p["verifiedProgress"];
      const evidenceId=str(r["progressEvidenceId"])||str(r["checkpointId"])||str(p["progressEvidenceId"]);
      const verified=Boolean(evidenceId);
      const progress=verified && typeof explicitProgress==="number" && Number.isInteger(explicitProgress) && explicitProgress>=0 && explicitProgress<=100 && j.status!=="failed" ? explicitProgress:null;
      return {id:j.jobCode||String(j.id),deleteKey:"engine:"+j.id,title:str(p["title"])||j.jobType,source:"AI Core Engine",status:states[j.status]||"UNKNOWN",stage:str(r["stage"])||str(p["stage"])||null,verifiedProgress:progress,worker:str(r["workerName"])||str(p["workerName"])||null,accountable:str(p["accountableName"])||str(r["accountableName"])||null,workerType:str(p["workerType"])||null,blocker:j.error?String(j.error).slice(0,200):str(r["blocker"])||null,evidence:evidenceId||null,updatedAt:j.updatedAt?.toISOString()??null};
    });
    for(const row of bridgeRows){
      const external=String(row["external_id"]??"");
      items.push({id:String(row["id"]),deleteKey:"bridge:"+String(row["id"]),title:str(row["title"])||external,source:str(row["source"])||"AI Task Bridge",status:String(row["status"]??"UNKNOWN").toUpperCase(),stage:null,verifiedProgress:null,worker:str(row["owner"])||null,accountable:null,workerType:null,blocker:null,evidence:null,updatedAt:row["updated_at"] instanceof Date?(row["updated_at"] as Date).toISOString():row["updated_at"]??null});
    }
    for(const row of executionRows){
      const external=str(row["external_id"]),command=str(row["command_id"]);
      if((external && bridgeRefs.has(external))||(command && bridgeRefs.has("bridge-command:"+command)))continue;
      const metadata=read(row["metadata"]);const status=String(row["status"]??"UNKNOWN").toUpperCase();
      const evidenceId=str(metadata["progressEvidenceId"])||str(metadata["checkpointId"]);
      const progressValue=metadata["verifiedProgress"];
      const verifiedProgress=evidenceId && typeof progressValue==="number" && Number.isInteger(progressValue) && progressValue>=0 && progressValue<=100 && !["FAILED","BLOCKED","CANCELLED"].includes(status)?progressValue:status==="COMPLETED"&&row["final_ack_verified"]===true?100:null;
      items.push({id:String(row["id"]),deleteKey:"execution:"+String(row["id"]),title:str(row["title"])||"AI Task",source:str(row["source"])||"AI Tasks",status,stage:str(metadata["stage"])||null,verifiedProgress,worker:str(row["worker_id"])||str(row["assigned_client_id"])||null,accountable:str(row["assigned_to"])||null,workerType:str(row["worker_type"])||null,blocker:str(row["error_message"])||str(metadata["lastDispatchError"])||null,evidence:evidenceId|| (row["final_ack_verified"]===true?"Final ACK terverifikasi":null),updatedAt:row["updated_at"] instanceof Date?(row["updated_at"] as Date).toISOString():row["updated_at"]??null});
    }
    const viewerId = req.internalUser?.id;
    const hiddenRows = viewerId ? (await db.execute(sql`SELECT job_key FROM ai_platform.dev_monitor_dismissed_jobs WHERE user_id = ${viewerId}`)).rows : [];
    const hiddenKeys = new Set(hiddenRows.map(row => String(row["job_key"])));
    const activeStatuses=new Set(["QUEUED","WAITING","RUNNING","RETRYING","RECEIVED","PROCESSING","DISPATCHING","VERIFYING","REVIEW_REQUIRED","BLOCKED"]);
    items.sort((a,b)=>Number(activeStatuses.has(String(b["status"])))-Number(activeStatuses.has(String(a["status"]))) || (Date.parse(String(b["updatedAt"]??0))||0)-(Date.parse(String(a["updatedAt"]??0))||0));
    res.setHeader("Cache-Control","no-store");
    res.json({jobs:items.filter(item => !hiddenKeys.has(String(item["deleteKey"]))).slice(0,200),warnings});
  } catch {res.status(503).json({error:"DEV_JOB_MONITOR_UNAVAILABLE"});}
});

// DEV-only user-specific dashboard cleanup. NEVER delete jobs, commands, events or ACKs.
// Only terminal rows may be dismissed. Each INSERT selects a live terminal row,
// so client-supplied statuses cannot authorize dismissal or race with workers.
router.post("/dev-center/jobs/dismiss", async (req, res): Promise<void> => {
  if (process.env["APP_ENV"] !== "development") { res.sendStatus(404); return; }
  if (!req.internalUser || req.internalUser.status !== "active" || req.internalUser.accountType !== "internal") {
    res.status(403).json({error:"INTERNAL_SESSION_REQUIRED"}); return;
  }
  const origin = req.get("origin");
  if (origin && (() => { try { return new URL(origin).host !== req.get("host"); } catch { return true; } })()) {
    res.status(403).json({error:"CROSS_ORIGIN_NOT_ALLOWED"}); return;
  }
  const keys:unknown = req.body?.keys;
  if (!Array.isArray(keys) || keys.length===0 || keys.length>100 ||
      keys.some(k => typeof k!=="string" || !/^(engine:[0-9]{1,16}|(?:bridge|execution):[0-9a-f-]{36})$/i.test(k)) ||
      new Set(keys).size !== keys.length) {
    res.status(400).json({error:"INVALID_JOB_SELECTION"}); return;
  }
  const userId = req.internalUser.id;
  const dismissed:string[]=[]; const rejected:string[]=[];
  try {
    for (const key of keys as string[]) {
      const [kind,id] = key.split(":");
      let inserted:{rows:Record<string,unknown>[]};
      if (kind==="bridge") {
        inserted=await db.execute(sql`INSERT INTO ai_platform.dev_monitor_dismissed_jobs(user_id,job_key)
          SELECT ${userId}, ${key} FROM ai_task_bridge.jobs
          WHERE id = ${id}::uuid AND status IN ('FAILED','COMPLETED','CANCELLED')
          ON CONFLICT DO NOTHING RETURNING job_key`);
      } else if (kind==="execution") {
        inserted=await db.execute(sql`INSERT INTO ai_platform.dev_monitor_dismissed_jobs(user_id,job_key)
          SELECT ${userId}, ${key} FROM public.ai_execution_jobs
          WHERE id = ${id}::uuid AND status IN ('failed','completed','cancelled')
          ON CONFLICT DO NOTHING RETURNING job_key`);
      } else {
        inserted=await db.execute(sql`INSERT INTO ai_platform.dev_monitor_dismissed_jobs(user_id,job_key)
          SELECT ${userId}, ${key} FROM ai_platform.ai_jobs
          WHERE id = ${Number(id)} AND status IN ('failed','completed','cancelled')
          ON CONFLICT DO NOTHING RETURNING job_key`);
      }
      if (inserted.rows.length) dismissed.push(key); else rejected.push(key);
    }
    res.setHeader("Cache-Control","no-store");
    res.json({dismissed,rejected,note:"Job removed from this user's DEV dashboard only. Source job, events and ACK preserved."});
  } catch { res.status(503).json({error:"DEV_JOB_DISMISS_UNAVAILABLE"}); }
});

// DEV lifecycle Human-in-the-Loop bridge: persistent Human Task Center handoff.
// Creating an assistance request must NEVER dispatch or resume an AI worker.
// A genuine signed checkpoint, validated receiver ACK, healthy lease and
// explicit authorization are prerequisites for any later resume integration.
router.post("/dev-center/jobs/human-assistance", async (req, res): Promise<void> => {
  if (process.env["APP_ENV"] !== "development") { res.sendStatus(404); return; }
  const actor = req.internalUser;
  if (!actor || actor.status !== "active" || actor.accountType !== "internal") {
    res.status(403).json({error:"INTERNAL_SESSION_REQUIRED"}); return;
  }
  const origin = req.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== req.get("host")) { res.status(403).json({error:"CROSS_ORIGIN_NOT_ALLOWED"}); return; } }
    catch { res.status(403).json({error:"CROSS_ORIGIN_NOT_ALLOWED"}); return; }
  }
  const {jobKey,reason,openClawEvidence,assignedUser} = req.body ?? {};
  if (typeof jobKey!=="string" || !/^(?:engine:[0-9]{1,16}|(?:bridge|execution):[0-9a-f-]{36})$/i.test(jobKey) ||
      typeof reason!=="string" || reason.trim().length<20 || reason.length>2000 ||
      typeof openClawEvidence!=="string" || openClawEvidence.trim().length<20 || openClawEvidence.length>2000 ||
      (assignedUser!==undefined && (typeof assignedUser!=="string" || assignedUser.length>200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(assignedUser)))) {
    res.status(400).json({error:"INVALID_ESCALATION_EVIDENCE"}); return;
  }
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${jobKey}))`);
      const [kind,id] = jobKey.split(":");
      let source: {rows:Record<string,unknown>[]};
      if (kind==="bridge") source=await tx.execute(sql`SELECT status FROM ai_task_bridge.jobs WHERE id=${id}::uuid`);
      else if (kind==="execution") source=await tx.execute(sql`SELECT status FROM public.ai_execution_jobs WHERE id=${id}::uuid`);
      else source=await tx.execute(sql`SELECT status FROM ai_platform.ai_jobs WHERE id=${Number(id)}`);
      const status = String(source.rows[0]?.["status"] ?? "").toUpperCase();
      if (!["BLOCKED","REVIEW_REQUIRED","FAILED"].includes(status)) return {kind:"not_blocked" as const};
      const existing=await tx.execute(sql`SELECT id,task_code,status FROM ai_platform.ai_human_tasks WHERE source_module='ai_core_lifecycle' AND source_type='job' AND source_id=${jobKey} LIMIT 1`);
      if (existing.rows.length) return {kind:"existing" as const, task:existing.rows[0]};
      const requestedPic=typeof assignedUser==="string" ? assignedUser.toLowerCase() : String(actor.email).toLowerCase();
      const user=await tx.execute(sql`SELECT email FROM ai_platform.internal_users WHERE lower(email)=${requestedPic} AND status='active' AND account_type='internal' LIMIT 1`);
      if (!user.rows.length) return {kind:"invalid_assignee" as const};
      const taskCode="HT-AICORE-"+randomUUID().slice(0,12).toUpperCase();
      const payload=JSON.stringify({jobKey,sourceStatus:status,openClawEvidence:openClawEvidence.trim(),requestedBy:actor.email,resumeAllowed:false,approvalRequired:true});
      const created=await tx.execute(sql`INSERT INTO ai_platform.ai_human_tasks
        (task_code,source_module,source_type,source_id,assigned_user,assigned_role,priority,status,reason,instructions,payload_json)
        VALUES (${taskCode},'ai_core_lifecycle','job',${jobKey},${requestedPic},'Administrator',80,'assigned',${reason.trim()},
          'Bantu selesaikan hambatan job. Jangan mengeksekusi ulang command, mengubah status job atau melewati otorisasi. Lampirkan bukti hasil dan laporkan melalui Human Tasks. Resume GPT02 tetap terkunci sampai checkpoint/ACK, lease dan otorisasi diperiksa.',
          ${payload}::jsonb)
        ON CONFLICT DO NOTHING RETURNING id,task_code,status`);
      if (!created.rows.length) return {kind:"existing" as const,task:(await tx.execute(sql`SELECT id,task_code,status FROM ai_platform.ai_human_tasks WHERE source_module='ai_core_lifecycle' AND source_id=${jobKey}`)).rows[0]};
      await tx.execute(sql`INSERT INTO ai_platform.ai_human_task_history (task_id,action,performed_by,notes,new_status)
        VALUES (${created.rows[0]?.["id"]},'created',${actor.email},'DEV lifecycle escalation; OpenClaw evidence was submitted by operator, not independently attested','assigned')`);
      return {kind:"created" as const,task:created.rows[0]};
    });
    if (result.kind==="not_blocked") {res.status(409).json({error:"JOB_NOT_BLOCKED_OR_TERMINAL"});return;}
    if (result.kind==="invalid_assignee") {res.status(400).json({error:"ASSIGNEE_NOT_ACTIVE_INTERNAL_USER"});return;}
    if (result.kind==="created" && result.task) {
      await Promise.allSettled([
        publishSafe({eventType:"human.task.created",sourceModule:"human_task_center",sourceId:String(result.task["id"]),payload:{taskCode:String(result.task["task_code"]),sourceModule:"ai_core_lifecycle",sourceType:"job",status:"assigned"}}),
        logAudit("ai_core_lifecycle","human_escalation_created",jobKey,"job","success",{humanTaskId:result.task["id"],createdBy:actor.email,resumeAllowed:false}),
      ]);
    }
    res.setHeader("Cache-Control","no-store");
    res.status(result.kind==="created"?201:200).json({task:result.task,duplicate:result.kind==="existing",resumeAllowed:false,notification:"Human Task created; resume requires independent evidence and authorization."});
  } catch {res.status(503).json({error:"HUMAN_ESCALATION_UNAVAILABLE"});}
});

router.get("/dev-center/jobs/human-assistance", async (req,res): Promise<void> => {
  if (process.env["APP_ENV"] !== "development") {res.sendStatus(404);return;}
  if (!req.internalUser || req.internalUser.status!=="active" || req.internalUser.accountType!=="internal") {res.status(403).json({error:"INTERNAL_SESSION_REQUIRED"});return;}
  try {
    const records=await db.execute(sql`SELECT source_id AS job_key,id,task_code,status,assigned_user,reason,
      payload_json->>'openClawEvidence' AS openclaw_evidence,created_at,completed_at
      FROM ai_platform.ai_human_tasks WHERE source_module='ai_core_lifecycle' AND source_type='job'
      ORDER BY created_at DESC LIMIT 200`);
    res.setHeader("Cache-Control","no-store");
    res.json({requests:records.rows.map(row=>({...row,resumeAllowed:false,
      nextAction:row["status"]==="completed"?'VERIFY_CHECKPOINT_ACK_LEASE_AND_AUTHORIZATION':'HUMAN_TASK_ACTION_REQUIRED'}))});
  } catch {res.status(503).json({error:"HUMAN_ASSISTANCE_QUERY_UNAVAILABLE"});}
});

// ── List Jobs ─────────────────────────────────────────────────────────────────

router.get("/ai/jobs", async (req, res): Promise<void> => {
  const q = ListJobsQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const { status, jobType, departmentId, limit, offset } = q.data;

  const conditions: ReturnType<typeof eq>[] = [];
  if (status) {
    const parts = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1) {
      conditions.push(eq(aiJobsTable.status, parts[0]!));
    } else {
      conditions.push(inArray(aiJobsTable.status, parts as typeof JOB_STATUSES[number][]));
    }
  }
  if (jobType)      conditions.push(eq(aiJobsTable.jobType, jobType));
  if (departmentId) conditions.push(eq(aiJobsTable.departmentId, departmentId));

  const [jobs, [{ total }]] = await Promise.all([
    db
      .select()
      .from(aiJobsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(aiJobsTable.priorityScore), aiJobsTable.createdAt)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(aiJobsTable)
      .where(conditions.length ? and(...conditions) : undefined),
  ]);

  res.json({
    items: jobs.map(serializeJob),
    total,
    limit,
    offset,
  });
});

// ── Enqueue Job ───────────────────────────────────────────────────────────────

router.post("/ai/jobs", async (req, res): Promise<void> => {
  const body = EnqueueBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const d = body.data;
  const job = await enqueue({
    jobType:           d.jobType,
    payloadJson:       d.payloadJson,
    priority:          d.priority,
    executionPlanId:   d.executionPlanId ?? null,
    departmentId:      d.departmentId ?? null,
    employeeId:        d.employeeId ?? null,
    scheduledAt:       d.scheduledAt ? new Date(d.scheduledAt) : null,
    maxRetry:          d.maxRetry,
    retryStrategy:     d.retryStrategy,
    estimatedCost:     d.estimatedCost ?? null,
    estimatedDuration: d.estimatedDuration ?? null,
    managerOverride:   d.managerOverride ?? null,
  });

  res.status(201).json(serializeJob(job));
});

// ── Queue Stats (BEFORE /:id) ─────────────────────────────────────────────────

router.get("/ai/jobs/stats", async (_req, res): Promise<void> => {
  const [statusCounts, workerCounts, timingRows] = await Promise.all([
    db
      .select({
        status: aiJobsTable.status,
        count:  sql<number>`count(*)::int`,
      })
      .from(aiJobsTable)
      .groupBy(aiJobsTable.status),

    db
      .select({
        status: aiWorkersTable.status,
        count:  sql<number>`count(*)::int`,
      })
      .from(aiWorkersTable)
      .groupBy(aiWorkersTable.status),

    db
      .select({
        avgWaitMs: sql<number | null>`
          avg(extract(epoch from (started_at - created_at)) * 1000)
        `,
        avgExecMs: sql<number | null>`
          avg(actual_duration)
        `,
      })
      .from(aiJobsTable)
      .where(
        and(
          eq(aiJobsTable.status, "completed"),
          gte(aiJobsTable.completedAt, sql`NOW() - INTERVAL '24 hours'`),
        ),
      ),
  ]);

  const byStatus = Object.fromEntries(
    JOB_STATUSES.map((s) => [s, statusCounts.find((r) => r.status === s)?.count ?? 0]),
  );
  const byWorkerStatus = Object.fromEntries(
    WORKER_STATUSES.map((s) => [s, workerCounts.find((r) => r.status === s)?.count ?? 0]),
  );

  const timing = timingRows[0];

  res.json({
    jobs:              byStatus,
    totalQueued:       byStatus.queued  + byStatus.waiting,
    totalActive:       byStatus.running + byStatus.retrying,
    totalBlocked:      byStatus.blocked,
    totalFailed:       byStatus.failed,
    completedToday:    byStatus.completed,
    workers:           byWorkerStatus,
    avgWaitMs:         timing?.avgWaitMs != null ? Number(timing.avgWaitMs) : null,
    avgExecutionMs:    timing?.avgExecMs  != null ? Number(timing.avgExecMs)  : null,
  });
});

// ── Get Single Job ────────────────────────────────────────────────────────────

router.get("/ai/jobs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job id" }); return; }

  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, id));

  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(serializeJob(job));
});

// ── Cancel Job ────────────────────────────────────────────────────────────────

router.patch("/ai/jobs/:id/cancel", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job id" }); return; }

  try {
    const job = await cancelJob(id);
    res.json(serializeJob(job));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Cancel failed";
    res.status(400).json({ error: msg });
  }
});

// ── Manual Retry ──────────────────────────────────────────────────────────────

router.patch("/ai/jobs/:id/retry", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job id" }); return; }

  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, id));

  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const retriable = ["failed", "blocked", "cancelled"].includes(job.status);
  if (!retriable) {
    res.status(400).json({ error: `Job is ${job.status} — cannot retry` });
    return;
  }

  const [updated] = await db
    .update(aiJobsTable)
    .set({
      status:       "queued",
      errorMessage: null,
      nextRetryAt:  null,
      updatedAt:    new Date(),
    })
    .where(eq(aiJobsTable.id, id))
    .returning();

  await logAudit("job-engine", "job_manual_retry", String(id), "ai_job", "success", {});

  res.json(serializeJob(updated));
});

// ── Reprioritize ──────────────────────────────────────────────────────────────

router.patch("/ai/jobs/:id/priority", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid job id" }); return; }

  const body = ReprioritizeBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  try {
    const updated = await reprioritize(id, body.data.priority, body.data.managerOverride ?? null);
    res.json(serializeJob(updated));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Reprioritize failed";
    res.status(404).json({ error: msg });
  }
});

// ── List Workers ──────────────────────────────────────────────────────────────

router.get("/ai/workers", async (_req, res): Promise<void> => {
  const workers = await db
    .select()
    .from(aiWorkersTable)
    .orderBy(aiWorkersTable.workerName);
  res.json(workers.map(serializeWorker));
});

// ── Register / Upsert Worker ──────────────────────────────────────────────────

router.post("/ai/workers", async (req, res): Promise<void> => {
  const body = RegisterWorkerBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { workerName, version } = body.data;

  const [existing] = await db
    .select()
    .from(aiWorkersTable)
    .where(eq(aiWorkersTable.workerName, workerName));

  if (existing) {
    const [updated] = await db
      .update(aiWorkersTable)
      .set({ version, status: "idle", lastHeartbeat: new Date(), updatedAt: new Date() })
      .where(eq(aiWorkersTable.id, existing.id))
      .returning();
    res.json(serializeWorker(updated));
    return;
  }

  const [worker] = await db
    .insert(aiWorkersTable)
    .values({ workerName, version, status: "idle" })
    .returning();

  res.status(201).json(serializeWorker(worker));
});

// ── Worker Heartbeat ──────────────────────────────────────────────────────────

router.patch("/ai/workers/:id/heartbeat", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid worker id" }); return; }

  try {
    const worker = await workerHeartbeat(id);
    res.json(serializeWorker(worker));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Not found" });
  }
});

// ── Update Worker Status ──────────────────────────────────────────────────────

router.patch("/ai/workers/:id/status", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"]!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid worker id" }); return; }

  const { status } = (req.body ?? {}) as { status?: string };
  if (!status || !WORKER_STATUSES.includes(status as typeof WORKER_STATUSES[number])) {
    res.status(400).json({ error: `status must be one of: ${WORKER_STATUSES.join(", ")}` });
    return;
  }

  const [worker] = await db
    .update(aiWorkersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(aiWorkersTable.id, id))
    .returning();

  if (!worker) { res.status(404).json({ error: "Worker not found" }); return; }
  res.json(serializeWorker(worker));
});

// ── Queue Management ──────────────────────────────────────────────────────────

router.post("/ai/queue/pause", async (req, res): Promise<void> => {
  const body = PauseQueueBody.safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const count = await pauseQueue({
    departmentId: body.data.departmentId ?? undefined,
    jobType:      body.data.jobType ?? undefined,
  });
  res.json({ paused: count });
});

router.post("/ai/queue/resume", async (req, res): Promise<void> => {
  const body = ResumeQueueBody.safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const count = await resumeQueue({
    departmentId: body.data.departmentId ?? undefined,
    jobType:      body.data.jobType ?? undefined,
  });
  res.json({ resumed: count });
});

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeJob(job: Record<string, unknown> & {
  id: number; createdAt: Date; updatedAt: Date;
  startedAt?: Date | null; completedAt?: Date | null;
  scheduledAt?: Date | null; nextRetryAt?: Date | null;
  estimatedCost?: string | null; actualCost?: string | null;
  priorityScore?: string | null;
}) {
  return {
    ...job,
    estimatedCost:  job.estimatedCost  != null ? parseFloat(String(job.estimatedCost))  : null,
    actualCost:     job.actualCost     != null ? parseFloat(String(job.actualCost))     : null,
    priorityScore:  job.priorityScore  != null ? parseFloat(String(job.priorityScore))  : null,
    createdAt:      job.createdAt.toISOString(),
    updatedAt:      job.updatedAt.toISOString(),
    startedAt:      job.startedAt     ? job.startedAt.toISOString()     : null,
    completedAt:    job.completedAt   ? job.completedAt.toISOString()   : null,
    scheduledAt:    job.scheduledAt   ? job.scheduledAt.toISOString()   : null,
    nextRetryAt:    job.nextRetryAt   ? job.nextRetryAt.toISOString()   : null,
  };
}

function serializeWorker(w: Record<string, unknown> & {
  id: number; createdAt: Date; updatedAt: Date; lastHeartbeat: Date;
  averageLatency?: string | null;
}) {
  return {
    ...w,
    averageLatency: w.averageLatency != null ? parseFloat(String(w.averageLatency)) : null,
    lastHeartbeat:  w.lastHeartbeat.toISOString(),
    createdAt:      w.createdAt.toISOString(),
    updatedAt:      w.updatedAt.toISOString(),
  };
}

export default router;
