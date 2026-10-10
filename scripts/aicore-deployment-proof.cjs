#!/usr/bin/env node
// Read-only proof gate for AI Core. Never claim production success from CI alone.
const fs = require("node:fs");
const { URL } = require("node:url");
const repo = process.env.GITHUB_REPOSITORY || "Travelintrips/Core-AI-Foundation";
const sha = process.env.EXPECTED_SHA || "";
const endpoint = process.env.PRODUCTION_REVISION_URL || "";
const token = process.env.GITHUB_TOKEN || "";
const output = process.env.EVIDENCE_OUTPUT || "deployment-evidence.json";
const result = { schema: "aicore.deployment-proof.v1", repository: repo, expected_sha: sha,
  checked_at: new Date().toISOString(), status: "UNVERIFIED", ci: [], production: null, errors: [] };
const validSha = /^[0-9a-f]{40}$/;
async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(12000), redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json();
}
async function main() {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid repository");
  if (!validSha.test(sha)) throw new Error("EXPECTED_SHA must be a full 40-character lowercase commit SHA");
  if (!token) throw new Error("GITHUB_TOKEN missing");
  const runsUrl = `https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`;
  const runs = await getJson(runsUrl, { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" });
  result.ci = (runs.workflow_runs || []).filter(r => r.head_sha === sha).map(r => ({
    id: r.id, name: r.name, status: r.status, conclusion: r.conclusion,
    head_sha: r.head_sha, url: r.html_url, created_at: r.created_at, updated_at: r.updated_at
  }));
  // CI evidence is descriptive, not an assertion that code reached production.
  if (!endpoint) throw new Error("PRODUCTION_REVISION_URL missing: cannot prove deployment");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("PRODUCTION_REVISION_URL must be a clean HTTPS URL");
  // The live health endpoint exposes the runtime SHA in x-cst-commit-sha.
  // Do not trust a GitHub manifest or a local checkout as proof of deployed code.
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(12000), redirect: "error"
  });
  if (!response.ok) throw new Error(`Production health HTTP ${response.status}`);
  const health = await response.json();
  if (health?.status !== "ok") throw new Error("Production health is not ok");
  const deployedSha = response.headers.get("x-cst-commit-sha");
  result.production = { revision_url: url.toString(), deployed_sha: deployedSha, health_status: health.status };
  if (!validSha.test(deployedSha || "")) throw new Error("Production runtime returned no valid x-cst-commit-sha");
  if (deployedSha !== sha) throw new Error("Production SHA does not match expected commit");
  result.status = "VERIFIED";
}
main().catch(e => { result.errors.push(e.message); process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
});
