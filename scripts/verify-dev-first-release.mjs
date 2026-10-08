/**
 * Fail-closed AI Core promotion gate.
 *
 * A production commit MUST descend from the exact DEV commit deployed live,
 * with successful full CI, DEV verification and DEV deployment at that SHA.
 * Changes made exclusively for the DEV host may differ, but application
 * changes to shared files must be byte-for-byte equal before release.
 *
 * Actions and Hostinger native Git integration are separate release paths;
 * this gate protects GitHub Actions deployment only.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const shaPattern = /^[a-f0-9]{40}$/i;
const allowedDevDifferences = new Set([
  ".github/workflows/ci.yml",
  ".github/workflows/dev-fast-verify.yml",
  ".github/workflows/hostinger-dev-deploy.yml",
  ".github/workflows/hostinger-dev-discovery.yml",
  ".replit",
  "artifacts/api-server/build.mjs",
  "artifacts/api-server/src/app.ts",
  "artifacts/api-server/src/index.ts",
  "artifacts/api-server/src/lib/supabaseStorage.ts",
  "artifacts/api-server/src/services/__tests__/codingConflictRegistryService.test.ts",
  "artifacts/api-server/src/services/codingConflictRegistryService.ts",
  "deploy/dev-hostinger/Dockerfile",
  "deploy/dev-hostinger/docker-compose.yml",
  "deploy/hostinger-dev/Dockerfile",
  "deploy/hostinger-dev/Dockerfile.dockerignore",
  "lib/db/src/env.ts",
]);

export const requiredDevWorkflows = Object.freeze([
  "CI Verify",
  "DEV Fast Verify",
  "Hostinger DEV Deploy",
]);

export function verifyDevEvidence({ expectedSha, devSha, developHead, runs, differentFiles }) {
  if (!shaPattern.test(expectedSha) || !shaPattern.test(devSha) || !shaPattern.test(developHead)) {
    throw new Error("Invalid Git commit SHA in DEV-first promotion evidence.");
  }
  if (devSha !== developHead) {
    throw new Error("Live DEV is not on the current develop commit.");
  }
  const failed = requiredDevWorkflows.filter((name) =>
    !runs.some((run) => run.name === name &&
      run.head_sha === devSha &&
      run.head_branch === "develop" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      ["push", "workflow_dispatch"].includes(run.event)),
  );
  if (failed.length) {
    throw new Error("Required DEV checks missing or failed for exact live SHA: " + failed.join(", "));
  }
  const unmatched = differentFiles.filter((file) => !allowedDevDifferences.has(file));
  if (unmatched.length) {
    throw new Error("PROD and tested DEV differ on shared files: " + unmatched.join(", "));
  }
  return { expectedSha, devSha, requiredChecks: requiredDevWorkflows };
}

function checkedGit(...args) {
  return execFileSync("git", args, { encoding: "utf8", timeout: 30_000 }).trim();
}

async function githubGet(path, token) {
  const response = await fetch("https://api.github.com" + path, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("GitHub evidence request failed: HTTP " + response.status);
  return response.json();
}

async function checkPromotion() {
  const expectedSha = process.argv[2] || process.env.EXPECTED_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!shaPattern.test(expectedSha ?? "") || !repoPattern.test(repo ?? "") || !token) {
    throw new Error("EXPECTED_SHA, GITHUB_REPOSITORY and GITHUB_TOKEN are required.");
  }
  // Fetch explicit develop head and ensure the candidate cannot bypass the
  // DEV-first route simply by being pushed directly to main.
  checkedGit("fetch", "--no-tags", "origin", "develop");
  const developHead = checkedGit("rev-parse", "FETCH_HEAD");
  const health = await fetch("https://dev-aicore.cstlogistic.co.id/api/healthz", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (health.status !== 200) throw new Error("Live DEV is unhealthy: HTTP " + health.status);
  const devSha = health.headers.get("x-cst-commit-sha")?.trim() ?? "";
  const healthBody = await health.json();
  if (healthBody?.status !== "ok") throw new Error("Live DEV health body is not ok.");
  if (!shaPattern.test(devSha)) throw new Error("Live DEV did not report a valid commit SHA.");
  // The exact tested DEV snapshot must be a parent of the production release.
  // Squashing a direct-to-main PR drops this ancestry and must therefore fail.
  try {
    checkedGit("merge-base", "--is-ancestor", devSha, expectedSha);
  } catch {
    throw new Error("Production release is not descended from live tested DEV; promote via a merge commit.");
  }
  // DEV-only runtime variants are reviewed separately. Any other source file
  // change after DEV testing is a fail-closed release blocker.
  const changed = checkedGit("diff", "--name-only", expectedSha, devSha);
  const differentFiles = changed ? changed.split("\n") : [];

  const runs = [];
  for (let page = 1; page <= 3; page++) {
    const result = await githubGet(
      "/repos/" + repo + "/actions/runs?branch=develop&head_sha=" +
      encodeURIComponent(devSha) + "&per_page=100&page=" + page,
      token,
    );
    runs.push(...(result.workflow_runs ?? []));
    if ((result.workflow_runs ?? []).length < 100) break;
  }
  const result = verifyDevEvidence({ expectedSha, devSha, developHead, runs, differentFiles });
  console.log("DEV_FIRST_PROMOTION=PASS " + JSON.stringify(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL("file://" + process.argv[1]))) {
  checkPromotion().catch((error) => {
    console.error("DEV_FIRST_PROMOTION=BLOCKED " + String(error.message || error));
    process.exitCode = 1;
  });
}
