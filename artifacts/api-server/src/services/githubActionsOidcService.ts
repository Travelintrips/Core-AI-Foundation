import { createPublicKey, verify as verifySignature } from "node:crypto";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "ai-core-workers-deploy";
const TRUSTED_REPOSITORY = "Travelintrips/Core-AI-Foundation";
const TRUSTED_REF = "refs/heads/main";
const TRUSTED_ENVIRONMENT = "ai-workers-vps";
const TRUSTED_WORKFLOW_REF =
  "Travelintrips/Core-AI-Foundation/.github/workflows/ai-workers-deploy.yml@refs/heads/main";

type JsonRecord = Record<string, unknown>;

export type GitHubActionsDeployClaims = {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  repository: string;
  ref: string;
  sha?: string;
  environment?: string;
  event_name?: string;
  workflow?: string;
  workflow_ref: string;
  run_id?: string;
  run_attempt?: string;
};

type CachedJwks = {
  expiresAt: number;
  keys: JsonRecord[];
};

let cachedJwks: CachedJwks | null = null;

function decodeBase64UrlJson(value: string): JsonRecord {
  const parsed = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  ) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GitHub OIDC JWT contains invalid JSON.");
  }
  return parsed as JsonRecord;
}

function audienceIncludes(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value === expected;
  return Array.isArray(value) && value.some((item) => item === expected);
}

export function validateGitHubActionsDeployClaims(
  raw: JsonRecord,
  nowSeconds = Math.floor(Date.now() / 1000),
): GitHubActionsDeployClaims {
  const exp = Number(raw["exp"]);
  const nbf = raw["nbf"] == null ? undefined : Number(raw["nbf"]);
  const iat = raw["iat"] == null ? undefined : Number(raw["iat"]);

  if (raw["iss"] !== GITHUB_OIDC_ISSUER) {
    throw new Error("GitHub OIDC issuer is not trusted.");
  }
  if (!audienceIncludes(raw["aud"], GITHUB_OIDC_AUDIENCE)) {
    throw new Error("GitHub OIDC audience is not trusted.");
  }
  if (!Number.isFinite(exp) || exp <= nowSeconds) {
    throw new Error("GitHub OIDC token is expired.");
  }
  if (nbf != null && (!Number.isFinite(nbf) || nbf > nowSeconds + 30)) {
    throw new Error("GitHub OIDC token is not valid yet.");
  }
  if (iat != null && (!Number.isFinite(iat) || iat > nowSeconds + 30)) {
    throw new Error("GitHub OIDC token has an invalid issued-at time.");
  }
  if (raw["repository"] !== TRUSTED_REPOSITORY) {
    throw new Error("GitHub OIDC repository is not trusted.");
  }
  if (raw["ref"] !== TRUSTED_REF) {
    throw new Error("GitHub OIDC ref is not trusted.");
  }
  if (raw["environment"] !== TRUSTED_ENVIRONMENT) {
    throw new Error("GitHub OIDC environment is not trusted.");
  }
  if (raw["workflow_ref"] !== TRUSTED_WORKFLOW_REF) {
    throw new Error("GitHub OIDC workflow is not trusted.");
  }
  const eventName = String(raw["event_name"] ?? "");
  if (!["workflow_dispatch", "workflow_run"].includes(eventName)) {
    throw new Error("GitHub OIDC event is not permitted for AI Workers deploy.");
  }

  return {
    iss: String(raw["iss"]),
    aud: raw["aud"] as string | string[],
    sub: String(raw["sub"] ?? ""),
    exp,
    ...(nbf == null ? {} : { nbf }),
    ...(iat == null ? {} : { iat }),
    ...(typeof raw["jti"] === "string" ? { jti: raw["jti"] } : {}),
    repository: String(raw["repository"]),
    ref: String(raw["ref"]),
    ...(typeof raw["sha"] === "string" ? { sha: raw["sha"] } : {}),
    environment: String(raw["environment"]),
    event_name: eventName,
    ...(typeof raw["workflow"] === "string" ? { workflow: raw["workflow"] } : {}),
    workflow_ref: String(raw["workflow_ref"]),
    ...(typeof raw["run_id"] === "string" ? { run_id: raw["run_id"] } : {}),
    ...(typeof raw["run_attempt"] === "string"
      ? { run_attempt: raw["run_attempt"] }
      : {}),
  };
}

async function getJwks(): Promise<JsonRecord[]> {
  const now = Date.now();
  if (cachedJwks && cachedJwks.expiresAt > now) return cachedJwks.keys;

  const response = await fetch(GITHUB_OIDC_JWKS, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error("GitHub OIDC JWKS endpoint is unavailable.");
  }
  const body = await response.json() as { keys?: unknown };
  const keys = Array.isArray(body.keys)
    ? body.keys.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  if (keys.length === 0) {
    throw new Error("GitHub OIDC JWKS did not return signing keys.");
  }

  cachedJwks = {
    keys,
    expiresAt: now + 5 * 60_000,
  };
  return keys;
}

export async function verifyGitHubActionsDeployToken(
  token: string,
): Promise<GitHubActionsDeployClaims> {
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    throw new Error("GitHub OIDC token is malformed.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeBase64UrlJson(encodedHeader!);
  if (header["alg"] !== "RS256" || typeof header["kid"] !== "string") {
    throw new Error("GitHub OIDC JWT header is not supported.");
  }

  const keys = await getJwks();
  const jwk = keys.find((key) => key["kid"] === header["kid"]);
  if (!jwk) {
    cachedJwks = null;
    const refreshed = await getJwks();
    const retryJwk = refreshed.find((key) => key["kid"] === header["kid"]);
    if (!retryJwk) throw new Error("GitHub OIDC signing key was not found.");
    return verifyWithJwk(parts, retryJwk);
  }
  return verifyWithJwk(parts, jwk);
}

function verifyWithJwk(
  parts: string[],
  jwk: JsonRecord,
): GitHubActionsDeployClaims {
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const key = createPublicKey({
    key: jwk as JsonWebKey,
    format: "jwk",
  });
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(encodedHeader + "." + encodedPayload),
    key,
    Buffer.from(encodedSignature!, "base64url"),
  );
  if (!valid) {
    throw new Error("GitHub OIDC signature validation failed.");
  }

  const payload = decodeBase64UrlJson(encodedPayload!);
  return validateGitHubActionsDeployClaims(payload);
}
