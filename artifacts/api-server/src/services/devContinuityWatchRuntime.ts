/**
 * Per-job progress deadlines. Registration is passive: only a due, durable CAS
 * claim may enqueue a wake. Browser idle/draft checks remain the worker's job.
 * No global polling loop and no automatic re-send after a browser result.
 */
export interface ContinuityWatch {
  commandId: string;
  ownerChannel: string;
  targetConversationId: string;
  jobId: string;
  revision: number;
  state: string;
  deadlineAt: string;
  expiresAt: string;
  claimLeaseUntil?: string | null;
  claimToken?: string | null;
  wakeEventId?: string | null;
  checkpointSha: string;
}

export interface ContinuityRegistration {
  ownerChannel: string;
  targetConversationId: string;
  jobId: string;
  checkpointSha: string;
  idleSeconds: number;
  ttlSeconds: number;
}

export interface ContinuityCheckpoint {
  ownerChannel: string;
  jobId: string;
  expectedRevision: number;
  checkpointSha: string;
  state: "RUNNING" | "WAITING_CI" | "WAITING_APPROVAL" | "COMPLETED" | "CANCELLED";
}

export interface ContinuityResult {
  parentWatchCommandId: string;
  ownerChannel: string;
  eventId: string;
  jobId: string;
  childCommandId: string;
  workerId: "openclaw-travelintrips-dev";
  status: "COMPLETED" | "FAILED";
  details: Record<string, unknown>;
}

type Repository<W extends ContinuityWatch> = {
  register(input: ContinuityRegistration, now: Date): Promise<W>;
  get(ownerChannel: string, jobId: string): Promise<W | null>;
  reconcile(ownerChannel: string, jobId: string, now: Date): Promise<W | null>;
  update(input: ContinuityCheckpoint, now: Date): Promise<W>;
  restore(ownerChannel: string, now: Date, limit: number): Promise<W[]>;
  claim(ownerChannel: string, jobId: string, expectedRevision: number, now: Date): Promise<W | null>;
  recordQueued(input: { ownerChannel: string; jobId: string; claimToken: string; eventId: string; wakeCommandId: string }, now: Date): Promise<W | null>;
  recordResult(input: ContinuityResult, now: Date): Promise<W | null>;
};

