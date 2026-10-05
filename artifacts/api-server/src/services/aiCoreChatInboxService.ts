import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type AiCoreInboxEventType =
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "MERGED"
  | "DEPLOYED";

type BridgeKind =
  | "ACK"
  | "PROGRESS"
  | "CHECKPOINT"
  | "BLOCKER"
  | "COMPLETED"
  | "FAILED";

const TERMINAL_EVENT_TYPES = new Set<AiCoreInboxEventType>([
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "MERGED",
  "DEPLOYED",
]);

let ensurePromise: Promise<void> | null = null;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function explicitEventType(
  checkpoint: Record<string, unknown>,
  metadata: Record<string, unknown>,
): AiCoreInboxEventType | null {
  for (const value of [checkpoint["eventType"], metadata["eventType"]]) {
    if (typeof value === "string" && TERMINAL_EVENT_TYPES.has(value as AiCoreInboxEventType)) {
      return value as AiCoreInboxEventType;
    }
  }
  return null;
}

export function classifyAiCoreInboxEvent(input: {
  kind: BridgeKind;
  message: string;
  checkpoint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): AiCoreInboxEventType | null {
  const checkpoint = record(input.checkpoint);
  const metadata = record(input.metadata);
  const explicit = explicitEventType(checkpoint, metadata);
  if (explicit) return explicit;

  if (input.kind === "FAILED") return "FAILED";
  if (input.kind === "BLOCKER") return "BLOCKED";
  if (input.kind !== "COMPLETED") return null;

  const haystack = `${input.message} ${JSON.stringify(checkpoint)} ${JSON.stringify(metadata)}`.toLowerCase();
  if (/\bdeploy(?:ed|ment)?\b/.test(haystack) && /(success|succeed|completed|selesai|deployed)/.test(haystack)) {
    return "DEPLOYED";
  }
  if (/\bmerge(?:d)?\b/.test(haystack)) return "MERGED";
  return "COMPLETED";
}

export async function ensureAiCoreChatInboxTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ai_platform.ai_core_chat_inbox_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          response_id uuid NOT NULL UNIQUE,
          command_id uuid NOT NULL,
          task_id uuid,
          event_type text NOT NULL,
          title text NOT NULL,
          message text NOT NULL,
          read_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_ai_core_chat_inbox_unread
        ON ai_platform.ai_core_chat_inbox_messages (read_at, created_at DESC)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_ai_core_chat_inbox_task
        ON ai_platform.ai_core_chat_inbox_messages (task_id, created_at DESC)
      `);
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}

export async function enqueueAiCoreChatInboxMessage(input: {
  responseId: string;
  commandId: string;
  taskId?: string | null;
  kind: BridgeKind;
  message: string;
  checkpoint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const eventType = classifyAiCoreInboxEvent(input);
  if (!eventType) return;

  await ensureAiCoreChatInboxTable();
  const title =
    eventType === "COMPLETED"
      ? "Task selesai"
      : eventType === "FAILED"
        ? "Task gagal"
        : eventType === "BLOCKED"
          ? "Task membutuhkan perhatian"
          : eventType === "MERGED"
            ? "Perubahan sudah di-merge"
            : "Deployment selesai";

  await db.execute(sql`
    INSERT INTO ai_platform.ai_core_chat_inbox_messages (
      response_id,
      command_id,
      task_id,
      event_type,
      title,
      message
    )
    VALUES (
      ${input.responseId}::uuid,
      ${input.commandId}::uuid,
      ${input.taskId ?? null}::uuid,
      ${eventType}::text,
      ${title}::text,
      ${input.message.trim()}::text
    )
    ON CONFLICT (response_id) DO NOTHING
  `);
}

export async function listAiCoreChatInboxMessages(limit = 50) {
  await ensureAiCoreChatInboxTable();
  const bounded = Math.max(1, Math.min(100, Math.floor(limit || 50)));
  const [messagesResult, unreadResult] = await Promise.all([
    db.execute(sql`
      SELECT
        inbox.id,
        inbox.response_id,
        inbox.command_id,
        inbox.task_id,
        inbox.event_type,
        inbox.title,
        inbox.message,
        inbox.read_at,
        inbox.created_at,
        task.task_number,
        task.project_name,
        task.repository,
        task.branch,
        task.result_summary
      FROM ai_platform.ai_core_chat_inbox_messages AS inbox
      LEFT JOIN ai_platform.ai_coding_tasks AS task
        ON task.id = inbox.task_id
      ORDER BY inbox.created_at DESC
      LIMIT ${bounded}::integer
    `),
    db.execute(sql`
      SELECT COUNT(*)::integer AS count
      FROM ai_platform.ai_core_chat_inbox_messages
      WHERE read_at IS NULL
    `),
  ]);

  const messages = (messagesResult.rows ?? []).map((row) => ({
    id: String(row["id"]),
    responseId: String(row["response_id"]),
    commandId: String(row["command_id"]),
    taskId: row["task_id"] ? String(row["task_id"]) : null,
    taskNumber: row["task_number"] ? String(row["task_number"]) : null,
    projectName: row["project_name"] ? String(row["project_name"]) : null,
    repository: row["repository"] ? String(row["repository"]) : null,
    branch: row["branch"] ? String(row["branch"]) : null,
    eventType: String(row["event_type"]) as AiCoreInboxEventType,
    title: String(row["title"]),
    message: String(row["message"]),
    resultSummary: row["result_summary"] ? String(row["result_summary"]) : null,
    workspaceUrl: row["task_id"] ? `/coding-workspace/${String(row["task_id"])}` : null,
    readAt: row["read_at"] ? String(row["read_at"]) : null,
    createdAt: String(row["created_at"]),
  }));

  const unread = Number(unreadResult.rows?.[0]?.["count"] ?? 0);
  return { messages, unread };
}

export async function markAiCoreChatInboxRead(ids?: string[]): Promise<number> {
  await ensureAiCoreChatInboxTable();
  if (ids?.length) {
    const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
    if (!clean.length) return 0;
    const result = await db.execute(sql`
      UPDATE ai_platform.ai_core_chat_inbox_messages
      SET read_at = COALESCE(read_at, NOW())
      WHERE id = ANY(${clean}::uuid[])
      RETURNING id
    `);
    return result.rows?.length ?? 0;
  }

  const result = await db.execute(sql`
    UPDATE ai_platform.ai_core_chat_inbox_messages
    SET read_at = COALESCE(read_at, NOW())
    WHERE read_at IS NULL
    RETURNING id
  `);
  return result.rows?.length ?? 0;
}
