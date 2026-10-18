/** In-process signal only. The authenticated bridge response is the durable source. */
export const DEV_CONTINUITY_WORKER = "openclaw-travelintrips-dev" as const;

export interface DevContinuityWakeResult {
  parentWatchCommandId: string;
  ownerChannel: string;
  eventId: string;
  jobId: string;
  childCommandId: string;
  workerId: typeof DEV_CONTINUITY_WORKER;
  status: "COMPLETED" | "FAILED";
  details: Record<string, unknown>;
}

type Listener = (result: DevContinuityWakeResult) => void | Promise<void>;
const listeners = new Set<Listener>();
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const event = /^[a-f0-9]{64}$/;
const channel = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,199}$/;
const job = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Call only with a command returned by the claim-token guarded terminal UPDATE
 * after its response transaction commits, or its persisted equivalent on restore.
 * Routing/correlation always comes from that command, never callback body fields.
 */
export function devContinuityResultFromCommittedCommand(input: {
  id: unknown;
  source: unknown;
  commandType: unknown;
  metadata: unknown;
  authenticatedWorkerId: string;
  status: "COMPLETED" | "FAILED";
  details: Record<string, unknown>;
}): DevContinuityWakeResult | null {
  if (input.source !== "ai-core" || input.commandType !== "EXTERNAL_AGENT_WORK" ||
      input.authenticatedWorkerId !== DEV_CONTINUITY_WORKER || !record(input.metadata)) return null;
  const metadata = input.metadata;
  const binding = metadata["devContinuity"];
  if (!record(binding) || metadata["assignedClientId"] !== DEV_CONTINUITY_WORKER ||
      metadata["completedBy"] !== DEV_CONTINUITY_WORKER ||
      metadata["capability"] !== "chatgpt:wake" || metadata["explicitWorkerTarget"] !== true) return null;
  const parent = binding["parentWatchCommandId"];
  const owner = binding["ownerChannel"];
  const eventId = binding["eventId"];
  const jobId = binding["jobId"];
  if (typeof input.id !== "string" || !uuid.test(input.id) ||
      typeof parent !== "string" || !uuid.test(parent) ||
      typeof owner !== "string" || !channel.test(owner) || metadata["conversationId"] !== owner ||
      typeof eventId !== "string" || !event.test(eventId) || metadata["eventId"] !== eventId ||
      typeof jobId !== "string" || !job.test(jobId)) return null;
  return { parentWatchCommandId: parent, ownerChannel: owner, eventId, jobId,
    childCommandId: input.id, workerId: DEV_CONTINUITY_WORKER,
    status: input.status, details: input.details };
}

export function subscribeDevContinuityWakeResults(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function emitDevContinuityWakeResult(result: DevContinuityWakeResult): Promise<void> {
  // A failed subscriber cannot undo the committed worker result. Startup restore
  // replays this exact durable child response into the passive watch state.
  const outcomes = await Promise.allSettled([...listeners].map(listener => Promise.resolve().then(() => listener(result))));
  if (outcomes.some(outcome => outcome.status === "rejected")) {
    console.warn("[dev-continuity] Callback signal persistence deferred; durable bridge response remains available for recovery");
  }
}
