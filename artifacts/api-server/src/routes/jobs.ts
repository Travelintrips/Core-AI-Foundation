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

// Public login FORM only: requires existing internal account credentials.
// All dashboard, assets, and job data still use the normal /api auth middleware.
router.get("/dev-center/login", (_req, res): void => {
  if (process.env["APP_ENV"] !== "development") { res.sendStatus(404); return; }
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(
    '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Login AI Core DEV Monitor</title>' +
    '<style>body{font:16px system-ui;background:#101d31;color:#fff;display:grid;place-items:center;min-height:90vh}' +
    'main{width:min(420px,90%);padding:28px;background:#1d304c;border-radius:12px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:9px 0;border-radius:7px}' +
    'button{cursor:pointer}#message{color:#ffe1a0}</style></head><body><main>' +
    '<h1>AI Core DEV Monitoring</h1><p>Masuk menggunakan akun internal AI Core.</p>' +
    '<form id="login"><label>Email<input name="email" type="email" autocomplete="username" required></label>' +
    '<label>Password<input name="password" type="password" autocomplete="current-password" required></label>' +
    '<button type="submit">Masuk ke Dashboard</button></form><p role="status" id="message"></p>' +
    '<script src="/api/dev-center/login.js" defer></script></main></body></html>'
  );
});
router.get("/dev-center/login.js", (_req, res): void => {
  if (process.env["APP_ENV"] !== "development") { res.sendStatus(404); return; }
  res.setHeader("Cache-Control", "no-store");
  res.type("javascript").send(
    'document.getElementById("login").addEventListener("submit",async function(e){e.preventDefault();' +
    'const f=e.currentTarget,m=document.getElementById("message"),b=f.querySelector("button");b.disabled=true;m.textContent="Memverifikasi...";' +
    'try{const r=await fetch("/api/internal/auth/login",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({email:f.elements.email.value,password:f.elements.password.value})});' +
    'if(!r.ok){m.textContent="Login gagal. Periksa akun internal Anda.";return;}' +
    'window.location.assign("/api/dev-center/dashboard");' +
    '}catch(_){m.textContent="Server login tidak dapat dihubungi.";}finally{b.disabled=false;}});'
  );
});

// Authenticated DEV-only monitor page. Both assets and data use the same
// global /api authentication boundary; nothing is exposed as public static HTML.
router.get("/dev-center/dashboard", (_req, res): void => {
  if (process.env["APP_ENV"] !== "development") { res.sendStatus(404); return; }
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Core DEV — Monitoring Pekerjaan</title><link rel="stylesheet" href="/api/dev-center/dashboard.css"></head><body><main><header><h1>AI Core — Monitoring Pekerjaan DEV</h1><p>Status, progres terverifikasi, pelaksana, penanggung jawab, dan bukti pekerjaan. Tidak mengubah eksekusi.</p><p id="connection" role="status" aria-live="polite">Memuat...</p></header><section aria-label="Ringkasan"><div id="totals" class="totals"></div></section><section aria-label="Filter"><label>Status <select id="filter"><option value="active">Aktif / perlu perhatian</option><option value="all">Semua</option><option value="completed">Selesai</option></select></label> <label>Cari <input id="search" placeholder="ID, nama job, pelaksana"></label></section><section aria-label="Daftar pekerjaan"><div class="table-wrap"><table><thead><tr><th>Job / Sumber</th><th>Status / Tahap</th><th>Progres terverifikasi</th><th>Pelaksana</th><th>Penanggung jawab</th><th>Hambatan / Bukti</th><th>Aktivitas terakhir</th></tr></thead><tbody id="jobs"><tr><td colspan="7">Memuat job DEV...</td></tr></tbody></table></div></section><p class="note">Progres hanya muncul bila ada checkpoint yang terverifikasi. Status FAILED tidak pernah dianggap PASS meskipun semua langkah dicoba. Identitas yang belum tersedia ditampilkan sebagai Belum ditetapkan.</p></main><script src="/api/dev-center/dashboard.js" defer></script></body></html>`);
});

router.get("/dev-center/dashboard.css", (_req, res): void => {
  if (process.env["APP_ENV"] !== "development") { res.sendStatus(404); return; }
  res.setHeader("Cache-Control", "no-store");
  res.type("css").send(`:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0d1526;color:#eef4fc}body{margin:0}main{max-width:1500px;margin:0 auto;padding:24px 18px}h1{font-size:25px}p,.note{color:#b9c8de}.totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:18px 0}.metric{background:#1b2c46;border:1px solid #304a66;padding:15px;border-radius:10px}.metric strong{font-size:25px;display:block}section{margin-bottom:18px}label{margin-right:16px}input,select{padding:9px;background:#1b2c46;color:#eef4fc;border:1px solid #4a6380;border-radius:6px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;background:#142239}th,td{text-align:left;padding:12px;border-bottom:1px solid #30425d;vertical-align:top;min-width:120px}th{color:#c4d4e7;white-space:nowrap}td:first-child{min-width:210px}small{display:block;color:#aebed1;margin-top:5px}progress{width:120px;height:12px;accent-color:#38a68a}.pill{display:inline-block;padding:3px 8px;border-radius:6px;background:#2b4463;font-size:12px}.note{font-size:13px}#connection{font-weight:600}`);
});

