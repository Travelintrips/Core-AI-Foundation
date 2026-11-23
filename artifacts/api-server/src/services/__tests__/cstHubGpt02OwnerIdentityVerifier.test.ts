import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  verifyCstHubGpt02OwnerLink,
  verifyCstHubGpt02OwnerSession,
} from "../cstHubGpt02OwnerIdentityVerifier.js";
import type { Gpt02OwnerActor } from "../gpt02RelockOwnerApprovalService.js";

const NOW = Date.now();
const owner: Gpt02OwnerActor = {
  id: "google_owner123456",
  role: "super_admin",
  companyId: "default",
  email: "owner@example.test",
  authSource: "supabase_google_identity",
  authSupabaseId: "11111111-2222-4333-8444-555555555555",
  authVerifiedAt: NOW,
};

function signedHubToken(actor: Gpt02OwnerActor = owner, authVerifiedAt = actor.authVerifiedAt): string {
  const payload = {
    ...actor,
    authVerifiedAt,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
  };
  return `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.hub-signature-fixture`;
}

function sessionReadiness(overrides: Record<string, unknown> = {}) {
  return {
    googleProofFresh: true,
    googleProofStatus: "SIGNED_SESSION_GOOGLE_PROOF_FRESH",
    requiresFreshGoogleLogin: false,
    proofSource: "signed_app_session",
    readOnly: true,
    operatorApprovalRecorded: false,
    commandBoundConsentVerified: false,
    issuerLeaseGranted: false,
    dispatchPermitted: false,
    resumePermitted: false,
    statusChanged: false,
    ...overrides,
  };
}


function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function ownerLinkReadiness(overrides: Record<string, unknown> = {}) {
  return {
    eligible: true,
    taskId: 183,
    companyId: "default",
    scope: "SUPERADMIN_OWNER_IDENTITY_READ_ONLY",
    ownerSubject: `owner:${owner.id}`,
    googleSessionVerified: true,
    enabledOperatorLinkVerified: true,
    approvalDecisionCreated: false,
    cryptographicOwnerSignatureVerified: false,
    issuerAuthorized: false,
    dispatchPermitted: false,
    readOnly: true,
    ...overrides,
  };
}

describe("CST Hub GPT02 Owner identity adapter", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts only a fresh, signed Hub Google Super Admin session", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sessionReadiness()));
    const actor = await verifyCstHubGpt02OwnerSession({ bearerToken: signedHubToken() });
    expect(actor).toMatchObject(owner);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://dev-ai-task.cstlogistic.co.id/api/auth/gpt02/operator-session-readiness");
    expect(options?.method).toBe("GET");
    expect(options?.redirect).toBe("error");
    expect(new Headers(options?.headers).get("authorization")).toBe(`Bearer ${signedHubToken()}`);
  });

  it("rejects stale claims even if the status endpoint reports fresh", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sessionReadiness()));
    await expect(verifyCstHubGpt02OwnerSession({
      bearerToken: signedHubToken(owner, Date.now() - 6 * 60_000),
    })).rejects.toThrow("GPT02_HUB_OWNER_GOOGLE_SESSION_NOT_FRESH_SUPERADMIN");
  });

  it("rejects Hub sessions without the fresh-Google proof", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sessionReadiness({
      googleProofFresh: false,
      googleProofStatus: "SIGNED_SESSION_GOOGLE_PROOF_EXPIRED",
      requiresFreshGoogleLogin: true,
    })));
    await expect(verifyCstHubGpt02OwnerSession({ bearerToken: signedHubToken() }))
      .rejects.toThrow("GPT02_HUB_OWNER_GOOGLE_SESSION_NOT_FRESH");
  });

  it("accepts only the read-only, exact Owner operator-link result", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ownerLinkReadiness()));
    expect(await verifyCstHubGpt02OwnerLink(owner, signedHubToken())).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://dev-ai-task.cstlogistic.co.id/api/ai-tasks/183/gpt02-owner-identity-readiness?companyId=default");
    expect(options?.method).toBe("GET");
    expect(new Headers(options?.headers).get("authorization")).toMatch(/^Bearer /);
  });

  it("rejects identity results that have any approval or dispatch authority", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ownerLinkReadiness({
      approvalDecisionCreated: true,
    })));
    expect(await verifyCstHubGpt02OwnerLink(owner, signedHubToken())).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse(ownerLinkReadiness({
      dispatchPermitted: true,
    })));
    expect(await verifyCstHubGpt02OwnerLink(owner, signedHubToken())).toBe(false);
  });

  it("rejects non-JSON or oversized Hub verifier responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));
    await expect(verifyCstHubGpt02OwnerSession({ bearerToken: signedHubToken() }))
      .rejects.toThrow("GPT02_HUB_OWNER_VERIFIER_RESPONSE_INVALID");

    fetchMock.mockResolvedValueOnce(new Response("x".repeat(8_193), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(verifyCstHubGpt02OwnerSession({ bearerToken: signedHubToken() }))
      .rejects.toThrow("GPT02_HUB_OWNER_VERIFIER_RESPONSE_TOO_LARGE");
  });

  it("fails closed on verifier unavailability or rejected Hub sessions", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
    await expect(verifyCstHubGpt02OwnerSession({ bearerToken: signedHubToken() }))
      .rejects.toThrow("GPT02_HUB_OWNER_VERIFIER_UNAVAILABLE");

    fetchMock.mockResolvedValueOnce(jsonResponse({}, 403));
    expect(await verifyCstHubGpt02OwnerLink(owner, signedHubToken())).toBe(false);
  });
});
