/**
 * Correlate GitHub CI events to AI Core tasks without putting ChatGPT session
 * identifiers into GitHub Actions logs, artifacts or public webhook payloads.
 *
 * This module validates the *public* event identity only. The private mapping
 * (tenant, authorized user, conversation, task) must be resolved server-side
 * from a trusted, persisted task registry.
 */
export function parseGithubRunIdentity(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("GitHub event must be an object");
  }
  const { repository, runId, headSha, workflow, conclusion } = input;
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new TypeError("Invalid repository");
  }
  if (!/^[1-9][0-9]*$/.test(String(runId))) {
    throw new TypeError("Invalid runId");
  }
  if (typeof headSha !== "string" || !/^[a-f0-9]{40}$/.test(headSha)) {
    throw new TypeError("Invalid commit SHA");
  }
  if (typeof workflow !== "string" || !workflow.trim()) {
    throw new TypeError("Invalid workflow");
  }
  if (!["success", "failure", "cancelled", "timed_out", "skipped"].includes(conclusion)) {
    throw new TypeError("Invalid conclusion");
  }
  return Object.freeze({
    repository, runId: String(runId), headSha, workflow, conclusion,
    eventKey: `github:workflow:${repository}:${runId}:${conclusion}`,
  });
}

/**
 * Resolve a run against trusted server-side task registry records.
 * A single run may be subscribed to by multiple authorized conversations.
 * Never derive a conversation ID from GitHub event data.
 */
export function resolveAuthorizedSubscriptions(identity, records) {
  if (!Array.isArray(records)) throw new TypeError("Expected registry records");
  const matches = new Map();
  for (const record of records) {
    if (record.repository !== identity.repository || String(record.runId) !== identity.runId) continue;
    if (record.headSha !== identity.headSha || record.authorized !== true) continue;
    if (![record.tenantId, record.userId, record.conversationId, record.taskId].every(
      value => typeof value === "string" && value.length > 0
    )) continue;
    const key = JSON.stringify([record.tenantId, record.userId, record.conversationId, record.taskId]);
    matches.set(key, record);
  }
  return [...matches.values()];
}
