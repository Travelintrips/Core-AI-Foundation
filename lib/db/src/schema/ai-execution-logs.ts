import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";

/**
 * ai_execution_logs — granular per-request AI observability.
 * Every AI call (job worker or creative workflow) writes one row here.
 * Never blocks the caller — writes are always fire-and-forget.
 */
export const aiExecutionLogsTable = appSchema.table(
  "ai_execution_logs",
  {
    id: serial("id").primaryKey(),

    // ── Scope identifiers ────────────────────────────────────────────────
    companyId:      text("company_id"),       // future: multi-tenant company
    workflowId:     integer("workflow_id"),   // ai_workflows.id
    jobId:          integer("job_id"),        // ai_jobs.id
    orderId:        text("order_id"),         // service request / order ref
    conversationId: text("conversation_id"),  // future: chat session

    // ── Agent / model ────────────────────────────────────────────────────
    agentId:        integer("agent_id"),      // ai_agents.id
    agentName:      text("agent_name"),       // human-readable slug/name

    // ── Provider / model ─────────────────────────────────────────────────
    providerId:     integer("provider_id"),   // ai_providers.id
    providerName:   text("provider_name"),    // e.g. "openai"
    modelId:        integer("model_id"),      // ai_models.id
    modelName:      text("model_name"),       // e.g. "gpt-4o"

    // ── Request metadata ─────────────────────────────────────────────────
    requestType: text("request_type").notNull().default("text"), // text | image | embedding

    // ── Token accounting ─────────────────────────────────────────────────
    promptTokens:     integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cachedTokens:     integer("cached_tokens").notNull().default(0),
    reasoningTokens:  integer("reasoning_tokens").notNull().default(0),
    totalTokens:      integer("total_tokens").notNull().default(0),

    // ── Cost ─────────────────────────────────────────────────────────────
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 14, scale: 8 }),
    currency: text("currency").notNull().default("USD"),

    // ── Performance ──────────────────────────────────────────────────────
    latencyMs:  integer("latency_ms"),
    startedAt:  timestamp("started_at",  { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    // ── Outcome ──────────────────────────────────────────────────────────
    status:       text("status").notNull().default("success"), // success | failed | timeout | retried
    errorMessage: text("error_message"),
    retryCount:   integer("retry_count").notNull().default(0),

    // ── Audit ────────────────────────────────────────────────────────────
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_execution_logs_job_id_idx").on(t.jobId),
    index("ai_execution_logs_workflow_id_idx").on(t.workflowId),
    index("ai_execution_logs_created_at_idx").on(t.createdAt),
    index("ai_execution_logs_provider_name_idx").on(t.providerName),
    index("ai_execution_logs_agent_name_idx").on(t.agentName),
  ],
);

export type AiExecutionLog = typeof aiExecutionLogsTable.$inferSelect;
export type InsertAiExecutionLog = typeof aiExecutionLogsTable.$inferInsert;