router.get("/dev-center/dashboard.js", (_req, res): void => {
  if (process.env["APP_ENV"] !== "development") { res.sendStatus(404); return; }
  res.setHeader("Cache-Control", "no-store");
  res.type("javascript").send(`(function(){"use strict";
  const connection=document.getElementById("connection"),body=document.getElementById("jobs"),totals=document.getElementById("totals"),filter=document.getElementById("filter"),search=document.getElementById("search");let data=[];
  function cell(row,value){const td=document.createElement("td");td.textContent=String(value??"");row.append(td);return td;}
  function render(){const q=search.value.toLowerCase().trim(),mode=filter.value;body.replaceChildren();totals.replaceChildren();
    const counts={active:0,waiting:0,attention:0,completed:0};for(const j of data){if(["RUNNING","RETRYING","PROCESSING"].includes(j.status))counts.active++;else if(["QUEUED","WAITING","PENDING"].includes(j.status))counts.waiting++;else if(["BLOCKED","FAILED","REVIEW_REQUIRED"].includes(j.status))counts.attention++;else if(j.status==="COMPLETED")counts.completed++;}
    for(const [label,key] of [["Sedang dikerjakan","active"],["Menunggu","waiting"],["Perlu perhatian","attention"],["Selesai","completed"]]){const d=document.createElement("div"),strong=document.createElement("strong");d.className="metric";strong.textContent=counts[key];d.append(strong,document.createTextNode(label));totals.append(d);}
    const shown=data.filter(j=>(mode==="all"||(mode==="completed"?j.status==="COMPLETED":!["COMPLETED","CANCELLED"].includes(j.status)))&&[j.id,j.title,j.worker,j.accountable,j.source].join(" ").toLowerCase().includes(q));
    for(const j of shown){const tr=document.createElement("tr");const first=cell(tr,j.title);const id=document.createElement("small");id.textContent=j.source+" · "+j.id;first.append(id);
      const stat=cell(tr,j.status),stage=document.createElement("small");stage.textContent=j.stage||"Tahap belum terverifikasi";stat.append(stage);
      const prog=document.createElement("td");if(typeof j.verifiedProgress==="number"){const bar=document.createElement("progress");bar.max=100;bar.value=j.verifiedProgress;prog.append(bar,document.createTextNode(" "+j.verifiedProgress+"%"));}else prog.textContent="Belum terverifikasi";tr.append(prog);
      cell(tr,j.worker||"Belum ditetapkan");cell(tr,j.accountable||"Belum ditetapkan");const evidence=cell(tr,j.blocker||"—");if(j.evidence){const sm=document.createElement("small");sm.textContent="Bukti: "+j.evidence;evidence.append(sm);}cell(tr,j.updatedAt?new Date(j.updatedAt).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"}):"—");body.append(tr);}
    if(!shown.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=7;td.textContent="Tidak ada pekerjaan sesuai filter.";tr.append(td);body.append(tr);}
  }
  async function refresh(){if(document.hidden)return;try{const r=await fetch("/api/dev-center/jobs",{credentials:"same-origin",cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);const payload=await r.json();if(!Array.isArray(payload.jobs))throw new Error("Format data tidak valid");data=payload.jobs;render();connection.textContent="DEV terhubung · terakhir diperbarui "+new Date().toLocaleTimeString("id-ID")+" · "+data.length+" pekerjaan"+(payload.warnings?.length?" · Data parsial: "+payload.warnings.join(", "):"");}catch(e){connection.textContent="Data monitoring tidak tersedia: "+e.message;}}
  filter.addEventListener("change",render);search.addEventListener("input",render);refresh();setInterval(refresh,15000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});})();`);
});