type Dependencies<W extends ContinuityWatch> = {
  repository: Repository<W>;
  enabled: () => boolean;
  allowed: (watch: { ownerChannel: string; targetConversationId: string }) => boolean;
  owners: () => string[];
  queue: (input: { ownerChannel: string; targetConversationId: string; eventId: string; watchCommandId: string; jobId: string; correlationId: string; checkpointRevision: number; expiresAt: string }) => Promise<{ commandId: string }>;
  subscribe: (listener: (result: ContinuityResult) => void | Promise<void>) => () => void;
  onError: (code: string, error: unknown) => void;
  now?: () => number;
  setTimer?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

const MAX_OWNERS = 32;
const MAX_WATCHES_PER_OWNER = 32;
const MAX_RECONCILE_ERRORS = 3;
const RETRY_DELAY_MS = 5_000;

export class DevContinuityWatchRuntime<W extends ContinuityWatch> {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly callbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly errors = new Map<string, number>();
  private readonly now: () => number;
  private readonly setTimer: NonNullable<Dependencies<W>["setTimer"]>;
  private readonly clearTimer: NonNullable<Dependencies<W>["clearTimer"]>;
  private started = false;
  private starting: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;
  private generation = 0;

  constructor(private readonly deps: Dependencies<W>) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, delay) => {
      const timer = setTimeout(fn, delay);
      timer.unref();
      return timer;
    });
    this.clearTimer = deps.clearTimer ?? clearTimeout;
  }

  private key(watch: { ownerChannel: string; jobId: string }): string {
    return `${watch.ownerChannel}|${watch.jobId}`;
  }

  private assertAllowed(watch: { ownerChannel: string; targetConversationId: string }): void {
    if (!this.deps.enabled() || !this.deps.allowed(watch)) {
      throw new Error("DEV_CONTINUITY_DENIED");
    }
  }

  /** One bounded restore on process startup, with durable claims across replicas. */
  async start(): Promise<void> {
    if (!this.deps.enabled() || this.started) return;
    if (this.starting) return this.starting;
    const generation = this.generation;
    this.starting = (async () => {
      this.unsubscribe = this.deps.subscribe((event) => this.receiveResult(event));
      for (const owner of [...new Set(this.deps.owners())].slice(0, MAX_OWNERS)) {
        if (generation !== this.generation) return;
        const watches = await this.deps.repository.restore(owner, new Date(this.now()), MAX_WATCHES_PER_OWNER);
        if (generation !== this.generation) return;
        for (const watch of watches) this.arm(watch);
      }
      if (generation === this.generation) this.started = true;
    })();
    try {
      await this.starting;
    } catch (error) {
      this.stop();
      throw error;
    } finally {
      this.starting = null;
    }
  }

  stop(): void {
    this.generation += 1;
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const timer of this.timers.values()) this.clearTimer(timer);
    for (const timer of this.callbackTimers.values()) this.clearTimer(timer);
    this.timers.clear();
    this.callbackTimers.clear();
    this.errors.clear();
  }

  async register(input: ContinuityRegistration): Promise<W> {
    this.assertAllowed(input);
    await this.start();
    const watch = await this.deps.repository.register(input, new Date(this.now()));
    this.arm(watch);
    return watch;
  }

  async update(input: ContinuityCheckpoint): Promise<W> {
    const current = await this.deps.repository.reconcile(input.ownerChannel, input.jobId, new Date(this.now()));
    if (!current) throw new Error("DEV_CONTINUITY_NOT_FOUND");
    this.assertAllowed(current);
    await this.start();
    const watch = await this.deps.repository.update(input, new Date(this.now()));
    this.arm(watch);
    return watch;
  }

  async get(ownerChannel: string, jobId: string): Promise<W | null> {
    if (!this.deps.enabled()) throw new Error("DEV_CONTINUITY_DENIED");
    const watch = await this.deps.repository.reconcile(ownerChannel, jobId, new Date(this.now()));
    if (watch) { this.assertAllowed(watch); this.arm(watch); }
    return watch;
  }

  private arm(watch: W, retryAt?: number): void {
    const key = this.key(watch);
    const previous = this.timers.get(key);
    if (previous) this.clearTimer(previous);
    this.timers.delete(key);
    if (!this.deps.enabled() || !this.deps.allowed(watch)) return;
    const expires = Date.parse(watch.expiresAt);
    let due: number;
    if (watch.state === "RUNNING") due = Math.min(Date.parse(watch.deadlineAt), expires);
    else if (watch.state === "FIRING") due = Math.min(Date.parse(watch.claimLeaseUntil ?? watch.expiresAt), expires);
    else if (watch.state === "WAITING_CI" || watch.state === "WAITING_APPROVAL" || watch.state === "WAKE_QUEUED") due = expires;
    else return;
    if (retryAt !== undefined) due = Math.max(due, retryAt);
    if (!Number.isFinite(due)) { this.deps.onError("DEV_CONTINUITY_INVALID_DEADLINE", null); return; }
    const generation = this.generation;
    const timer = this.setTimer(() => {
      if (this.timers.get(key) !== timer || generation !== this.generation) return;
      this.timers.delete(key);
      void this.onDeadline(watch, generation);
    }, Math.max(0, due - this.now()));
    this.timers.set(key, timer);
  }

  private async onDeadline(watch: W, generation: number): Promise<void> {
    if (generation !== this.generation || !this.deps.enabled() || !this.deps.allowed(watch)) return;
    const key = this.key(watch);
    try {
      if (watch.state === "WAKE_QUEUED") {
        const reconciled = await this.deps.repository.reconcile(watch.ownerChannel, watch.jobId, new Date(this.now()));
        if (reconciled && reconciled.state !== "WAKE_QUEUED") {
          if (generation === this.generation) this.arm(reconciled);
          return;
        }
      }
      const claim = await this.deps.repository.claim(watch.ownerChannel, watch.jobId, watch.revision, new Date(this.now()));
      if (generation !== this.generation) return;
      if (!claim || claim.state !== "FIRING") {
        // A newer checkpoint or another replica won. Re-read once and schedule
        // its own deadline, never issue a second command for a stale revision.
        const latest = claim ?? await this.deps.repository.get(watch.ownerChannel, watch.jobId);
        if (latest && generation === this.generation) this.arm(latest);
        return;
      }
      this.assertAllowed(claim);
      if (!claim.claimToken || !claim.wakeEventId) throw new Error("DEV_CONTINUITY_INVALID_CLAIM");
      const queued = await this.deps.queue({
        ownerChannel: claim.ownerChannel, targetConversationId: claim.targetConversationId,
        eventId: claim.wakeEventId, watchCommandId: claim.commandId,
        jobId: claim.jobId, correlationId: claim.jobId, checkpointRevision: claim.revision,
        expiresAt: claim.expiresAt,
      });
      const recorded = await this.deps.repository.recordQueued({
        ownerChannel: claim.ownerChannel, jobId: claim.jobId, claimToken: claim.claimToken,
        eventId: claim.wakeEventId, wakeCommandId: queued.commandId,
      }, new Date(this.now()));
      this.errors.delete(key);
      if (recorded && generation === this.generation) this.arm(recorded);
    } catch (error) {
      this.deps.onError("DEV_CONTINUITY_DEADLINE_FAILED", error);
      if (generation !== this.generation) return;
      const failures = (this.errors.get(key) ?? 0) + 1;
      this.errors.set(key, failures);
      if (failures > MAX_RECONCILE_ERRORS) return;
      try {
        // An uncertain queue response is reconciled using the SAME persisted
        // event after its lease. Never derive a replacement wake event here.
        const current = await this.deps.repository.get(watch.ownerChannel, watch.jobId);
        if (current && generation === this.generation) this.arm(current, this.now() + RETRY_DELAY_MS);
      } catch (readError) {
        this.deps.onError("DEV_CONTINUITY_RECONCILE_FAILED", readError);
        if (generation === this.generation) this.arm(watch, this.now() + RETRY_DELAY_MS);
      }
    }
  }

  private async receiveResult(event: ContinuityResult, attempt = 0): Promise<void> {
    if (!this.deps.enabled()) return;
    const generation = this.generation;
    const key = event.childCommandId;
    const pending = this.callbackTimers.get(key);
    if (pending) this.clearTimer(pending);
    this.callbackTimers.delete(key);
    try {
      const current = await this.deps.repository.get(event.ownerChannel, event.jobId);
      if (!current || !this.deps.allowed(current)) return;
      const watch = await this.deps.repository.recordResult(event, new Date(this.now()));
      if (watch && generation === this.generation) this.arm(watch);
    } catch (error) {
      // The worker response is already durable. Startup reconciliation reads
      // the exact child response if this listener loses its connection.
      this.deps.onError("DEV_CONTINUITY_CALLBACK_FAILED", error);
      if (attempt < MAX_RECONCILE_ERRORS && generation === this.generation) {
        const timer = this.setTimer(() => {
          if (generation !== this.generation || this.callbackTimers.get(key) !== timer) return;
          this.callbackTimers.delete(key);
          void this.receiveResult(event, attempt + 1);
        }, RETRY_DELAY_MS);
        this.callbackTimers.set(key, timer);
      }
    }
  }
}
