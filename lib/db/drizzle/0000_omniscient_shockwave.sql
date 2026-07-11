CREATE TABLE "ai_platform"."ai_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key_env_var" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"name" text NOT NULL,
	"model_id" text NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"context_window" integer,
	"max_output_tokens" integer,
	"cost_per_input_token" numeric(12, 8),
	"cost_per_output_token" numeric(12, 8),
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_orchestrator_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_requests" integer DEFAULT 0 NOT NULL,
	"last_model_used" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_orchestrator_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_type" text,
	"trigger_config" jsonb,
	"default_model_id" integer,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"execution_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_workflow_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"inputs" jsonb,
	"outputs" jsonb,
	"step_results" jsonb,
	"error_message" text,
	"tokens_used" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"variables" text[] DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_prompt_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_id" integer NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_knowledge_bases" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"embedding_model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_knowledge_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"knowledge_base_id" integer NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"content_type" text DEFAULT 'text' NOT NULL,
	"source_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"chunk_count" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text,
	"memory_type" text DEFAULT 'short_term' NOT NULL,
	"content" text NOT NULL,
	"key" text,
	"importance" numeric(4, 3),
	"expires_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" text,
	"resource_type" text,
	"actor_id" text,
	"details" jsonb,
	"status" text DEFAULT 'success' NOT NULL,
	"ip_address" text,
	"duration" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"value_type" text DEFAULT 'string' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"description" text,
	"is_secret" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"role" text NOT NULL,
	"description" text,
	"provider_id" integer,
	"model_id" integer,
	"priority" integer DEFAULT 100 NOT NULL,
	"temperature" numeric(4, 2),
	"max_tokens" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"allowed_tools" text[] DEFAULT '{}' NOT NULL,
	"knowledge_base_id" integer,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"owner" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_agent_capabilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."creative_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source_type" text DEFAULT 'direct' NOT NULL,
	"service_request_id" integer,
	"service_quotation_id" integer,
	"brand_name" text NOT NULL,
	"business_type" text NOT NULL,
	"target_market" text NOT NULL,
	"product_or_service" text NOT NULL,
	"style_preference" text,
	"color_preference" text,
	"reference_links" text,
	"goal" text NOT NULL,
	"notes" text,
	"deadline" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_policy" text DEFAULT 'full_payment' NOT NULL,
	"deposit_percentage" integer DEFAULT 50 NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"files_unlocked" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_projects_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."creative_project_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"agent_id" integer,
	"step_name" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"provider" text,
	"model" text,
	"token_usage" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_project_quotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"line_items" jsonb NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"tax_percent" integer DEFAULT 0 NOT NULL,
	"subtotal" integer DEFAULT 0 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"valid_until" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"response_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_project_quotations_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_capabilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer,
	"model_id" integer,
	"agent_slug" text,
	"skill" text NOT NULL,
	"accuracy_score" numeric(5, 2),
	"speed_score" numeric(5, 2),
	"cost_score" numeric(5, 2),
	"max_context" integer,
	"supports_image" boolean DEFAULT false NOT NULL,
	"supports_json" boolean DEFAULT true NOT NULL,
	"supports_tool" boolean DEFAULT false NOT NULL,
	"supports_stream" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_client_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"value_type" text DEFAULT 'string' NOT NULL,
	"category" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"confidence" numeric(4, 3),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_client_memory_client_key" UNIQUE("client_id","key")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_cost_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text,
	"step_id" integer,
	"workflow_id" integer,
	"client_id" text,
	"agent_slug" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(12, 8),
	"actual_cost_usd" numeric(12, 8),
	"latency_ms" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"fallback_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"step_id" integer,
	"step_name" text,
	"action" text NOT NULL,
	"rating" integer,
	"feedback_text" text,
	"original_output" jsonb,
	"edited_output" jsonb,
	"diff" text,
	"reviewer" text DEFAULT 'human' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."creative_ai_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"step_id" integer,
	"agent_id" integer,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"asset_type" text DEFAULT 'image' NOT NULL,
	"prompt" text NOT NULL,
	"negative_prompt" text,
	"aspect_ratio" text,
	"image_url" text,
	"storage_path" text,
	"thumbnail_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"qc_score" integer,
	"qc_notes" text,
	"cost" numeric(10, 6),
	"latency_ms" integer,
	"metadata" jsonb,
	"category" text,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_asset_id" integer,
	"approved_by" text,
	"revision_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."creative_ai_client_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"client_name" text NOT NULL,
	"client_email" text,
	"client_phone" text,
	"review_token_hash" text NOT NULL,
	"review_token_plain" text,
	"token_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'not_shared' NOT NULL,
	"shared_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"revision_requested_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_ai_client_reviews_review_token_hash_unique" UNIQUE("review_token_hash")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."creative_ai_client_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"project_id" text NOT NULL,
	"asset_id" integer,
	"step_id" integer,
	"parent_comment_id" integer,
	"author_name" text NOT NULL,
	"author_type" text DEFAULT 'client' NOT NULL,
	"comment" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"department_code" text NOT NULL,
	"department_name" text NOT NULL,
	"description" text,
	"manager_agent_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_departments_department_code_unique" UNIQUE("department_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"skill_code" text NOT NULL,
	"skill_name" text NOT NULL,
	"category" text,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_skills_skill_code_unique" UNIQUE("skill_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_code" text NOT NULL,
	"tool_name" text NOT NULL,
	"category" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_tools_tool_code_unique" UNIQUE("tool_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_code" text NOT NULL,
	"employee_name" text NOT NULL,
	"avatar_url" text,
	"bio" text,
	"department_id" integer,
	"position" text NOT NULL,
	"role" text NOT NULL,
	"level" text DEFAULT 'junior' NOT NULL,
	"supervisor_id" integer,
	"provider_id" integer,
	"model_id" integer,
	"system_prompt_id" integer,
	"memory_profile_id" integer,
	"knowledge_profile_id" integer,
	"agent_slug" text,
	"cost_center" text,
	"salary_virtual" numeric(12, 2) DEFAULT '0',
	"hourly_cost" numeric(8, 4) DEFAULT '0',
	"max_parallel_jobs" integer DEFAULT 3 NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_employees_employee_code_unique" UNIQUE("employee_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_employee_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"proficiency" integer DEFAULT 3 NOT NULL,
	"experience_score" numeric(5, 2) DEFAULT '70',
	"accuracy_score" numeric(5, 2) DEFAULT '70',
	"speed_score" numeric(5, 2) DEFAULT '70',
	"cost_score" numeric(5, 2) DEFAULT '70',
	"last_trained_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_workload" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"running_jobs" integer DEFAULT 0 NOT NULL,
	"queued_jobs" integer DEFAULT 0 NOT NULL,
	"completed_today" integer DEFAULT 0 NOT NULL,
	"failed_today" integer DEFAULT 0 NOT NULL,
	"average_latency" numeric(10, 2),
	"average_cost" numeric(10, 6),
	"availability" integer DEFAULT 100 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_workload_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."employee_tool_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"tool_id" integer NOT NULL,
	"can_read" boolean DEFAULT true NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"can_execute" boolean DEFAULT true NOT NULL,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_execution_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text,
	"project_type" text DEFAULT 'creative_ai' NOT NULL,
	"objective" text NOT NULL,
	"department" text NOT NULL,
	"manager_employee_id" integer,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"estimated_cost" numeric(12, 4),
	"estimated_duration" integer,
	"actual_cost" numeric(12, 4),
	"actual_duration" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_task_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_plan_id" integer NOT NULL,
	"employee_id" integer,
	"task_name" text NOT NULL,
	"task_description" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"output" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_employee_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"completed_projects" integer DEFAULT 0 NOT NULL,
	"success_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"average_latency" numeric(10, 2),
	"average_cost" numeric(10, 6),
	"approval_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"revision_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"failure_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"quality_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"customer_rating" numeric(3, 1) DEFAULT '0' NOT NULL,
	"experience_points" integer DEFAULT 0 NOT NULL,
	"promotion_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"training_required" boolean DEFAULT false NOT NULL,
	"last_training" timestamp with time zone,
	"learning_notes" text,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_employee_performance_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_decision_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_plan_id" integer,
	"decision_by" text NOT NULL,
	"decision_type" text NOT NULL,
	"reason" text,
	"selected_employee" text,
	"selected_department" text,
	"selected_provider" text,
	"selected_model" text,
	"score" numeric(5, 2),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_code" text NOT NULL,
	"execution_plan_id" integer,
	"department_id" integer,
	"employee_id" integer,
	"job_type" text NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"priority_score" numeric(10, 4) DEFAULT '0',
	"status" text DEFAULT 'queued' NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_json" jsonb,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retry" integer DEFAULT 3 NOT NULL,
	"retry_strategy" text DEFAULT 'exponential' NOT NULL,
	"next_retry_at" timestamp with time zone,
	"error_message" text,
	"estimated_cost" numeric(12, 6),
	"actual_cost" numeric(12, 6),
	"estimated_duration" integer,
	"actual_duration" integer,
	"manager_override" integer,
	"required_capability" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_jobs_job_code_unique" UNIQUE("job_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_workers" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_name" text NOT NULL,
	"worker_type" text DEFAULT 'system_worker' NOT NULL,
	"cluster_id" text DEFAULT 'default' NOT NULL,
	"node_id" text DEFAULT 'local' NOT NULL,
	"region" text DEFAULT 'local' NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_concurrent_jobs" integer DEFAULT 2 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_token" text,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"current_job" integer,
	"last_heartbeat" timestamp with time zone DEFAULT now() NOT NULL,
	"running_jobs" integer DEFAULT 0 NOT NULL,
	"completed_today" integer DEFAULT 0 NOT NULL,
	"failed_today" integer DEFAULT 0 NOT NULL,
	"average_latency" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_workers_worker_name_unique" UNIQUE("worker_name")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"source_module" text NOT NULL,
	"source_id" text,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"published_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_event_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_name" text NOT NULL,
	"event_type" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"handler_type" text NOT NULL,
	"handler_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"retry_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_event_subscriptions_subscription_name_unique" UNIQUE("subscription_name")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_code" text NOT NULL,
	"schedule_name" text NOT NULL,
	"description" text,
	"trigger_type" text NOT NULL,
	"cron_expression" text,
	"interval_seconds" integer,
	"run_at" timestamp with time zone,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"event_type" text,
	"target_type" text NOT NULL,
	"target_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_running" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"run_count" integer DEFAULT 0 NOT NULL,
	"max_runs" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_schedules_schedule_code_unique" UNIQUE("schedule_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_schedule_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"run_number" integer NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_json" jsonb,
	"error_message" text,
	"created_job_id" integer,
	"created_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_skill_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"skill_code" text NOT NULL,
	"skill_name" text NOT NULL,
	"category" text,
	"description" text,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"author" text DEFAULT 'AI Enterprise Platform',
	"icon" text,
	"status" text DEFAULT 'published' NOT NULL,
	"required_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"configuration_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_skill_packages_skill_code_unique" UNIQUE("skill_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_tool_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_code" text NOT NULL,
	"tool_name" text NOT NULL,
	"provider" text,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"category" text,
	"api_type" text,
	"authentication_type" text,
	"status" text DEFAULT 'published' NOT NULL,
	"configuration_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"last_health_check_at" timestamp with time zone,
	"rate_limit_per_minute" text,
	"retry_policy" text DEFAULT 'exponential' NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_tool_packages_tool_code_unique" UNIQUE("tool_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_installed_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"package_id" integer NOT NULL,
	"package_type" text NOT NULL,
	"installed_version" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"configuration_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_installed_packages_tenant_id_package_id_package_type_unique" UNIQUE("tenant_id","package_id","package_type")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_human_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_code" text NOT NULL,
	"source_module" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"execution_plan_id" integer,
	"assigned_department" text,
	"assigned_user" text,
	"assigned_role" text,
	"priority" integer DEFAULT 50 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"instructions" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"due_at" timestamp with time zone,
	"sla_status" text DEFAULT 'on_time' NOT NULL,
	"notification_hook_url" text,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_human_tasks_task_code_unique" UNIQUE("task_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_human_task_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"action" text NOT NULL,
	"performed_by" text,
	"notes" text,
	"old_status" text,
	"new_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."customer_dashboard_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"client_email" text NOT NULL,
	"client_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_dashboard_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_service_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_service_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_service_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"package_name" text NOT NULL,
	"package_type" text DEFAULT 'standard' NOT NULL,
	"package_level" text DEFAULT 'starter' NOT NULL,
	"monthly_price" numeric(14, 2),
	"yearly_price" numeric(14, 2),
	"one_time_price" numeric(14, 2),
	"setup_fee" numeric(14, 2),
	"payment_policy" text DEFAULT 'full_payment' NOT NULL,
	"deposit_percentage" integer DEFAULT 50 NOT NULL,
	"included_revisions" integer,
	"deliverables_json" jsonb,
	"features_json" jsonb,
	"limits_json" jsonb,
	"sla_json" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_service_price_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"service_id" integer,
	"rule_code" text NOT NULL,
	"rule_name" text NOT NULL,
	"condition_type" text NOT NULL,
	"condition_json" jsonb,
	"adjustment_type" text NOT NULL,
	"adjustment_value" numeric(14, 4) NOT NULL,
	"minimum_charge" numeric(14, 2),
	"maximum_charge" numeric(14, 2),
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_service_price_rules_rule_code_unique" UNIQUE("rule_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_service_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"request_id" text NOT NULL,
	"service_id" integer NOT NULL,
	"package_id" integer,
	"pricing_model_selected" text DEFAULT 'one_time' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"company_name" text,
	"notes" text,
	"brief_json" jsonb,
	"quantity" integer DEFAULT 1 NOT NULL,
	"rush_speed" text,
	"human_review_requested" boolean DEFAULT false NOT NULL,
	"extra_revisions" integer DEFAULT 0 NOT NULL,
	"bilingual" boolean DEFAULT false NOT NULL,
	"editable_source_file" boolean DEFAULT false NOT NULL,
	"extended_usage_rights" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"rush_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"revision_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"human_review_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"additional_service_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"pricing_snapshot_json" jsonb,
	"estimated_ai_cost" numeric(14, 2),
	"actual_ai_cost" numeric(14, 2),
	"human_labor_estimate" numeric(14, 2),
	"gross_margin" numeric(14, 2),
	"gross_margin_percent" numeric(6, 2),
	"margin_approval_required" boolean DEFAULT false NOT NULL,
	"margin_approved_by" text,
	"margin_approved_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_project_id" text,
	"completion_notes" text,
	"completion_links" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_service_requests_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"category_id" integer NOT NULL,
	"service_code" text NOT NULL,
	"service_name" text NOT NULL,
	"short_description" text,
	"full_description" text,
	"service_type" text DEFAULT 'project' NOT NULL,
	"service_flow" text DEFAULT 'custom_project' NOT NULL,
	"pricing_model" text DEFAULT 'one_time' NOT NULL,
	"starting_price" numeric(12, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"estimated_delivery" text,
	"human_review" boolean DEFAULT false NOT NULL,
	"ai_only" boolean DEFAULT true NOT NULL,
	"subscription_supported" boolean DEFAULT false NOT NULL,
	"enterprise_supported" boolean DEFAULT false NOT NULL,
	"department" text,
	"workflow_summary" text,
	"ai_employees_involved" jsonb,
	"deliverables" jsonb,
	"revision_policy" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_services_service_code_unique" UNIQUE("service_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_commercial_gates" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"service_request_id" integer,
	"quotation_id" integer,
	"service_quotation_id" integer,
	"gate_type" text DEFAULT 'admin_approval' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"required_amount" numeric(14, 2),
	"verified_amount" numeric(14, 2),
	"reference_number" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_quotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"quotation_code" text NOT NULL,
	"service_request_id" integer,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"subtotal" integer DEFAULT 0 NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"pricing_snapshot_json" jsonb,
	"scope_snapshot_json" jsonb,
	"terms_snapshot_json" jsonb,
	"valid_until" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"review_token_hash" text,
	"review_token_expires_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"revision_requested_at" timestamp with time zone,
	"revision_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_quotations_quotation_code_unique" UNIQUE("quotation_code"),
	CONSTRAINT "ai_quotations_review_token_hash_unique" UNIQUE("review_token_hash")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_quotation_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"quotation_id" integer NOT NULL,
	"item_type" text DEFAULT 'service' NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"metadata_json" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_payment_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"payment_type" text DEFAULT 'full_payment' NOT NULL,
	"percentage" integer,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"due_date" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text,
	"verified_by" text,
	"paid_at" timestamp with time zone,
	"notes" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"project_id" integer NOT NULL,
	"payment_schedule_id" integer,
	"invoice_type" text DEFAULT 'final' NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"line_items_json" jsonb,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_live_previews" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"service_id" integer NOT NULL,
	"company_name" text NOT NULL,
	"industry" text NOT NULL,
	"style" text NOT NULL,
	"primary_color" text,
	"secondary_color" text,
	"short_description" text,
	"reference_image_url" text,
	"concept_a" jsonb,
	"concept_b" jsonb,
	"selected_concept" text,
	"status" text DEFAULT 'generating' NOT NULL,
	"error_message" text,
	"service_request_id" integer,
	"watermarked" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_service_faqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_service_portfolios" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"service_id" integer NOT NULL,
	"source_project_id" integer,
	"portfolio_code" text,
	"slug" text,
	"title" text NOT NULL,
	"short_description" text,
	"description" text,
	"industry" text NOT NULL,
	"business_type" text,
	"style" text NOT NULL,
	"color_tags" jsonb,
	"primary_color" text,
	"secondary_color" text,
	"business_size" text DEFAULT 'sme',
	"package_label" text,
	"package_level" text,
	"delivery_time" text,
	"delivery_days" integer,
	"cover_image" text,
	"gallery_json" jsonb,
	"before_image" text,
	"after_image" text,
	"deliverables_json" jsonb,
	"tools_used_json" jsonb,
	"workflow_json" jsonb,
	"rating" numeric(3, 2),
	"views" integer DEFAULT 0 NOT NULL,
	"total_clicks" integer DEFAULT 0 NOT NULL,
	"total_checkouts" integer DEFAULT 0 NOT NULL,
	"total_reviews" integer DEFAULT 0 NOT NULL,
	"completed_projects" integer DEFAULT 0 NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"publish_status" text DEFAULT 'published' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"trademark_risk" text DEFAULT 'low' NOT NULL,
	"qc_score" numeric(5, 2),
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."portfolio_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"portfolio_id" integer,
	"rating" integer NOT NULL,
	"review" text NOT NULL,
	"company" text NOT NULL,
	"industry" text,
	"client_name" text,
	"verified" boolean DEFAULT false NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_portfolio_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"creative_asset_id" integer,
	"asset_type" text NOT NULL,
	"asset_role" text NOT NULL,
	"title" text,
	"alt_text" text,
	"file_name" text,
	"thumbnail_url" text,
	"preview_url" text,
	"storage_path" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"display_order" integer DEFAULT 0 NOT NULL,
	"downloadable" boolean DEFAULT false NOT NULL,
	"watermark_required" boolean DEFAULT false NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_portfolio_generation_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_code" text NOT NULL,
	"service_id" integer,
	"industry" text NOT NULL,
	"style" text NOT NULL,
	"package_level" text DEFAULT 'standard' NOT NULL,
	"requested_count" integer DEFAULT 3 NOT NULL,
	"generated_count" integer DEFAULT 0 NOT NULL,
	"approved_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"max_cost" numeric(10, 2),
	"actual_cost" numeric(10, 2) DEFAULT '0' NOT NULL,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"qc_threshold" integer DEFAULT 70 NOT NULL,
	"created_by" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_portfolio_generation_batches_batch_code_unique" UNIQUE("batch_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_portfolio_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"customer_id" integer,
	"permission_status" text DEFAULT 'not_requested' NOT NULL,
	"requested_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"scope_json" jsonb,
	"approved_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."customer_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"client_email" text NOT NULL,
	"company_name" text,
	"address" text,
	"pic_name" text,
	"pic_phone" text,
	"billing_email" text,
	"tax_id" text,
	"payment_method_notes" text,
	"brand_preferences" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_profiles_email_hash_unique" UNIQUE("email_hash")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."customer_notification_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"notification_key" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notification_reads_email_key_uq" UNIQUE("email_hash","notification_key")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."customer_support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"client_email" text NOT NULL,
	"client_name" text NOT NULL,
	"project_id" text,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_customer_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"client_email" text NOT NULL,
	"project_id" text,
	"service_request_id" text,
	"quotation_id" integer,
	"payment_schedule_id" integer,
	"document_type" text NOT NULL,
	"document_number" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text DEFAULT 'application/pdf' NOT NULL,
	"file_size" bigint,
	"status" text DEFAULT 'draft' NOT NULL,
	"snapshot_json" jsonb,
	"generated_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_customer_doc_number" UNIQUE("customer_id","document_number")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_customer_impersonation_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"client_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"issued_by" text DEFAULT 'admin' NOT NULL,
	"reason" text NOT NULL,
	"readonly" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_customer_impersonation_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."sales_funnel_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor_id" text,
	"customer_id" integer,
	"session_id" text,
	"event_type" text NOT NULL,
	"service_id" integer,
	"portfolio_id" integer,
	"project_id" text,
	"package_id" integer,
	"campaign_id" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"device" text,
	"country" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_promotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"discount_type" text NOT NULL,
	"discount_value" integer,
	"benefit_label" text,
	"service_id" integer,
	"package_id" integer,
	"industry" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"usage_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_coupon_usages" (
	"id" serial PRIMARY KEY NOT NULL,
	"coupon_id" integer NOT NULL,
	"customer_profile_id" integer,
	"service_request_id" integer,
	"discount_amount" integer NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"value" integer NOT NULL,
	"minimum_order" integer,
	"maximum_discount" integer,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"usage_limit" integer,
	"usage_per_customer" integer DEFAULT 1 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_profile_id" integer NOT NULL,
	"referee_profile_id" integer,
	"referral_code" text NOT NULL,
	"referral_link" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reward_type" text,
	"reward_amount" integer,
	"reward_status" text DEFAULT 'pending',
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_referrals_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_affiliate_clicks" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliate_id" integer NOT NULL,
	"visitor_id" text,
	"session_id" text,
	"landing_page" text,
	"device" text,
	"country" text,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_affiliate_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliate_id" integer NOT NULL,
	"click_id" integer,
	"service_request_id" integer,
	"order_amount" integer NOT NULL,
	"commission_amount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_affiliates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"affiliate_code" text NOT NULL,
	"commission_rate" integer DEFAULT 10 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"total_clicks" integer DEFAULT 0 NOT NULL,
	"total_conversions" integer DEFAULT 0 NOT NULL,
	"total_revenue" integer DEFAULT 0 NOT NULL,
	"total_commission" integer DEFAULT 0 NOT NULL,
	"pending_commission" integer DEFAULT 0 NOT NULL,
	"paid_commission" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_affiliates_email_unique" UNIQUE("email"),
	CONSTRAINT "ai_affiliates_affiliate_code_unique" UNIQUE("affiliate_code")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_customer_health_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_profile_id" integer NOT NULL,
	"payment_score" integer DEFAULT 0 NOT NULL,
	"activity_score" integer DEFAULT 0 NOT NULL,
	"repeat_order_score" integer DEFAULT 0 NOT NULL,
	"review_score" integer DEFAULT 0 NOT NULL,
	"response_time_score" integer DEFAULT 0 NOT NULL,
	"overall_score" integer DEFAULT 0 NOT NULL,
	"health_status" text DEFAULT 'potential' NOT NULL,
	"last_calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_customer_health_scores_customer_profile_id_unique" UNIQUE("customer_profile_id")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_ab_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"test_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"winner_variant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_ab_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" integer NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"checkouts" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"revenue" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_customer_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_profile_id" integer NOT NULL,
	"segment" text DEFAULT 'new' NOT NULL,
	"previous_segment" text,
	"segment_score" integer DEFAULT 0 NOT NULL,
	"segment_reason" text,
	"metadata_json" jsonb,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_customer_segments_customer_profile_id_unique" UNIQUE("customer_profile_id")
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_automation_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"trigger_event_id" text,
	"trigger_event_type" text,
	"customer_profile_id" integer,
	"status" text DEFAULT 'success' NOT NULL,
	"result_json" jsonb,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_platform"."ai_automation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_code" text NOT NULL,
	"rule_name" text NOT NULL,
	"description" text,
	"trigger_event" text NOT NULL,
	"conditions_json" jsonb NOT NULL,
	"action_type" text NOT NULL,
	"action_config_json" jsonb,
	"priority" integer DEFAULT 50 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"execution_count" integer DEFAULT 0 NOT NULL,
	"last_executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_automation_rules_rule_code_unique" UNIQUE("rule_code")
);
--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "ai_platform"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_workflow_executions" ADD CONSTRAINT "ai_workflow_executions_workflow_id_ai_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "ai_platform"."ai_workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_prompt_id_ai_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "ai_platform"."ai_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_knowledge_base_id_ai_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "ai_platform"."ai_knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_agents" ADD CONSTRAINT "ai_agents_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "ai_platform"."ai_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_agents" ADD CONSTRAINT "ai_agents_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "ai_platform"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_agents" ADD CONSTRAINT "ai_agents_knowledge_base_id_ai_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "ai_platform"."ai_knowledge_bases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_agent_capabilities" ADD CONSTRAINT "ai_agent_capabilities_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "ai_platform"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."creative_project_steps" ADD CONSTRAINT "creative_project_steps_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ai_platform"."creative_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."creative_project_steps" ADD CONSTRAINT "creative_project_steps_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "ai_platform"."ai_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_capabilities" ADD CONSTRAINT "ai_capabilities_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "ai_platform"."ai_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_capabilities" ADD CONSTRAINT "ai_capabilities_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "ai_platform"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."creative_ai_assets" ADD CONSTRAINT "creative_ai_assets_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "ai_platform"."ai_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."creative_ai_client_comments" ADD CONSTRAINT "creative_ai_client_comments_review_id_creative_ai_client_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "ai_platform"."creative_ai_client_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_employees" ADD CONSTRAINT "ai_employees_department_id_ai_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "ai_platform"."ai_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_employees" ADD CONSTRAINT "ai_employees_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "ai_platform"."ai_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_employees" ADD CONSTRAINT "ai_employees_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "ai_platform"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_employee_skills" ADD CONSTRAINT "ai_employee_skills_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "ai_platform"."ai_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_employee_skills" ADD CONSTRAINT "ai_employee_skills_skill_id_ai_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "ai_platform"."ai_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_workload" ADD CONSTRAINT "ai_workload_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "ai_platform"."ai_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."employee_tool_permissions" ADD CONSTRAINT "employee_tool_permissions_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "ai_platform"."ai_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."employee_tool_permissions" ADD CONSTRAINT "employee_tool_permissions_tool_id_ai_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "ai_platform"."ai_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_task_assignments" ADD CONSTRAINT "ai_task_assignments_execution_plan_id_ai_execution_plans_id_fk" FOREIGN KEY ("execution_plan_id") REFERENCES "ai_platform"."ai_execution_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_task_assignments" ADD CONSTRAINT "ai_task_assignments_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "ai_platform"."ai_employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_employee_performance" ADD CONSTRAINT "ai_employee_performance_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "ai_platform"."ai_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_jobs" ADD CONSTRAINT "ai_jobs_execution_plan_id_ai_execution_plans_id_fk" FOREIGN KEY ("execution_plan_id") REFERENCES "ai_platform"."ai_execution_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_jobs" ADD CONSTRAINT "ai_jobs_department_id_ai_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "ai_platform"."ai_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_jobs" ADD CONSTRAINT "ai_jobs_employee_id_ai_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "ai_platform"."ai_employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_schedule_runs" ADD CONSTRAINT "ai_schedule_runs_schedule_id_ai_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "ai_platform"."ai_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_human_tasks" ADD CONSTRAINT "ai_human_tasks_execution_plan_id_ai_execution_plans_id_fk" FOREIGN KEY ("execution_plan_id") REFERENCES "ai_platform"."ai_execution_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_human_task_history" ADD CONSTRAINT "ai_human_task_history_task_id_ai_human_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ai_platform"."ai_human_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_service_packages" ADD CONSTRAINT "ai_service_packages_service_id_ai_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "ai_platform"."ai_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_service_price_rules" ADD CONSTRAINT "ai_service_price_rules_service_id_ai_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "ai_platform"."ai_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_service_requests" ADD CONSTRAINT "ai_service_requests_service_id_ai_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "ai_platform"."ai_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_service_requests" ADD CONSTRAINT "ai_service_requests_package_id_ai_service_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "ai_platform"."ai_service_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_services" ADD CONSTRAINT "ai_services_category_id_ai_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "ai_platform"."ai_service_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_commercial_gates" ADD CONSTRAINT "ai_commercial_gates_service_request_id_ai_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "ai_platform"."ai_service_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_commercial_gates" ADD CONSTRAINT "ai_commercial_gates_quotation_id_creative_project_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."creative_project_quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_commercial_gates" ADD CONSTRAINT "ai_commercial_gates_service_quotation_id_ai_quotations_id_fk" FOREIGN KEY ("service_quotation_id") REFERENCES "ai_platform"."ai_quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_quotations" ADD CONSTRAINT "ai_quotations_service_request_id_ai_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "ai_platform"."ai_service_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_quotation_items" ADD CONSTRAINT "ai_quotation_items_quotation_id_ai_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "ai_platform"."ai_quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_payment_schedule" ADD CONSTRAINT "ai_payment_schedule_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ai_platform"."creative_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_invoices" ADD CONSTRAINT "ai_invoices_project_id_creative_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ai_platform"."creative_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_invoices" ADD CONSTRAINT "ai_invoices_payment_schedule_id_ai_payment_schedule_id_fk" FOREIGN KEY ("payment_schedule_id") REFERENCES "ai_platform"."ai_payment_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_live_previews" ADD CONSTRAINT "ai_live_previews_service_id_ai_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "ai_platform"."ai_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_service_faqs" ADD CONSTRAINT "ai_service_faqs_service_id_ai_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "ai_platform"."ai_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_service_portfolios" ADD CONSTRAINT "ai_service_portfolios_service_id_ai_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "ai_platform"."ai_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."portfolio_reviews" ADD CONSTRAINT "portfolio_reviews_service_id_ai_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "ai_platform"."ai_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."portfolio_reviews" ADD CONSTRAINT "portfolio_reviews_portfolio_id_ai_service_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "ai_platform"."ai_service_portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_portfolio_assets" ADD CONSTRAINT "ai_portfolio_assets_portfolio_id_ai_service_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "ai_platform"."ai_service_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_coupon_usages" ADD CONSTRAINT "ai_coupon_usages_coupon_id_ai_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "ai_platform"."ai_coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_affiliate_clicks" ADD CONSTRAINT "ai_affiliate_clicks_affiliate_id_ai_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "ai_platform"."ai_affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_affiliate_conversions" ADD CONSTRAINT "ai_affiliate_conversions_affiliate_id_ai_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "ai_platform"."ai_affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_affiliate_conversions" ADD CONSTRAINT "ai_affiliate_conversions_click_id_ai_affiliate_clicks_id_fk" FOREIGN KEY ("click_id") REFERENCES "ai_platform"."ai_affiliate_clicks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_ab_variants" ADD CONSTRAINT "ai_ab_variants_test_id_ai_ab_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "ai_platform"."ai_ab_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_platform"."ai_automation_executions" ADD CONSTRAINT "ai_automation_executions_rule_id_ai_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "ai_platform"."ai_automation_rules"("id") ON DELETE cascade ON UPDATE no action;