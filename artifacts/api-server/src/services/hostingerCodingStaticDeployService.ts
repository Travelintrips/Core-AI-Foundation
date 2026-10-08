import JSZip from "jszip";

const HOSTINGER_API_BASE = "https://developers.hostinger.com/api";
const GITHUB_API_BASE = "https://api.github.com";
const CODING_DOMAIN = "coding.cstlogistic.co.id";
const SOURCE_DOMAIN = "aicore.cstlogistic.co.id";
const BUILD_ARTIFACT_NAME = "core-ai-foundation-build";

type HostingWebsite = {
  domain?: string;
  username?: string | null;
  order_id?: number | null;
  is_enabled?: boolean;
  website_type?: string | null;
};

type GitHubRun = {
  id?: number;
  head_sha?: string;
  conclusion?: string | null;
  status?: string;
};

type GitHubArtifact = {
  id?: number;
  name?: string;
  expired?: boolean;
};

export type CodingStaticDeployResult = {
  domain: string;
  sourceSha: string;
  username: string;
  orderId: number;
  websiteCreated: boolean;
  staleBindingRemoved: boolean;
  artifactId: number;
  artifactBytes: number;
  staticArchiveBytes: number;
  deployed: true;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo || repository.split("/").length !== 2) {
    throw new Error("GitHub repository must use owner/name format.");
  }
  return { owner, repo };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

function responseMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = (payload as Record<string, unknown>)["message"];
  return typeof value === "string" ? value : "";
}

