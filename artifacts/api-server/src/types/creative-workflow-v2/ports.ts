/**
 * creative-workflow-v2 — Port Interfaces
 *
 * These interfaces define the contract between the Creative Workflow Engine
 * (Team 1) and the shared infrastructure services (Queue, Dispatcher,
 * EventBus, Worker). They are PURE INTERFACES — no implementation lives here.
 *
 * Team 24 provides the adapter implementations that wire these ports to the
 * real services (queueManagerService, jobDispatcherService, etc.).
 *
 * The engine only imports from this file when it needs to interact with
 * infrastructure — never importing the concrete services directly.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

// ── Queue Port ────────────────────────────────────────────────────────────────

export interface EnqueueInput {
  jobType: string;
  payloadJson?: Record<string, unknown>;
  /** 0–100. Higher number = higher priority. Default 50. */
  priority?: number;
  maxRetry?: number;
  retryStrategy?: "immediate" | "exponential" | "manual";
  estimatedDurationMs?: number;
  estimatedCost?: number;
  /** Server-resolved tenant id stamped into payload by the enqueue adapter. */
  tenantId?: string;
  /** Tag allowing batch pause/resume by workflow plan. */
  correlationId?: string;
}

export interface EnqueueResult {
  jobId: string;
  jobCode: string;
}

export interface QueueFilter {
  jobType?: string;
  status?: string[];
  correlationId?: string;
}

/**
 * QueuePort — the workflow engine's view of the job queue.
 *
 * The adapter MUST:
 *   - never expose internal DB types
 *   - honour the priority / retryStrategy fields
 *   - stamp correlationId into payloadJson so workers can publish events back
 */
export interface QueuePort {
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  cancelJob(jobId: string, reason?: string): Promise<void>;
  /**
   * Pause all matching queued jobs (queued → waiting).
   * Returns the count of affected jobs.
   */
  pauseJobs(filter: QueueFilter): Promise<number>;
  /**
   * Resume all matching waiting jobs (waiting → queued).
   * Returns the count of affected jobs.
   */
  resumeJobs(filter: QueueFilter): Promise<number>;
}

// ── Dispatcher Port ───────────────────────────────────────────────────────────

export interface DispatcherStatusSnapshot {
  enabled: boolean;
  running: boolean;
  workerCount: number;
  idleWorkers: number;
  busyWorkers: number;
  queueLength: number;
  runningJobs: number;
  lastTick: string | null;
  lastHeartbeat: string | null;
}

/**
 * DispatcherPort — read-only view into the dispatcher runtime.
 *
 * The workflow engine uses this to determine whether capacity is available
 * before transitioning node groups to "ready". The engine never starts or
 * stops the dispatcher directly.
 */
export interface DispatcherPort {
  getStatus(): DispatcherStatusSnapshot;
  /** Optional: trigger a single poll cycle (useful in tests / admin tools). */
  tick?(): Promise<{ claimed: number; completed: number; failed: number }>;
}

// ── Event Bus Port ────────────────────────────────────────────────────────────

export interface EventPublishInput {
  eventType: string;
  sourceModule: string;
  sourceId?: string;
  correlationId?: string;
  causationId?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface EventPublishResult {
  eventId: string;
}

/**
 * EventBusPort — the workflow engine's view of the event bus.
 *
 * The engine publishes domain events (plan_started, node_completed, etc.)
 * via this port. Callers should prefer publishSafe for fire-and-forget
 * use-cases where failure must not block the workflow transition.
 */
export interface EventBusPort {
  /** Async publish — resolves when the event row is persisted. */
  publish(opts: EventPublishInput): Promise<EventPublishResult>;
  /**
   * Fire-and-forget publish — swallows all errors.
   * Use when publish failure must not propagate to the caller.
   */
  publishSafe(opts: EventPublishInput): void;
}

// ── Worker Port ───────────────────────────────────────────────────────────────

export interface WorkerCapabilityInfo {
  workerType: string;
  capabilities: string[];
  maxConcurrentJobs: number;
  idleSlots: number;
}

/**
 * WorkerPort — the workflow engine's view of the worker cluster.
 *
 * The engine queries this port to validate that a node's jobType is
 * supported by at least one registered capability before building the plan.
 * It does NOT claim or complete jobs directly; that is the dispatcher's job.
 */
export interface WorkerPort {
  /**
   * Returns all registered capabilities across all worker types.
   * Used to validate that every node's jobType has a handler.
   */
  getCapabilities(): string[];
  /**
   * Per-worker-type capacity breakdown.
   * Returns an empty array when no workers are registered (test mode).
   */
  getCapacityInfo(): WorkerCapabilityInfo[];
  /**
   * Returns true if any worker is currently available to handle new jobs.
   * The engine uses this as a fast-path check before transitioning nodes to ready.
   */
  isAvailable(): boolean;
}

// ── Port Registry (dependency injection container) ────────────────────────────

/**
 * All ports the engine depends on, grouped for injection.
 * Pass a PortRegistry to engine services that need infrastructure access.
 * In tests, supply stub implementations.
 * In production, Team 24's adapter layer supplies real implementations.
 */
export interface PortRegistry {
  queue: QueuePort;
  dispatcher: DispatcherPort;
  eventBus: EventBusPort;
  worker: WorkerPort;
}
