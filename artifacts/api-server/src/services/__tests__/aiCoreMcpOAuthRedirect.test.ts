import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../internalAuthService.js", () => ({ getInternalUserById: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(() => { throw new Error("DB access forbidden in redirect test"); }) } }));
import {
  issueDynamicClientId,
  isAllowedChatGptRedirect,
} from "../aiCoreMcpOAuthService.js";

const gateway = "http://127.0.0.1:18789/oauth/provider/callback";
const oldCli = "http://127.0.0.1:8989/oauth/callback";

describe("OpenClaw DELL OAuth redirect boundary", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "test-only-session-secret-at-least-32-characters");
    vi.stubEnv("AI_CORE_PUBLIC_BASE_URL", "https://dev.cstlogistic.co.id");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("allows a registered Gateway callback and exact-match only", () => {
    const clientId = issueDynamicClientId([gateway]);
    expect(isAllowedChatGptRedirect(clientId, gateway)).toBe(true);
    expect(isAllowedChatGptRedirect(clientId, oldCli)).toBe(false);
  });

  it("rejects the stale CLI registration for Gateway callback", () => {
    const clientId = issueDynamicClientId([oldCli]);
    expect(isAllowedChatGptRedirect(clientId, gateway)).toBe(false);
    expect(isAllowedChatGptRedirect(clientId, oldCli)).toBe(true);
  });

  it.each([
    "http://example.com:18789/oauth/provider/callback",
    "https://127.0.0.1:18789/oauth/provider/callback",
    "http://127.0.0.1:18789/oauth/provider/callback?code=bad",
    "http://127.0.0.1:18789/oauth/provider/callback#bad",
    "http://127.0.0.1:18789/oauth/provider/callback/extra",
    "http://localhost:18789/oauth/provider/callback?next=evil",
  ])("rejects unsafe callback %s", (uri) => {
    expect(() => issueDynamicClientId([uri])).toThrow("invalid_redirect_uri");
  });
});
