/**
 * memoryService — unified read/write interface for all 4 memory tiers:
 *   1. Global Memory   → ai_memory where agentId = "global"
 *   2. Client Memory   → ai_client_memory keyed by clientId (brand name)
 *   3. Project Memory  → ai_memory where agentId = "project:{projectId}"
 *   4. Agent Memory    → ai_memory where agentId = "{agentSlug}"
 */

import { eq, and, gt, isNull, or, desc } from "drizzle-orm";
import {
  db,
  aiMemoryTable,
  aiClientMemoryTable,
} from "@workspace/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  key: string;
  value: string;
  importance?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface ClientMemoryEntry {
  key: string;
  value: string;
  valueType: string;
  category?: string | null;
  source: string;
  confidence?: number | null;
}

// ── Global Memory ─────────────────────────────────────────────────────────────

export async function getGlobalMemory(): Promise<MemoryEntry[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(aiMemoryTable)
    .where(
      and(
        eq(aiMemoryTable.agentId, "global"),
        or(isNull(aiMemoryTable.expiresAt), gt(aiMemoryTable.expiresAt, now)),
      ),
    )
    .orderBy(desc(aiMemoryTable.createdAt))
    .limit(50);

  return rows.map((r) => ({
    key: r.key ?? "",
    value: r.content,
    importance: r.importance != null ? Number(r.importance) : null,
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
  }));
}

export async function writeGlobalMemory(key: string, value: string, metadata?: Record<string, unknown>) {
  await db.insert(aiMemoryTable).values({
    agentId: "global",
    memoryType: "long_term",
    key,
    content: value,
    importance: "0.700",
    metadata: metadata ?? null,
  });
}

// ── Project Memory ────────────────────────────────────────────────────────────

export async function getProjectMemory(projectId: string): Promise<MemoryEntry[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(aiMemoryTable)
    .where(
      and(
        eq(aiMemoryTable.agentId, `project:${projectId}`),
        or(isNull(aiMemoryTable.expiresAt), gt(aiMemoryTable.expiresAt, now)),
      ),
    )
    .orderBy(desc(aiMemoryTable.createdAt))
    .limit(20);

  return rows.map((r) => ({
    key: r.key ?? "",
    value: r.content,
    importance: r.importance != null ? Number(r.importance) : null,
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
  }));
}

export async function writeProjectMemory(
  projectId: string,
  key: string,
  value: string,
  metadata?: Record<string, unknown>,
) {
  await db.insert(aiMemoryTable).values({
    agentId: `project:${projectId}`,
    memoryType: "episodic",
    key,
    content: value,
    importance: "0.800",
    metadata: metadata ?? null,
  });
}

// ── Agent Memory ──────────────────────────────────────────────────────────────

export async function getAgentMemory(agentSlug: string, limit = 20): Promise<MemoryEntry[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(aiMemoryTable)
    .where(
      and(
        eq(aiMemoryTable.agentId, agentSlug),
        or(isNull(aiMemoryTable.expiresAt), gt(aiMemoryTable.expiresAt, now)),
      ),
    )
    .orderBy(desc(aiMemoryTable.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    key: r.key ?? "",
    value: r.content,
    importance: r.importance != null ? Number(r.importance) : null,
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
  }));
}

export async function writeAgentMemory(
  agentSlug: string,
  key: string,
  value: string,
  metadata?: Record<string, unknown>,
) {
  await db.insert(aiMemoryTable).values({
    agentId: agentSlug,
    memoryType: "long_term",
    key,
    content: value,
    importance: "0.600",
    metadata: metadata ?? null,
  });
}

// ── Client Memory ─────────────────────────────────────────────────────────────

export async function getClientMemory(clientId: string): Promise<ClientMemoryEntry[]> {
  const rows = await db
    .select()
    .from(aiClientMemoryTable)
    .where(eq(aiClientMemoryTable.clientId, clientId))
    .orderBy(aiClientMemoryTable.category, aiClientMemoryTable.key);

  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    valueType: r.valueType,
    category: r.category ?? null,
    source: r.source,
    confidence: r.confidence != null ? Number(r.confidence) : null,
  }));
}

export async function upsertClientMemory(
  clientId: string,
  key: string,
  value: string,
  opts: {
    valueType?: string;
    category?: string;
    source?: string;
    confidence?: number;
    metadata?: Record<string, unknown>;
  } = {},
) {
  const existing = await db
    .select()
    .from(aiClientMemoryTable)
    .where(and(eq(aiClientMemoryTable.clientId, clientId), eq(aiClientMemoryTable.key, key)));

  if (existing.length > 0) {
    await db
      .update(aiClientMemoryTable)
      .set({
        value,
        valueType: opts.valueType ?? "string",
        category: opts.category,
        source: opts.source ?? "manual",
        confidence: opts.confidence != null ? String(opts.confidence) : null,
        metadata: opts.metadata ?? null,
      })
      .where(and(eq(aiClientMemoryTable.clientId, clientId), eq(aiClientMemoryTable.key, key)));
  } else {
    await db.insert(aiClientMemoryTable).values({
      clientId,
      key,
      value,
      valueType: opts.valueType ?? "string",
      category: opts.category,
      source: opts.source ?? "manual",
      confidence: opts.confidence != null ? String(opts.confidence) : null,
      metadata: opts.metadata ?? null,
    });
  }
}

export async function deleteClientMemoryKey(clientId: string, key: string) {
  await db
    .delete(aiClientMemoryTable)
    .where(and(eq(aiClientMemoryTable.clientId, clientId), eq(aiClientMemoryTable.key, key)));
}

/** Convert client memory array into a flat key→value record for prompt injection. */
export function clientMemoryToRecord(entries: ClientMemoryEntry[]): Record<string, string> {
  return Object.fromEntries(entries.map((e) => [e.key, e.value]));
}
