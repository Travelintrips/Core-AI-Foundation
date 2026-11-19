/** Exact owner subscription must be live and explicitly opt into checkpoints. */
export function mayReadSignedCheckpointFromMcpSubscription(input: {
  state: string;
  eventTypes: unknown;
}): boolean {
  return input.state === "ACTIVE" && Array.isArray(input.eventTypes) &&
    input.eventTypes.includes("CHECKPOINT");
}
