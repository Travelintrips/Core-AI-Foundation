/**
 * Fail-closed GitHub CI aggregation for one exact, pre-authorized repository/SHA
 * binding. All required checks must complete successfully before auto-continue.
 * No PR title, free-form status or unrelated check can authorize a transition.
 */
export type GithubCiGateVerdict =
  | { accepted: false; reason: string }
  | {
      accepted: true;
      state: "WAITING" | "GREEN" | "FAILED";
      newlyGreen: boolean;
      currentCheckFailed: boolean;
      checkResults: Record<string, "success" | "failure">;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function decideSignedGithubCiGate(input: {
  sourceModule: string | undefined;
  eventType: string;
  eventId: string;
  headSha: string;
  bindingHeadSha: string;
  checkName: unknown;
  status: unknown;
  conclusion: unknown;
  requiredChecks: unknown;
  previousCheckpoint: Record<string, unknown>;
  previousState: string;
}): GithubCiGateVerdict {
  const skip = (reason: string): GithubCiGateVerdict => ({ accepted: false, reason });
  if (input.sourceModule !== "github-webhook") return skip("untrusted_event_source");
  if (input.eventType !== "coding.github.check_run" &&
      input.eventType !== "coding.github.workflow_run") return skip("unsupported_event");
  if (input.headSha !== input.bindingHeadSha ||
      !/^[a-f0-9]{40}$/i.test(input.headSha)) return skip("stale_sha");
  if (!Array.isArray(input.requiredChecks) ||
      input.requiredChecks.length === 0 ||
      input.requiredChecks.length > 32 ||
      !input.requiredChecks.every((x: unknown) =>
        typeof x === "string" && x.trim().length > 0 && x.length <= 160)) {
    return skip("required_checks_not_configured");
  }

  const checks = Array.from(new Set((input.requiredChecks as string[]).map(x => x.trim())));
  const name = typeof input.checkName === "string" ? input.checkName.trim() : "";
  if (!checks.includes(name)) return skip("check_not_required");
  if (input.status !== "completed") return skip("not_terminal");
  if (typeof input.conclusion !== "string" || input.conclusion.trim().length === 0)
    return skip("missing_conclusion");
  if (input.previousCheckpoint["ciLastEventId"] === input.eventId)
    return skip("duplicate_event");

  const prior = input.previousCheckpoint["ciHeadSha"] === input.headSha &&
    isRecord(input.previousCheckpoint["ciChecks"])
    ? input.previousCheckpoint["ciChecks"] as Record<string, unknown>
    : {};
  const checkResults: Record<string, "success" | "failure"> = {};
  for (const required of checks) {
    const result = prior[required];
    if (result === "success" || result === "failure") checkResults[required] = result;
  }
  const currentCheckFailed = input.conclusion !== "success";
  checkResults[name] = currentCheckFailed ? "failure" : "success";
  const state = checks.every(required => checkResults[required] === "success")
    ? "GREEN"
    : checks.some(required => checkResults[required] === "failure")
      ? "FAILED" : "WAITING";

  return {
    accepted: true,
    state,
    newlyGreen: state === "GREEN" && input.previousState !== "GREEN",
    currentCheckFailed,
    checkResults,
  };
}
