/**
 * Recover passive AI Core -> AI Task terminal notifications after timeouts,
 * process crashes or receiver outages. AI Core's persisted task is the outbox:
 * no worker dispatch, status mutation or new database table is involved.
 */
import { and, desc, gte, inArray } from "drizzle-orm";
import { aiCodingTasksTable, db } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  ledgerBridgeEnabled,
  mirrorAiTaskLedgerSourceState,
} from "./aiTaskLedgerBridgeService.js";

const POLL_MS = 60_000;
const PAGE_SIZE = 8;
const MAX_PARALLEL = 2;
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

export interface TerminalLedgerSourceRow {
  id: string;
  taskNumber: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

type Publish = typeof mirrorAiTaskLedgerSourceState;
type ReconciliationDependencies = {
  enabled?: () => boolean;
  now?: () => number;
  load?: (offset: number, since: Date) => Promise<TerminalLedgerSourceRow[]>;
  publish?: Publish;
};

async function loadTerminalTasks(
  offset: number,
  since: Date,
): Promise<TerminalLedgerSourceRow[]> {
  return db.select({
    id: aiCodingTasksTable.id,
    taskNumber: aiCodingTasksTable.taskNumber,
    status: aiCodingTasksTable.status,
    createdAt: aiCodingTasksTable.createdAt,
    updatedAt: aiCodingTasksTable.updatedAt,
  })
    .from(aiCodingTasksTable)
    .where(and(
      inArray(aiCodingTasksTable.status, ["COMPLETED", "FAILED"]),
      gte(aiCodingTasksTable.createdAt, since),
    ))
    .orderBy(desc(aiCodingTasksTable.createdAt), desc(aiCodingTasksTable.id))
    .limit(PAGE_SIZE)
    .offset(offset);
}

type RetryState = {
  signature: string;
  attempts: number;
  nextAttemptAt: number;
  acknowledged: boolean;
};

export function createAiTaskLedgerReconciler(deps: ReconciliationDependencies = {}) {
  const enabled = deps.enabled ?? ledgerBridgeEnabled;
  const now = deps.now ?? Date.now;
  const load = deps.load ?? loadTerminalTasks;
  const publish = deps.publish ?? mirrorAiTaskLedgerSourceState;
  const attempts = new Map<string, RetryState>();
  let pageOffset = 0;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<{
    scanned: number;
    attempted: number;
    acknowledged: number;
    pending: number;
  }> {
    const empty = { scanned: 0, attempted: 0, acknowledged: 0, pending: 0 };
    if (!enabled() || running) return empty;
    running = true;
    try {
      const rows = await load(pageOffset, new Date(now() - LOOKBACK_MS));
      pageOffset = rows.length < PAGE_SIZE ? 0 : pageOffset + PAGE_SIZE;

      let attempted = 0;
      let acknowledged = 0;
      let pending = 0;
      const eligible = rows.filter((row) => {
        if (row.status !== "COMPLETED" && row.status !== "FAILED") return false;
        const signature = [row.status, row.updatedAt.toISOString()].join(":");
        const previous = attempts.get(row.id);
        return !previous || previous.signature !== signature ||
          (!previous.acknowledged && previous.nextAttemptAt <= now());
      });

      for (let i = 0; i < eligible.length; i += MAX_PARALLEL) {
        await Promise.all(eligible.slice(i, i + MAX_PARALLEL).map(async (row) => {
          const signature = [row.status, row.updatedAt.toISOString()].join(":");
          const previous = attempts.get(row.id);
          const attempt = previous?.signature === signature ? previous.attempts + 1 : 1;
          attempted += 1;
          try {
            const receipt = await publish({
              externalId: "coding-task:" + row.id,
              title: "AI Core coding task " + row.taskNumber,
              status: row.status,
              // Stable across retries and restarts; the receiver verifies
              // the canonical record before accepting any state transition.
              version: "terminal",
            });
            if (receipt.acknowledged === true) {
              acknowledged += 1;
              attempts.set(row.id, {
                signature, attempts: attempt, nextAttemptAt: 0, acknowledged: true,
              });
              return;
            }
            pending += 1;
            attempts.set(row.id, {
              signature,
              attempts: attempt,
              nextAttemptAt: now() + (receipt.synced ? POLL_MS : Math.min(
                MAX_BACKOFF_MS, POLL_MS * (2 ** Math.min(attempt - 1, 4)),
              )),
              acknowledged: false,
            });
          } catch {
            pending += 1;
            attempts.set(row.id, {
              signature,
              attempts: attempt,
              nextAttemptAt: now() + Math.min(
                MAX_BACKOFF_MS, POLL_MS * (2 ** Math.min(attempt - 1, 4)),
              ),
              acknowledged: false,
            });
          }
        }));
      }

      if (attempted > 0) {
        logger.info({ scanned: rows.length, attempted, acknowledged, pending },
          "[ai-task-ledger] terminal reconciliation batch");
      }
      if (attempts.size > 5000) attempts.clear();
      return { scanned: rows.length, attempted, acknowledged, pending };
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (!enabled() || timer) return;
    const run = () => void tick().catch((error: unknown) => {
      logger.warn({ error }, "[ai-task-ledger] reconciliation will retry");
    });
    run();
    timer = setInterval(run, POLL_MS);
    timer.unref?.();
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { tick, start, stop };
}

const reconciler = createAiTaskLedgerReconciler();

export function startAiTaskLedgerReconciliationRuntime(): void {
  reconciler.start();
}