async function hostingerRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; data: unknown }> {
  const response = await fetch(`${HOSTINGER_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { response, data: await readJson(response) };
}

async function listWebsites(token: string): Promise<HostingWebsite[]> {
  const { response, data } = await hostingerRequest(
    token,
    "/hosting/v1/websites?per_page=100",
  );
  if (!response.ok) {
    throw new Error(`Hostinger website discovery failed with HTTP ${response.status}.`);
  }
  if (Array.isArray(data)) return data as HostingWebsite[];
  if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { data?: unknown[] }).data)
  ) {
    return (data as { data: HostingWebsite[] }).data;
  }
  return [];
}

async function waitForWebsite(
  token: string,
  domain: string,
  present: boolean,
  attempts = 24,
): Promise<HostingWebsite | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const website = (await listWebsites(token)).find(
      (item) => item.domain?.toLowerCase() === domain.toLowerCase(),
    );
    if (present && website) return website;
    if (!present && !website) return null;
    if (attempt < attempts - 1) await sleep(5_000);
  }
  return null;
}

export async function removeLegacyCodingParkedDomain(
  token: string,
  username: string,
): Promise<boolean> {
  const path =
    `/hosting/v1/accounts/${encodeURIComponent(username)}/websites/${encodeURIComponent(SOURCE_DOMAIN)}/parked-domains`;
  const listed = await hostingerRequest(token, path);
  if (!listed.response.ok) {
    throw new Error(
      `Hostinger parked-domain discovery failed with HTTP ${listed.response.status}.`,
    );
  }

  const parkedDomains = Array.isArray(listed.data)
    ? listed.data
    : listed.data &&
        typeof listed.data === "object" &&
        Array.isArray((listed.data as { data?: unknown[] }).data)
      ? (listed.data as { data: unknown[] }).data
      : [];

  const exact = parkedDomains.some((item) => {
    if (!item || typeof item !== "object") return false;
    const domain = (item as Record<string, unknown>)["domain"];
    return typeof domain === "string" &&
      domain.toLowerCase() === CODING_DOMAIN.toLowerCase();
  });
  if (!exact) return false;

  const removed = await hostingerRequest(
    token,
    `${path}/${encodeURIComponent(CODING_DOMAIN)}`,
    { method: "DELETE" },
  );
  if (!removed.response.ok && removed.response.status !== 404) {
    throw new Error(
      `Hostinger legacy coding parked-domain cleanup failed with HTTP ${removed.response.status}.`,
    );
  }
  return removed.response.ok;
}

async function ensureCodingWebsite(
  token: string,
): Promise<{
  website: HostingWebsite;
  created: boolean;
  staleBindingRemoved: boolean;
}> {
  let websites = await listWebsites(token);
  let existing = websites.find(
    (item) => item.domain?.toLowerCase() === CODING_DOMAIN,
  );
  if (existing) {
    return { website: existing, created: false, staleBindingRemoved: false };
  }

  const source = websites.find(
    (item) =>
      item.domain?.toLowerCase() === SOURCE_DOMAIN &&
      item.is_enabled !== false &&
      typeof item.order_id === "number" &&
      typeof item.username === "string",
  );
  if (!source?.order_id) {
    throw new Error("Cannot derive Hostinger order_id from the live aicore website.");
  }

  let staleBindingRemoved = false;
  let create = await hostingerRequest(token, "/hosting/v1/websites", {
    method: "POST",
    body: JSON.stringify({
      domain: CODING_DOMAIN,
      order_id: source.order_id,
    }),
  });

  if (
    create.response.status === 422 &&
    /already (?:hosted|in use)/i.test(responseMessage(create.data))
  ) {
    // The old coding site existed as a parked-domain alias on the aicore
    // website. Remove only that exact legacy binding, then immediately retry
    // provisioning so the repair does not leave the hostname detached.
    if (typeof source.username === "string") {
      const removedParked = await removeLegacyCodingParkedDomain(
        token,
        source.username,
      );
      if (removedParked) {
        staleBindingRemoved = true;
        await sleep(5_000);
        create = await hostingerRequest(token, "/hosting/v1/websites", {
          method: "POST",
          body: JSON.stringify({
            domain: CODING_DOMAIN,
            order_id: source.order_id,
          }),
        });
      }
    }

    if (
      create.response.status === 422 &&
      /already (?:hosted|in use)/i.test(responseMessage(create.data))
    ) {
      // A removed subdomain can remain in Hostinger's website registry after
      // it disappears from normal discovery. Delete the exact website identity
      // once, then retry provisioning after propagation.
      const cleanup = await hostingerRequest(
        token,
        `/hosting/v1/websites/${encodeURIComponent(CODING_DOMAIN)}`,
        { method: "DELETE" },
      );
      if (cleanup.response.ok || cleanup.response.status === 404) {
        staleBindingRemoved ||= cleanup.response.ok;
        await waitForWebsite(token, CODING_DOMAIN, false, 12);
        await sleep(5_000);
        create = await hostingerRequest(token, "/hosting/v1/websites", {
          method: "POST",
          body: JSON.stringify({
            domain: CODING_DOMAIN,
            order_id: source.order_id,
          }),
        });
      }
    }
  }

  if (!create.response.ok) {
    throw new Error(
      `Hostinger coding website create failed with HTTP ${create.response.status}: ${responseMessage(create.data) || "unknown error"}`,
    );
  }

  const provisioned = await waitForWebsite(token, CODING_DOMAIN, true);
  if (!provisioned) {
    throw new Error("Hostinger accepted coding website creation but it did not appear before timeout.");
  }

  websites = await listWebsites(token);
  existing =
    websites.find((item) => item.domain?.toLowerCase() === CODING_DOMAIN) ??
    provisioned;

  return {
    website: existing,
    created: true,
    staleBindingRemoved,
  };
}

async function githubRequest(
  token: string,
  url: string,
): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "CST-AI-Core-Coding-Static-Deploy/1.0",
    },
  });
}

async function currentMainSha(
  githubToken: string,
  repository: string,
): Promise<string> {
  const { owner, repo } = repositoryParts(repository);
  const response = await githubRequest(
    githubToken,
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/main`,
  );
  const data = await readJson(response);
  const sha =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)["sha"]
      : null;
  if (!response.ok || typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error("Current GitHub main SHA is unavailable.");
  }
  return sha.toLowerCase();
}

