import { execFileSync } from "node:child_process";

const profiles = {
  "core-ai": {
    repository: "Travelintrips/Core-AI-Foundation",
    branch: "develop",
    workflows: ["ci.yml", "dev-fast-verify.yml", "hostinger-dev-deploy.yml"],
    healthUrl: "https://dev.cstlogistic.co.id/api/healthz",
    liveSha: (response) => response.headers.get("x-cst-commit-sha"),
  },
  "sport-center": {
    repository: "Travelintrips/Sport-Center-Admin",
    // The shared VPS DEV service runs the canonical main source.
    branch: "main",
    workflows: ["sport-center-ci.yml"],
    healthUrl: "http://127.0.0.1:3218/healthz",
    liveSha: (_response, body) => body.git_commit,
  },
};

function github(path) {
  return JSON.parse(execFileSync("gh", ["api", path], {
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "ignore"],
  }));
}

async function verify(profile, candidate) {
  const base = "/repos/" + profile.repository;
  const branch = github(base + "/branches/" + profile.branch);
  const sha = candidate ?? branch.commit.sha;
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("A full commit SHA is required.");
  const checks = profile.workflows.map((workflow) => {
    const filters = new URLSearchParams({
      branch: profile.branch, head_sha: sha, per_page: "30",
    });
    const result = github(base + "/actions/workflows/" + workflow + "/runs?" + filters);
    const run = result.workflow_runs.find((entry) =>
      entry.head_sha === sha && entry.head_branch === profile.branch &&
      ["push", "workflow_dispatch"].includes(entry.event),
    );
    return {
      workflow,
      status: run?.status ?? "missing",
      conclusion: run?.conclusion ?? null,
      url: run?.html_url ?? null,
    };
  });

  const response = await fetch(profile.healthUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/json" },
  });
  const body = await response.json();
  const liveSha = profile.liveSha(response, body);
  const branchStillCurrent = github(base + "/branches/" + profile.branch).commit.sha === sha;
  const status = {
    currentCandidate: sha === branch.commit.sha && branchStillCurrent,
    ci: checks.every((check) => check.status === "completed" && check.conclusion === "success"),
    health: response.status === 200 && body.status === "ok",
    exactRuntimeSha: liveSha === sha,
    e2e: "not_checked",
  };
  return { branch: profile.branch, sha, liveSha, checks, status };
}

const [profileName, sha, ...extra] = process.argv.slice(2);
if (!Object.hasOwn(profiles, profileName) || extra.length) {
  console.error("Usage: node scripts/dev/verify-fastlane.mjs <core-ai|sport-center> [full-sha]");
  process.exitCode = 2;
} else {
  try {
    const evidence = await verify(profiles[profileName], sha);
    console.log(JSON.stringify({ profile: profileName, ...evidence }, null, 2));
    const { currentCandidate, ci, health, exactRuntimeSha } = evidence.status;
    if (!(currentCandidate && ci && health && exactRuntimeSha)) process.exitCode = 1;
  } catch (error) {
    console.error("DEV verification unavailable:", error.message);
    process.exitCode = 2;
  }
}
