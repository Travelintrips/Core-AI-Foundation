/**
 * Recover passive AI Core -> AI Task terminal notifications after timeouts,
 * process crashes or receiver outages. AI Core's persisted task/workstream is
 * the outbox: no worker dispatch, status mutation or new database table is
 * involved.
 */
import { and, desc, gte, inArray } from "drizzle-orm";
import {
  aiCodingTasksTable,
  aiCodingWorkstreamsTable,
  db,
} from "@workspace/db";
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

type TerminalLedgerSourceKind = "coding-task" | "coding-workstream";

export interface TerminalLedgerSourceRow {
  id: string;
  /** Task number for coding tasks; workstream key for coding workstreams. */
  taskNumber: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  sourceKind?: TerminalLedgerSourceKind;
  sessionId?: string | null;
}

type Publish = typeof mirrorAiTaskLedgerSourceState;
type Load = (offset: number, since: Date) => Promise<TerminalLedgerSourceRow[]>;
type ReconciliationDependencies = {
  enabled?: () => boolean;
  now?: () => number;
  /** Legacy combined loader retained for focused tests and bounded diagnostics. */
  load?: Load;
  loadTasks?: Load;
  loadWorkstreams?: Load;
  publish?: Publish;
};

async function loadTerminalTasks(
  offset: number,
  since: Date,
): Promise<TerminalLedgerSourceRow[]> {
  const rows = await db.select({
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

  return rows.map((row) => ({ ...row, sourceKind: "coding-task" as const }));
}

async function loadTerminalWorkstreams(
  offset: number,
  since: Date,
): Promise<TerminalLedgerSourceRow[]> {
  const rows = await db.select({
    id: aiCodingWorkstreamsTable.id,
    taskNumber: aiCodingWorkstreamsTable.workstreamKey,
    status: aiCodingWorkstreamsTable.status,
    createdAt: aiCodingWorkstreamsTable.createdAt,
    updatedAt: aiCodingWorkstreamsTable.updatedAt,
    sessionId: aiCodingWorkstreamsTable.graphId,
  })
    .from(aiCodingWorkstreamsTable)
    .where(and(
      inArray(aiCodingWorkstreamsTable.status, ["COMPLETED", "FAILED"]),
      gte(aiCodingWorkstreamsTable.createdAt, since),
    ))
    .orderBy(desc(aiCodingWorkstreamsTable.createdAt), desc(aiCodingWorkstreamsTable.id))
    .limit(PAGE_SIZE)
    .offset(offset);

  return rows.map((row) => ({
    ...row,
    sourceKind: "coding-workstream" as const,
  }));
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
  const customLoad = deps.load;
  const loadTasks = deps.loadTasks ?? loadTerminalTasks;
  const loadWorkstreams = deps.loadWorkstreams ?? loadTerminalWorkstreams;
  const publish = deps.publish ?? mirrorAiTaskLedgerSourceState;
  const attempts = new Map<string, RetryState>();
  let pageOffset = 0;
  let taskPageOffset = 0;
  let workstreamPageOffset = 0;
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
      const since = new Date(now() - LOOKBACK_MS);
      let rows: TerminalLedgerSourceRow[];

      if (customLoad) {
        rows = await customLoad(pageOffset, since);
        pageOffset = rows.length < PAGE_SIZE ? 0 : pageOffset + PAGE_SIZE;
      } else {
        const [tasks, workstreams] = await Promise.all([
          loadTasks(taskPageOffset, since),
          loadWorkstreams(workstreamPageOffset, since),
        ]);
        taskPageOffset = tasks.length < PAGE_SIZE ? 0 : taskPageOffset + PAGE_SIZE;
        workstreamPageOffset = workstreams.length < PAGE_SIZE
          ? 0
          : workstreamPageOffset + PAGE_SIZE;
        rows = [...tasks, ...workstreams]
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      }

      let attempted = 0;
      let acknowledged = 0;
      let pending = 0;
      const eligible = rows.filter((row) => {
        if (row.status !== "COMPLETED" && row.status !== "FAILED") return false;
        const sourceKind = row.sourceKind ?? "coding-task";
        const key = sourceKind + ":" + row.id;
        const signature = [row.status, row.updatedAt.toISOString()].join(":");
        const previous = attempts.get(key);
        return !previous || previous.signature !== signature ||
          (!previous.acknowledged && previous.nextAttemptAt <= now());
      });

      for (let i = 0; i < eligible.length; i += MAX_PARALLEL) {
        await Promise.all(eligible.slice(i, i + MAX_PARALLEL).map(async (row) => {
          const sourceKind = row.sourceKind ?? "coding-task";
          const key = sourceKind + ":" + row.id;
          const signature = [row.status, row.updatedAt.toISOString()].join(":");
          const previous = attempts.get(key);
          const attempt = previous?.signature === signature ? previous.attempts + 1 : 1;
          attempted += 1;
          try {
            const receipt = await publish({
              externalId: sourceKind + ":" + row.id,
              title: sourceKind === "coding-workstream"
                ? "AI Core workstream " + row.taskNumber
                : "AI Core coding task " + row.taskNumber,
              ...(sourceKind === "coding-workstream" && row.sessionId
                ? { sessionId: row.sessionId }
                : {}),
              status: row.status,
              // Stable across retries and restarts; the receiver verifies
              // the canonical record before accepting any state transition.
              version: "terminal",
            });
            if (receipt.acknowledged === true) {
              acknowledged += 1;
              attempts.set(key, {
                signature, attempts: attempt, nextAttemptAt: 0, acknowledged: true,
              });
              return;
            }
            pending += 1;
            attempts.set(key, {
              signature,
              attempts: attempt,
              nextAttemptAt: now() + (receipt.synced ? POLL_MS : Math.min(
                MAX_BACKOFF_MS, POLL_MS * (2 ** Math.min(attempt - 1, 4)),
              )),
              acknowledged: false,
            });
          } catch {
            pending += 1;
            attempts.set(key, {
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
