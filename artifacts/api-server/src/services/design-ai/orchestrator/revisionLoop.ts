/**
 * Revision Loop
 *
 * Executes up to MAX_REVISION_CYCLES of QA → deterministic gate → revision router.
 * If the gate passes within the cycle limit, returns the passing report.
 * If cycles are exhausted, returns status "needs_human_review".
 *
 * Rules:
 *  - Max 2 revision cycles
 *  - No infinite loop possible
 *  - Only relevant downstream agents are flagged for rerun (not the full pipeline)
 *  - Revision history is recorded on every cycle
 *  - The orchestrator controls the actual agent reruns; the loop only decides
 *    what needs to change and tracks history
 */

import { runArtDirectorQaAgent } from "../agents/qa/artDirectorQaAgent.js";
import { runQaGate } from "./qaGate.js";
import { routeRevision } from "./revisionRouter.js";
import type { ArtDirectorQaInput, ArtDirectorQaReport } from "../types/qa.types.js";
import type {
  RevisionHistoryEntry,
  DesignGenerationStatus,
} from "../types/orchestrator.types.js";
import type { RevisionTarget } from "../types/qa.types.js";

export const MAX_REVISION_CYCLES = 2;

export interface RevisionLoopInput {
  qaInput: ArtDirectorQaInput;
  /** Called at the end of each failed cycle to perform the actual agent reruns.
   *  Returns updated qaInput for the next cycle.
   *  If null is returned, the loop aborts with "needs_human_review". */
  onRevisionRequired: (
    targetAgent: RevisionTarget | undefined,
    issueCodes: string[],
    cycle: number,
  ) => Promise<ArtDirectorQaInput | null>;
}

export interface RevisionLoopResult {
  status: DesignGenerationStatus;
  finalQaReport: ArtDirectorQaReport | null;
  revisionHistory: RevisionHistoryEntry[];
  revisionCount: number;
}

export async function runRevisionLoop(input: RevisionLoopInput): Promise<RevisionLoopResult> {
  const revisionHistory: RevisionHistoryEntry[] = [];
  let currentQaInput = input.qaInput;
  let cycle = 0;

  while (true) {
    // ── Run QA agent ──────────────────────────────────────────────────────────
    const qaResult = await runArtDirectorQaAgent(currentQaInput);

    if (qaResult.status !== "success" || !qaResult.data) {
      return {
        status: "failed",
        finalQaReport: null,
        revisionHistory,
        revisionCount: cycle,
      };
    }

    const qaReport = qaResult.data;

    // ── Run deterministic gate ────────────────────────────────────────────────
    const gate = runQaGate(qaReport, currentQaInput.engineering);

    if (gate.publishReady) {
      return {
        status: "ready",
        finalQaReport: qaReport,
        revisionHistory,
        revisionCount: cycle,
      };
    }

    // ── Gate failed — decide on revision ─────────────────────────────────────
    const revisionDecision = routeRevision(qaReport);

    if (cycle >= MAX_REVISION_CYCLES) {
      // Revision cycles exhausted
      revisionHistory.push({
        cycle: cycle + 1,
        targetAgent: revisionDecision.targetAgent ?? ("optimizer" as RevisionTarget),
        issueCodes: revisionDecision.issueCodes,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        outcome: "unresolved",
      });

      return {
        status: "needs_human_review",
        finalQaReport: qaReport,
        revisionHistory,
        revisionCount: cycle,
      };
    }

    // ── Execute revision ──────────────────────────────────────────────────────
    cycle++;
    const cycleStartedAt = new Date().toISOString();

    const updatedQaInput = await input.onRevisionRequired(
      revisionDecision.targetAgent,
      revisionDecision.issueCodes,
      cycle,
    );

    const cycleCompletedAt = new Date().toISOString();

    revisionHistory.push({
      cycle,
      targetAgent: revisionDecision.targetAgent ?? ("optimizer" as RevisionTarget),
      issueCodes: revisionDecision.issueCodes,
      startedAt: cycleStartedAt,
      completedAt: cycleCompletedAt,
      outcome: updatedQaInput ? "resolved" : "failed",
    });

    if (!updatedQaInput) {
      return {
        status: "needs_human_review",
        finalQaReport: qaReport,
        revisionHistory,
        revisionCount: cycle,
      };
    }

    currentQaInput = updatedQaInput;
  }
}