async function downloadAiPlatformArtifact(
  githubToken: string,
  repository: string,
  sha: string,
): Promise<{ artifactId: number; artifact: Buffer }> {
  const { owner, repo } = repositoryParts(repository);
  const runsResponse = await githubRequest(
    githubToken,
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=30`,
  );
  const runsData = await readJson(runsResponse);
  const runs =
    runsData &&
    typeof runsData === "object" &&
    Array.isArray((runsData as { workflow_runs?: unknown[] }).workflow_runs)
      ? (runsData as { workflow_runs: GitHubRun[] }).workflow_runs
      : [];
  const run = runs.find(
    (item) =>
      item.head_sha?.toLowerCase() === sha &&
      item.status === "completed" &&
      item.conclusion === "success" &&
      typeof item.id === "number",
  );
  if (!runsResponse.ok || !run?.id) {
    throw new Error(`No successful CI artifact is available for main SHA ${sha}.`);
  }

  const artifactsResponse = await githubRequest(
    githubToken,
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${run.id}/artifacts?per_page=100`,
  );
  const artifactsData = await readJson(artifactsResponse);
  const artifacts =
    artifactsData &&
    typeof artifactsData === "object" &&
    Array.isArray((artifactsData as { artifacts?: unknown[] }).artifacts)
      ? (artifactsData as { artifacts: GitHubArtifact[] }).artifacts
      : [];
  const artifact = artifacts.find(
    (item) =>
      item.name === BUILD_ARTIFACT_NAME &&
      item.expired !== true &&
      typeof item.id === "number",
  );
  if (!artifactsResponse.ok || !artifact?.id) {
    throw new Error(`Build artifact ${BUILD_ARTIFACT_NAME} is unavailable for CI run ${run.id}.`);
  }

  const downloadResponse = await githubRequest(
    githubToken,
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`,
  );
  if (!downloadResponse.ok) {
    throw new Error(`GitHub artifact download failed with HTTP ${downloadResponse.status}.`);
  }
  const bytes = Buffer.from(await downloadResponse.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 150 * 1024 * 1024) {
    throw new Error("GitHub build artifact size is invalid.");
  }
  return { artifactId: artifact.id, artifact: bytes };
}

export async function extractAiPlatformStaticArchive(
  artifactZip: Buffer,
  sha: string,
): Promise<Buffer> {
  const input = await JSZip.loadAsync(artifactZip);
  const names = Object.keys(input.files);
  const indexPath = names.find(
    (name) =>
      name === "ai-platform/dist/index.html" ||
      name === "artifacts/ai-platform/dist/index.html" ||
      name.endsWith("/ai-platform/dist/index.html"),
  );
  if (!indexPath) {
    throw new Error("AI Platform index.html is missing from the CI build artifact.");
  }
  const prefix = indexPath.slice(0, -"index.html".length);
  const output = new JSZip();
  let copied = 0;

  for (const name of names) {
    if (!name.startsWith(prefix) || input.files[name]?.dir) continue;
    const relative = name.slice(prefix.length);
    if (!relative) continue;
    output.file(relative, await input.files[name]!.async("nodebuffer"));
    copied += 1;
  }

  if (copied < 2) {
    throw new Error("AI Platform build artifact did not contain deployable static files.");
  }

  output.file(
    ".htaccess",
    [
      "Options -MultiViews",
      "RewriteEngine On",
      "RewriteCond %{REQUEST_FILENAME} -f [OR]",
      "RewriteCond %{REQUEST_FILENAME} -d",
      "RewriteRule ^ - [L]",
      "RewriteRule . /index.html [L]",
      "",
    ].join("\n"),
  );
  output.file("cst-build-sha.txt", `${sha}\n`);

  return output.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

async function uploadHostingerArchive(input: {
  token: string;
  username: string;
  domain: string;
  archiveName: string;
  bytes: Buffer;
}): Promise<void> {
  const uploadUrlRequest = await hostingerRequest(
    input.token,
    "/hosting/v1/files/upload-urls",
    {
      method: "POST",
      body: JSON.stringify({
        username: input.username,
        domain: input.domain,
      }),
    },
  );
  if (!uploadUrlRequest.response.ok) {
    throw new Error(
      `Hostinger upload URL request failed with HTTP ${uploadUrlRequest.response.status}.`,
    );
  }
  const payload =
    uploadUrlRequest.data && typeof uploadUrlRequest.data === "object"
      ? (uploadUrlRequest.data as Record<string, unknown>)
      : {};
  const uploadBase = typeof payload["url"] === "string" ? payload["url"] : "";
  const authKey = typeof payload["auth_key"] === "string" ? payload["auth_key"] : "";
  const restAuthKey =
    typeof payload["rest_auth_key"] === "string" ? payload["rest_auth_key"] : "";
  if (!uploadBase || !authKey || !restAuthKey) {
    throw new Error("Hostinger did not return complete upload credentials.");
  }

  const target = `${uploadBase.replace(/\/$/, "")}/${encodeURIComponent(input.archiveName)}?override=true`;
  const commonHeaders = {
    "X-Auth": authKey,
    "X-Auth-Rest": restAuthKey,
    "Tus-Resumable": "1.0.0",
  };

  const create = await fetch(target, {
    method: "POST",
    headers: {
      ...commonHeaders,
      "Upload-Length": String(input.bytes.byteLength),
      "Upload-Offset": "0",
    },
  });
  if (create.status !== 201) {
    throw new Error(`Hostinger TUS create failed with HTTP ${create.status}.`);
  }

  const patch = await fetch(target, {
    method: "PATCH",
    headers: {
      ...commonHeaders,
      "Content-Type": "application/offset+octet-stream",
      "Upload-Offset": "0",
    },
    body: new Uint8Array(input.bytes),
  });
  if (patch.status !== 204) {
    throw new Error(`Hostinger TUS upload failed with HTTP ${patch.status}.`);
  }

  const uploaded = Number.parseInt(patch.headers.get("upload-offset") ?? "", 10);
  if (Number.isFinite(uploaded) && uploaded !== input.bytes.byteLength) {
    throw new Error(
      `Hostinger upload offset mismatch: uploaded=${uploaded} expected=${input.bytes.byteLength}.`,
    );
  }
}

export async function deployCodingStaticSite(input: {
  env?: NodeJS.ProcessEnv;
  repository?: string;
} = {}): Promise<CodingStaticDeployResult> {
  const env = input.env ?? process.env;
  const hostingerToken = (env["HOSTINGER_API_TOKEN"] ?? "").trim();
  const githubToken = (
    env["AI_CODING_GITHUB_TOKEN"] ??
    env["GITHUB_TOKEN"] ??
    env["GH_TOKEN"] ??
    ""
  ).trim();
  if (!hostingerToken) {
    throw new Error("Coding static deploy requires HOSTINGER_API_TOKEN.");
  }
  if (!githubToken) {
    throw new Error("Coding static deploy requires an AI Core GitHub token.");
  }

  const repository =
    input.repository?.trim() ||
    env["AI_CORE_DEFAULT_GITHUB_REPOSITORY"]?.trim() ||
    "Travelintrips/Core-AI-Foundation";
  const sha = await currentMainSha(githubToken, repository);
  const website = await ensureCodingWebsite(hostingerToken);
  if (!website.website.username || typeof website.website.order_id !== "number") {
    throw new Error("Hostinger coding website does not expose username/order_id.");
  }

  const build = await downloadAiPlatformArtifact(githubToken, repository, sha);
  const staticArchive = await extractAiPlatformStaticArchive(build.artifact, sha);
  const archiveName = `aicoding-${sha}.zip`;

  await uploadHostingerArchive({
    token: hostingerToken,
    username: website.website.username,
    domain: CODING_DOMAIN,
    archiveName,
    bytes: staticArchive,
  });

  let deployed = await hostingerRequest(
    hostingerToken,
    `/hosting/v1/accounts/${encodeURIComponent(website.website.username)}/websites/${encodeURIComponent(CODING_DOMAIN)}/deploy`,
    {
      method: "POST",
      body: JSON.stringify({ archive_path: archiveName }),
    },
  );
  if (
    !deployed.response.ok &&
    deployed.response.status === 422
  ) {
    deployed = await hostingerRequest(
      hostingerToken,
      `/hosting/v1/accounts/${encodeURIComponent(website.website.username)}/websites/${encodeURIComponent(CODING_DOMAIN)}/deploy`,
      {
        method: "POST",
        body: JSON.stringify({ archive_path: `uploads/${archiveName}` }),
      },
    );
  }
  if (!deployed.response.ok) {
    throw new Error(
      `Hostinger static deploy failed with HTTP ${deployed.response.status}: ${responseMessage(deployed.data) || "unknown error"}`,
    );
  }

  return {
    domain: CODING_DOMAIN,
    sourceSha: sha,
    username: website.website.username,
    orderId: website.website.order_id,
    websiteCreated: website.created,
    staleBindingRemoved: website.staleBindingRemoved,
    artifactId: build.artifactId,
    artifactBytes: build.artifact.byteLength,
    staticArchiveBytes: staticArchive.byteLength,
    deployed: true,
  };
}
