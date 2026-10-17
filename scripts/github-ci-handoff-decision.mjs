import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TERMINAL = new Set(["success", "failure", "cancelled", "timed_out", "action_required", "startup_failure"]);

export function classifyCiRun(run, expectedRepository) {
  const rejected = reason => ({ eligible: false, reason });
  if (!run || typeof run !== "object" || Array.isArray(run)) return rejected("invalid_payload");
  if (typeof expectedRepository !== "string" || !REPOSITORY.test(expectedRepository)) return rejected("invalid_repository");
  if (run.repository?.full_name !== expectedRepository) return rejected("repository_mismatch");
  if (run.name !== "CI Verify" || run.status !== "completed" || !TERMINAL.has(run.conclusion)) {
    return rejected("not_terminal_ci_verify");
  }
  const id = Number(run.id);
  const attempt = Number(run.run_attempt ?? 1);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(attempt) || attempt <= 0) {
    return rejected("invalid_run_identity");
  }
  if (typeof run.head_sha !== "string" || !SHA.test(run.head_sha)) return rejected("invalid_sha");
  let scope;
  if (run.event === "push" && ["main", "develop"].includes(run.head_branch)) {
    scope = "branch_push";
  } else if (run.event === "pull_request" && typeof run.head_branch === "string" && run.head_branch.length > 0) {
    scope = "pr_ci";
  } else {
    return rejected("unrelated_ci_event");
  }
  const branch = run.head_branch;
  const eventId = `githubci-${id}-${attempt}-${run.conclusion}`;
  return {
    eligible: true,
    eventId,
    runId: String(id),
    runAttempt: attempt,
    branch,
    scope,
    headSha: run.head_sha,
    event: run.event,
    conclusion: run.conclusion,
    status: run.conclusion === "success" ? "COMPLETED" : "FAILED",
    requiresBranchHeadCheck: scope === "branch_push",
    diagnosticOnly: true,
    actionAuthorized: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const run = JSON.parse(readFileSync(0, "utf8"));
    const decision = classifyCiRun(run, process.env.GITHUB_REPOSITORY);
    process.stdout.write(JSON.stringify(decision) + "\n");
  } catch {
    process.stderr.write("Invalid GitHub CI run input\n");
    process.exitCode = 1;
  }
}
