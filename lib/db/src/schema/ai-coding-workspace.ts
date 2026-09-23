Lanjutkan Phase 7A-11 — Recovery + Frontend Polling Final Gate.

JANGAN deploy.
JANGAN akses production.
JANGAN redesign pipeline yang sudah PASS.
Gunakan Supabase DEV saja.

==================================================
A. STUCK-JOB RECOVERY E2E
==================================================

Tujuan:
Buktikan job yang sudah di-claim worker tetapi worker mati/tidak memperpanjang
lease tidak tertinggal RUNNING selamanya.

Audit mekanisme existing:
- worker lease
- job lease
- heartbeat
- timeout
- stale worker detection
- retry/requeue
- max attempts

Gunakan mekanisme existing. Jangan membuat queue kedua.

Buat controlled DEV test:

1. enqueue coding_repository_analyzer
2. biarkan worker claim job
3. simulasi worker kehilangan lease/heartbeat dengan cara aman
4. tunggu recovery mechanism
5. buktikan job:
   - direqueue/retry sesuai architecture existing, lalu berhasil
   ATAU
   - mencapai FAILED setelah retry limit

Pastikan:
- tidak ada duplicate execution aktif
- ai_coding_runs tidak tertinggal RUNNING selamanya
- finishedAt/errorMessage benar jika terminal FAILED
- worker stale dapat direcovery

Jika mekanisme recovery belum lengkap, implementasikan minimal fix pada queue
existing dan tambahkan regression test.

==================================================
B. FRONTEND POLLING E2E
==================================================

Verifikasi TaskDetailPanel dengan lifecycle nyata/mocked integration:

RUN AGENT
→ RUNNING
→ polling aktif
→ COMPLETED / FAILED
→ final refetch
→ polling STOP

Pastikan:

- polling hanya ketika ada active RUNNING run
- tidak membuat POST /run berulang
- tidak membuat duplicate job
- result Repository Analyzer muncul
- status terminal muncul tanpa manual refresh
- FAILED juga menghentikan polling
- unmount/navigation membersihkan polling

Tambahkan automated test jika belum ada.

==================================================
C. REGRESSION
==================================================

Setelah fix:

Jalankan:
- coding workspace tests
- Repository Analyzer tests
- dispatcher/queue/recovery tests
- AI Platform tests
- API server tests
- root typecheck
- API build
- AI Platform build
- OpenAPI/workspace validation

Gunakan command project yang sebenarnya.

==================================================
D. SECURITY CHECK SEBELUM DEPLOY
==================================================

Pastikan Repository Analyzer tetap:

- read-only terhadap target repository
- tidak mengeksekusi arbitrary code dari repository
- tidak menjalankan install/build script repository target
- tidak mengeksekusi shell command dari isi task/repository
- bounded jumlah file/ukuran data
- credential/token tidak masuk logs/output
- private repository tidak dianggap public tanpa credential mechanism resmi

Jangan menambahkan credential baru pada phase ini.

==================================================
E. STOP BEFORE DEPLOY
==================================================

Laporkan evidence aktual:

STUCK JOB RECOVERY:
PASS/FAIL

RECOVERY METHOD:
...

DUPLICATE EXECUTION AFTER RECOVERY:
YES/NO

RUN LEFT PERMANENTLY RUNNING:
YES/NO

FRONTEND POLLING RUNNING:
PASS/FAIL

POLLING STOP COMPLETED:
PASS/FAIL

POLLING STOP FAILED:
PASS/FAIL

RESULT AUTO REFRESH:
PASS/FAIL

SECURITY CHECK:
PASS/FAIL

FOCUSED TESTS:
...

AI PLATFORM TESTS:
...

API SERVER TESTS:
...

TYPECHECK:
PASS/FAIL

API BUILD:
PASS/FAIL

AI PLATFORM BUILD:
PASS/FAIL

OPENAPI:
PASS/FAIL

DEV HEALTH:
...

DEPLOY:
NOT PERFORMED

Jangan menyatakan PASS berdasarkan inspeksi source saja.
Recovery dan polling harus mempunyai test/evidence aktual.
Perbaiki sampai PASS jika memungkinkan.import { appSchema } from "./_pg-schema";
import { uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const CODING_TASK_STATUSES = [
  "PENDING",
  "ANALYZING",
  "CODING",
  "TESTING",
  "COMMITTING",
  "PR_CREATED",
  "READY_REVIEW",
  "COMPLETED",
  "FAILED",
] as const;

export type CodingTaskStatus = (typeof CODING_TASK_STATUSES)[number];

export const CODING_RUN_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED"] as const;
export type CodingRunStatus = (typeof CODING_RUN_STATUSES)[number];

export const CODING_CHANGE_TYPES = ["ADDED", "MODIFIED", "DELETED", "RENAMED"] as const;
export type CodingChangeType = (typeof CODING_CHANGE_TYPES)[number];

export const aiCodingTasksTable = appSchema.table("ai_coding_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskNumber: text("task_number").notNull().unique(),
  projectName: text("project_name").notNull(),
  repository: text("repository").notNull(),
  branch: text("branch").notNull(),
  instruction: text("instruction").notNull(),
  status: text("status").notNull().default("PENDING"),
  priority: integer("priority").notNull().default(50),
  resultSummary: text("result_summary"),
  commitSha: text("commit_sha"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const aiCodingRunsTable = appSchema.table("ai_coding_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => aiCodingTasksTable.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  status: text("status").notNull().default("PENDING"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  logs: text("logs"),
  errorMessage: text("error_message"),
});

export const aiCodeChangesTable = appSchema.table("ai_code_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => aiCodingTasksTable.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  changeType: text("change_type").notNull(),
  commitSha: text("commit_sha"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiCodingTask = typeof aiCodingTasksTable.$inferSelect;
export type InsertAiCodingTask = typeof aiCodingTasksTable.$inferInsert;
export type AiCodingRun = typeof aiCodingRunsTable.$inferSelect;
export type AiCodeChange = typeof aiCodeChangesTable.$inferSelect;