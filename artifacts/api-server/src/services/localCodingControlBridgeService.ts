import { randomUUID } from "crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  aiCodingBridgeCommandsTable,
  aiCodingBridgePresenceTable,
  aiCodingBridgeResponsesTable,
  db,
} from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";
import { notifyCodingBridgeResponse } from "./codingWhatsappNotificationService.js";
import { ensureCodingControlBridgeTables } from "./codingControlBridgeSchemaService.js";
import { ensureGcpCodingWorkerStarted } from "./gcpCodingWorkerLifecycleService.js";

const DEFAULT_LEASE_SECONDS = 180;
const MAX_LEASE_SECONDS = 300;
const DEFAULT_COMMAND_LEASE_SECONDS = 300;

function boundedLeaseSeconds(value: number | undefined, fallback: number): number {
  return Math.max(30, Math.min(MAX_LEASE_SECONDS, Math.floor(value ?? fallback)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const GITHUB_REPOSITORY = "Travelintrips/Core-AI-Foundation";

function githubIssueNumberFromCommand(command: {
  source?: string | null;
  metadataJson?: unknown;
}): number | null {
  if (command.source !== "github-trigger" || !isRecord(command.metadataJson)) {
    return null;
  }
  const value = command.metadataJson["issueNumber"];
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

async function syncTerminalBridgeResponseToGitHub(input: {
  responseId: string;
  commandId: string;
  taskId: string | null;
  kind: "BLOCKER" | "COMPLETED" | "FAILED";
}): Promise<void> {
  const token = process.env["AI_CODING_GITHUB_TOKEN"]?.trim();
  if (!token) return;

  const [command] = await db
    .select()
    .from(aiCodingBridgeCommandsTable)
    .where(eq(aiCodingBridgeCommandsTable.id, input.commandId))
    .limit(1);
  if (!command) return;

  const issueNumber = githubIssueNumberFromCommand(command);
  if (!issueNumber) return;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const terminalLabel =
    input.kind === "COMPLETED"
      ? "completed"
      : input.kind === "FAILED"
        ? "failed"
        : "blocked";
  const commentResponse = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        body:
          `AI Core terminal callback: **${terminalLabel.toUpperCase()}**\n\n` +
          `- Task: ${input.taskId ?? "unknown"}\n` +
          `- Bridge response: ${input.responseId}\n` +
          `- Source: AI Core coding bridge\n\n` +
          (input.kind === "COMPLETED"
            ? "The originating AI Core task reached a terminal completed state."
            : "The originating AI Core task requires follow-up and remains open."),
      }),
    },
  );
  if (!commentResponse.ok) {
    throw new Error(
      `GitHub terminal callback comment failed with HTTP ${commentResponse.status}`,
    );
  }

  if (input.kind !== "COMPLETED") return;

  const closeResponse = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${issueNumber}`,
    {
      method: "PATCH",
      headers,
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ state: "closed", state_reason: "completed" }),
    },
  );
  if (!closeResponse.ok) {
    throw new Error(
      `GitHub terminal callback close failed with HTTP ${closeResponse.status}`,
    );
  }
}

export async function submitCodingBridgeCommand(input: {
  externalCommandId: string;
  instruction: string;
  taskId?: string | null;
  source?: string;
  commandType?: string;
  assignedClientId?: string | null;
  authority?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  await ensureCodingControlBridgeTables();
  const source = input.source ?? "chatgpt";
  const [existing] = await db
    .select()
    .from(aiCodingBridgeCommandsTable)
    .where(
      and(
        eq(aiCodingBridgeCommandsTable.source, source),
        eq(aiCodingBridgeCommandsTable.externalCommandId, input.externalCommandId),
      ),
    )
    .limit(1);
  if (existing) return { command: existing, created: false };

  const metadataJson = {
    ...(input.metadata ?? {}),
    ...(input.assignedClientId
      ? { assignedClientId: input.assignedClientId }
      : {}),
  };

  const [command] = await db
    .insert(aiCodingBridgeCommandsTable)
    .values({
      taskId: input.taskId ?? null,
      externalCommandId: input.externalCommandId,
      source,
      commandType: input.commandType ?? "INSTRUCTION",
      instruction: input.instruction,
      authorityJson: input.authority ?? {},
      metadataJson,
    })
    .returning();
  if (!command) throw new Error("Failed to persist bridge command");

  await db.insert(aiCodingBridgeResponsesTable).values({
    commandId: command.id,
    taskId: command.taskId,
    kind: "ACK",
    message: input.assignedClientId
      ? `Command queued for ${input.assignedClientId} by AI Core.`
      : "Command received by AI Core.",
    checkpointJson: { status: command.status },
  });

  publishSafe({
    eventType: "coding.bridge.command.received",
    sourceModule: "coding-control-bridge",
    sourceId: command.id,
    correlationId: command.id,
    payload: {
      commandId: command.id,
      taskId: command.taskId,
      commandType: command.commandType,
      assignedClientId: input.assignedClientId ?? null,
    },
  });

  if (input.assignedClientId) {
    void ensureGcpCodingWorkerStarted().catch(() => undefined);
  }

  return { command, created: true };
}

export async function appendCodingBridgeResponse(input: {
  commandId: string;
  taskId?: string | null;
  kind:
    | "ACK"
    | "PROGRESS"
    | "CHECKPOINT"
    | "BLOCKER"
    | "COMPLETED"
    | "FAILED";
  message: string;
  checkpoint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  await ensureCodingControlBridgeTables();
  const [response] = await db
    .insert(aiCodingBridgeResponsesTable)
    .values({
      commandId: input.commandId,
      taskId: input.taskId ?? null,
      kind: input.kind,
      message: input.message,
      checkpointJson: input.checkpoint ?? {},
      metadataJson: input.metadata ?? {},
    })
    .returning();
  if (!response) throw new Error("Failed to persist bridge response");

  publishSafe({
    eventType: "coding.bridge.response.created",
    sourceModule: "coding-control-bridge",
    sourceId: response.id,
    correlationId: input.commandId,
    payload: {
      responseId: response.id,
      commandId: input.commandId,
      kind: input.kind,
    },
  });

  void notifyCodingBridgeResponse({
    responseId: response.id,
    commandId: input.commandId,
    taskId: input.taskId ?? null,
    kind: input.kind,
    message: input.message,
  });

  if (
    input.kind === "COMPLETED" ||
    input.kind === "FAILED" ||
    input.kind === "BLOCKER"
  ) {
    void syncTerminalBridgeResponseToGitHub({
      responseId: response.id,
      commandId: input.commandId,
      taskId: input.taskId ?? null,
      kind: input.kind,
    }).catch(() => undefined);
  }

  return response;
}

export async function listPendingCodingBridgeResponses(limit = 50) {
  await ensureCodingControlBridgeTables();
  return db
    .select()
    .from(aiCodingBridgeResponsesTable)
    .where(isNull(aiCodingBridgeResponsesTable.acknowledgedAt))
    .orderBy(asc(aiCodingBridgeResponsesTable.createdAt))
    .limit(Math.max(1, Math.min(100, limit)));
}

export async function acknowledgeCodingBridgeResponse(id: string) {
  await ensureCodingControlBridgeTables();
  const [row] = await db
    .update(aiCodingBridgeResponsesTable)
    .set({ acknowledgedAt: new Date() })
    .where(eq(aiCodingBridgeResponsesTable.id, id))
    .returning();
  return row ?? null;
}

export async function claimCodingBridgeCommand(input: {
  clientId: string;
  leaseSeconds?: number;
}) {
  await ensureCodingControlBridgeTables();
  const leaseSeconds = boundedLeaseSeconds(
    input.leaseSeconds,
    DEFAULT_COMMAND_LEASE_SECONDS,
  );

  const result = await db.execute(sql`
    WITH candidate AS (
      SELECT id
      FROM ai_platform.ai_coding_bridge_commands
      WHERE metadata_json ->> 'assignedClientId' = ${input.clientId}::text
        AND (
          status = 'RECEIVED'
          OR (
            status = 'PROCESSING'
            AND COALESCE(
              NULLIF(metadata_json ->> 'claimLeaseExpiresAt', '')::timestamptz,
              to_timestamp(0)
            ) <= NOW()
          )
        )
      ORDER BY received_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE ai_platform.ai_coding_bridge_commands AS command
    SET status = 'PROCESSING',
        processed_at = COALESCE(command.processed_at, NOW()),
        metadata_json = command.metadata_json || jsonb_build_object(
          'claimToken', gen_random_uuid()::text,
          'claimLeaseExpiresAt', (NOW() + (${leaseSeconds}::integer * INTERVAL '1 second'))::text,
          'claimedBy', ${input.clientId}::text,
          'claimedAt', NOW()::text
        ),
        updated_at = NOW()
    FROM candidate
    WHERE command.id = candidate.id
    RETURNING
      command.id,
      command.task_id,
      command.external_command_id,
      command.command_type,
      command.instruction,
      command.authority_json,
      command.metadata_json,
      command.status,
      command.received_at
  `);

  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const metadata = isRecord(row["metadata_json"]) ? row["metadata_json"] : {};
  const claimToken =
    typeof metadata["claimToken"] === "string" ? metadata["claimToken"] : "";
  if (!claimToken) {
    throw new Error("Claimed bridge command did not contain a claim token");
  }

  return {
    commandId: String(row["id"]),
    taskId: row["task_id"] ? String(row["task_id"]) : null,
    externalCommandId: String(row["external_command_id"] ?? ""),
    commandType: String(row["command_type"] ?? "INSTRUCTION"),
    instruction: String(row["instruction"] ?? ""),
    authority: isRecord(row["authority_json"]) ? row["authority_json"] : {},
    metadata,
    status: String(row["status"] ?? "PROCESSING"),
    receivedAt: row["received_at"] ?? null,
    claimToken,
    leaseSeconds,
  };
}

export async function renewCodingBridgeCommandClaim(input: {
  clientId: string;
  commandId: string;
  claimToken: string;
  leaseSeconds?: number;
}): Promise<boolean> {
  await ensureCodingControlBridgeTables();
  const leaseSeconds = boundedLeaseSeconds(
    input.leaseSeconds,
    DEFAULT_COMMAND_LEASE_SECONDS,
  );

  const result = await db.execute(sql`
    UPDATE ai_platform.ai_coding_bridge_commands
    SET metadata_json = metadata_json || jsonb_build_object(
          'claimLeaseExpiresAt', (NOW() + (${leaseSeconds}::integer * INTERVAL '1 second'))::text
        ),
        updated_at = NOW()
    WHERE id = ${input.commandId}::uuid
      AND status = 'PROCESSING'
      AND metadata_json ->> 'assignedClientId' = ${input.clientId}::text
      AND metadata_json ->> 'claimToken' = ${input.claimToken}::text
    RETURNING id
  `);

  return Boolean(result.rows?.[0]);
}

export async function completeCodingBridgeCommand(input: {
  clientId: string;
  commandId: string;
  claimToken: string;
  status: "COMPLETED" | "FAILED";
  message: string;
  details?: Record<string, unknown>;
}) {
  await ensureCodingControlBridgeTables();
  const details = input.details ?? {};
  const encoded = JSON.stringify(details);
  if (encoded.length > 64_000) {
    throw new Error("Bridge command result details exceed 64000 bytes");
  }

  const result = await db.execute(sql`
    UPDATE ai_platform.ai_coding_bridge_commands
    SET status = ${input.status},
        processed_at = NOW(),
        metadata_json = (
          metadata_json - 'claimToken' - 'claimLeaseExpiresAt'
        ) || jsonb_build_object(
          'completedBy', ${input.clientId}::text,
          'completedAt', NOW()::text
        ),
        updated_at = NOW()
    WHERE id = ${input.commandId}::uuid
      AND status = 'PROCESSING'
      AND metadata_json ->> 'assignedClientId' = ${input.clientId}::text
      AND metadata_json ->> 'claimToken' = ${input.claimToken}::text
    RETURNING id, task_id
  `);

  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const response = await appendCodingBridgeResponse({
    commandId: input.commandId,
    taskId: row["task_id"] ? String(row["task_id"]) : null,
    kind: input.status,
    message: input.message,
    checkpoint: {
      status: input.status,
      clientId: input.clientId,
    },
    metadata: details,
  });

  return { commandId: input.commandId, status: input.status, response };
}

export async function getCodingBridgeCommandExecutionState(commandId: string) {
  await ensureCodingControlBridgeTables();
  const [command] = await db
    .select()
    .from(aiCodingBridgeCommandsTable)
    .where(eq(aiCodingBridgeCommandsTable.id, commandId))
    .limit(1);
  if (!command) return null;

  const [latestResponse] = await db
    .select()
    .from(aiCodingBridgeResponsesTable)
    .where(eq(aiCodingBridgeResponsesTable.commandId, commandId))
    .orderBy(desc(aiCodingBridgeResponsesTable.createdAt))
    .limit(1);

  return {
    command,
    latestResponse: latestResponse ?? null,
  };
}

export async function renewCodingBridgePresence(input: {
  clientId: string;
  source?: string;
  leaseSeconds?: number;
  metadata?: Record<string, unknown>;
}) {
  await ensureCodingControlBridgeTables();
  const seconds = boundedLeaseSeconds(input.leaseSeconds, DEFAULT_LEASE_SECONDS);
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + seconds * 1000);
  const leaseToken = randomUUID();
  const insertValues = {
    clientId: input.clientId,
    source: input.source ?? "chatgpt",
    leaseToken,
    leaseExpiresAt,
    lastSeenAt: now,
    metadataJson: input.metadata ?? {},
  };
  const updateValues = {
    source: input.source ?? "chatgpt",
    leaseToken,
    leaseExpiresAt,
    lastSeenAt: now,
    metadataJson: input.metadata ?? {},
    updatedAt: now,
  };
  const [row] = await db
    .insert(aiCodingBridgePresenceTable)
    .values(insertValues)
    .onConflictDoUpdate({
      target: aiCodingBridgePresenceTable.clientId,
      set: updateValues,
    })
    .returning();
  if (!row) throw new Error("Failed to renew bridge presence");
  return row;
}

export async function getCodingBridgeAvailability(clientId: string) {
  await ensureCodingControlBridgeTables();
  const [row] = await db
    .select()
    .from(aiCodingBridgePresenceTable)
    .where(eq(aiCodingBridgePresenceTable.clientId, clientId))
    .limit(1);
  if (!row) {
    return {
      clientId,
      state: "UNAVAILABLE" as const,
      leaseExpiresAt: null,
      lastSeenAt: null,
    };
  }
  return {
    clientId,
    state:
      row.leaseExpiresAt.getTime() > Date.now()
        ? ("ACTIVE" as const)
        : ("UNAVAILABLE" as const),
    leaseExpiresAt: row.leaseExpiresAt,
    lastSeenAt: row.lastSeenAt,
  };
}
