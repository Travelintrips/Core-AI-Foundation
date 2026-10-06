import { randomUUID } from "node:crypto";
import { db, sql } from "@workspace/db";

const MAX_RESERVED_FILES = 40;
const RESERVATION_TTL_HOURS = 12;

export interface CodingFileConflict {
  file: string;
  taskId: string;
  runId: string | null;
  reservedAt: string | null;
  expiresAt: string | null;
}

export interface CodingFileReservationResult {
  status: "RESERVED" | "CONFLICT" | "EMPTY";
  files: string[];
  conflicts: CodingFileConflict[];
}

function normalizeFile(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function safeFiles(files: string[]): string[] {
  return [...new Set(files.map(normalizeFile))]
    .filter(
      (file) =>
        file.length > 0 &&
        file.length <= 500 &&
        !file.startsWith("/") &&
        !file.startsWith("../") &&
        !file.includes("/../") &&
        !file.includes("\0"),
    )
    .slice(0, MAX_RESERVED_FILES);
}

async function ensureTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_active_file_reservations (
      reservation_id uuid PRIMARY KEY,
      repository text NOT NULL,
      branch text NOT NULL,
      file_path text NOT NULL,
      task_id text NOT NULL,
      run_id text NULL,
      reserved_at timestamptz NOT NULL DEFAULT NOW(),
      expires_at timestamptz NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_coding_active_file_reservations_target_uidx
    ON ai_platform.ai_coding_active_file_reservations (repository, branch, file_path)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_coding_active_file_reservations_task_idx
    ON ai_platform.ai_coding_active_file_reservations (task_id)
  `);
}

async function cleanupExpiredAndTerminal(): Promise<void> {
  await ensureTable();
  await db.execute(sql`
    DELETE FROM ai_platform.ai_coding_active_file_reservations r
    WHERE r.expires_at <= NOW()
       OR EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_tasks t
          WHERE t.id::text = r.task_id
            AND t.status IN ('COMPLETED', 'FAILED')
       )
  `);
}

function rowConflict(row: Record<string, unknown>): CodingFileConflict {
  return {
    file: String(row["file_path"] ?? ""),
    taskId: String(row["task_id"] ?? ""),
    runId: row["run_id"] == null ? null : String(row["run_id"]),
    reservedAt: row["reserved_at"] == null ? null : new Date(String(row["reserved_at"])).toISOString(),
    expiresAt: row["expires_at"] == null ? null : new Date(String(row["expires_at"])).toISOString(),
  };
}

export async function reserveCodingFileSet(input: {
  repository: string;
  branch: string;
  taskId: string;
  runId?: string | null;
  files: string[];
}): Promise<CodingFileReservationResult> {
  const files = safeFiles(input.files);
  if (files.length === 0) return { status: "EMPTY", files: [], conflicts: [] };
  await cleanupExpiredAndTerminal();

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE ai_platform.ai_coding_active_file_reservations
      SET expires_at = NOW() + (${RESERVATION_TTL_HOURS} || ' hours')::interval,
          run_id = COALESCE(${input.runId ?? null}, run_id)
      WHERE repository = ${input.repository}
        AND branch = ${input.branch}
        AND task_id = ${input.taskId}
        AND file_path = ANY(${files}::text[])
    `);

    for (const file of files) {
      await tx.execute(sql`
        INSERT INTO ai_platform.ai_coding_active_file_reservations (
          reservation_id, repository, branch, file_path, task_id, run_id, expires_at
        )
        VALUES (
          ${randomUUID()}::uuid,
          ${input.repository},
          ${input.branch},
          ${file},
          ${input.taskId},
          ${input.runId ?? null},
          NOW() + (${RESERVATION_TTL_HOURS} || ' hours')::interval
        )
        ON CONFLICT (repository, branch, file_path) DO NOTHING
      `);
    }

    const conflictRows = await tx.execute(sql`
      SELECT file_path, task_id, run_id, reserved_at, expires_at
      FROM ai_platform.ai_coding_active_file_reservations
      WHERE repository = ${input.repository}
        AND branch = ${input.branch}
        AND file_path = ANY(${files}::text[])
        AND task_id <> ${input.taskId}
      ORDER BY file_path
    `);
    const conflicts = Array.isArray(conflictRows.rows)
      ? conflictRows.rows.map((row) => rowConflict(row as Record<string, unknown>))
      : [];

    if (conflicts.length > 0) {
      await tx.execute(sql`
        DELETE FROM ai_platform.ai_coding_active_file_reservations
        WHERE repository = ${input.repository}
          AND branch = ${input.branch}
          AND task_id = ${input.taskId}
          AND file_path = ANY(${files}::text[])
      `);
      return { status: "CONFLICT" as const, files, conflicts };
    }

    return { status: "RESERVED" as const, files, conflicts: [] };
  });
}

export async function releaseCodingFileReservations(taskId: string): Promise<number> {
  await ensureTable();
  const result = await db.execute(sql`
    DELETE FROM ai_platform.ai_coding_active_file_reservations
    WHERE task_id = ${taskId}
    RETURNING reservation_id
  `);
  return Array.isArray(result.rows) ? result.rows.length : 0;
}

export async function getCodingConflictMatrix(): Promise<{
  reservations: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
}> {
  await cleanupExpiredAndTerminal();
  const rows = await db.execute(sql`
    SELECT repository, branch, file_path, task_id, run_id, reserved_at, expires_at
    FROM ai_platform.ai_coding_active_file_reservations
    ORDER BY repository, branch, file_path
    LIMIT 500
  `);
  const reservations = Array.isArray(rows.rows)
    ? rows.rows.map((row) => ({ ...(row as Record<string, unknown>) }))
    : [];

  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const row of reservations) {
    const key = `${String(row["repository"])}|${String(row["branch"])}|${String(row["file_path"])}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  const conflicts = [...grouped.entries()]
    .filter(([, list]) => new Set(list.map((row) => String(row["task_id"]))).size > 1)
    .map(([key, list]) => ({ key, reservations: list }));
  return { reservations, conflicts };
}