// Read-only DEV monitoring. Values are grounded in job records; never infer a percentage
// from status or claim that a worker/owner exists when no assignment evidence is stored.
router.get("/dev-center/jobs", async (_req, res): Promise<void> => {
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
      return {id:j.jobCode||String(j.id),title:str(p["title"])||j.jobType,source:"AI Core Engine",status:states[j.status]||"UNKNOWN",stage:str(r["stage"])||str(p["stage"])||null,verifiedProgress:progress,worker:str(r["workerName"])||str(p["workerName"])||null,accountable:str(p["accountableName"])||str(r["accountableName"])||null,workerType:str(p["workerType"])||null,blocker:j.error?String(j.error).slice(0,200):str(r["blocker"])||null,evidence:evidenceId||null,updatedAt:j.updatedAt?.toISOString()??null};
    });
    for(const row of bridgeRows){
      const external=String(row["external_id"]??"");
      items.push({id:String(row["id"]),title:str(row["title"])||external,source:str(row["source"])||"AI Task Bridge",status:String(row["status"]??"UNKNOWN").toUpperCase(),stage:null,verifiedProgress:null,worker:str(row["owner"])||null,accountable:null,workerType:null,blocker:null,evidence:null,updatedAt:row["updated_at"] instanceof Date?(row["updated_at"] as Date).toISOString():row["updated_at"]??null});
    }
    for(const row of executionRows){
      const external=str(row["external_id"]),command=str(row["command_id"]);
      if((external && bridgeRefs.has(external))||(command && bridgeRefs.has("bridge-command:"+command)))continue;
      const metadata=read(row["metadata"]);const status=String(row["status"]??"UNKNOWN").toUpperCase();
      const evidenceId=str(metadata["progressEvidenceId"])||str(metadata["checkpointId"]);
      const progressValue=metadata["verifiedProgress"];
      const verifiedProgress=evidenceId && typeof progressValue==="number" && Number.isInteger(progressValue) && progressValue>=0 && progressValue<=100 && !["FAILED","BLOCKED","CANCELLED"].includes(status)?progressValue:status==="COMPLETED"&&row["final_ack_verified"]===true?100:null;
      items.push({id:String(row["id"]),title:str(row["title"])||"AI Task",source:str(row["source"])||"AI Tasks",status,stage:str(metadata["stage"])||null,verifiedProgress,worker:str(row["worker_id"])||str(row["assigned_client_id"])||null,accountable:str(row["assigned_to"])||null,workerType:str(row["worker_type"])||null,blocker:str(row["error_message"])||str(metadata["lastDispatchError"])||null,evidence:evidenceId|| (row["final_ack_verified"]===true?"Final ACK terverifikasi":null),updatedAt:row["updated_at"] instanceof Date?(row["updated_at"] as Date).toISOString():row["updated_at"]??null});
    }
    items.sort((a,b)=>Date.parse(String(b["updatedAt"]??0))-Date.parse(String(a["updatedAt"]??0)));
    res.setHeader("Cache-Control","no-store");
    res.json({jobs:items.slice(0,200),warnings});
  } catch {res.status(503).json({error:"DEV_JOB_MONITOR_UNAVAILABLE"});}
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
