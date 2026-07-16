/**
 * Design AI Orchestrator — public exports
 */

export { generateDesignTemplate } from "./designAiOrchestrator.js";
export { runQaGate, PUBLISH_SCORE_THRESHOLD } from "./qaGate.js";
export { routeRevision } from "./revisionRouter.js";
export { runRevisionLoop, MAX_REVISION_CYCLES } from "./revisionLoop.js";
export { ISSUE_CODE_TO_AGENT, REVISION_PRIORITY_ORDER, DOWNSTREAM_RERUN } from "./revisionRules.js";
export { initPipelineStages, updateStage, markStageRunning, markStageComplete } from "./pipelineState.js";
export { aggregateMetrics, buildAgentMetric, emptyMetrics } from "./pipelineMetrics.js";

export type { GenerateDesignTemplateInput, DesignGenerationResult } from "../types/orchestrator.types.js";
export type { ArtDirectorQaReport, QaGateResult, RevisionDecision } from "../types/qa.types.js";
export { isMultiAgentDesignEnabled } from "../types/orchestrator.types.js";
