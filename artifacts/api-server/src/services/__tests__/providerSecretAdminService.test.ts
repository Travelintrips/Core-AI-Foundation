import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient() {
      return {
        async getAccessToken() {
          return { token: "test-access-token" };
        },
      };
    }
  },
}));

import {
  getProviderSecretAdminStatus,
  upsertProviderSecretAdminValue,
} from "../providerSecretAdminService.js";

const env = {
  GCP_SECRET_MANAGER_BOOTSTRAP_JSON: JSON.stringify({
    project_id: "test-project",
    client_email: "test@example.invalid",
    private_key: "redacted-test-key",
  }),
};

function accessResponse(values: Record<string, string>) {
  return new Response(JSON.stringify({
    payload: {
      data: Buffer.from(JSON.stringify(values), "utf8").toString("base64"),
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Secure Provider Secret Admin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns configured key names without exposing secret values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(accessResponse({
      OPENAI_ADMIN_KEY: "super-secret-openai",
      OPENAI_MONTHLY_BUDGET_USD: "250",
      UNRELATED_SECRET: "do-not-expose",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getProviderSecretAdminStatus(env);

    expect(result.configuredKeys).toContain("OPENAI_ADMIN_KEY");
    expect(result.configuredKeys).toContain("OPENAI_MONTHLY_BUDGET_USD");
    expect(result.configuredKeys).not.toContain("UNRELATED_SECRET");
    const encoded = JSON.stringify(result);
    expect(encoded).not.toContain("super-secret-openai");
    expect(encoded).not.toContain("do-not-expose");
    expect(result.secretValuesExposed).toBe(false);
  });

  it("creates a new secret version while preserving existing keys", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(accessResponse({
        EXISTING_KEY: "keep-me",
        OPENAI_ADMIN_KEY: "old-secret",
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "projects/test-project/secrets/aicore-app-secrets/versions/42",
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await upsertProviderSecretAdminValue({
      key: "OPENAI_ADMIN_KEY",
      value: "new-secret",
      env,
    });

    expect(result).toMatchObject({
      key: "OPENAI_ADMIN_KEY",
      created: false,
      secretValuesExposed: false,
    });
    expect(JSON.stringify(result)).not.toContain("new-secret");

    const [writeUrl, writeInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(writeUrl).toContain("aicore-app-secrets:addVersion");
    expect(writeInit.method).toBe("POST");
    const body = JSON.parse(String(writeInit.body)) as { payload: { data: string } };
    const stored = JSON.parse(Buffer.from(body.payload.data, "base64").toString("utf8"));
    expect(stored).toEqual({
      EXISTING_KEY: "keep-me",
      OPENAI_ADMIN_KEY: "new-secret",
    });
  });

  it("rejects keys outside the provider billing allowlist before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(upsertProviderSecretAdminValue({
      key: "DATABASE_URL",
      value: "postgresql://sensitive",
      env,
    })).rejects.toThrow("not allowed");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a redacted permission error when Secret Manager write is denied", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(accessResponse({ OPENAI_ADMIN_KEY: "old-secret" }))
      .mockResolvedValueOnce(new Response("permission denied with irrelevant provider body", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    let message = "";
    try {
      await upsertProviderSecretAdminValue({
        key: "OPENAI_ADMIN_KEY",
        value: "never-echo-this",
        env,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("write permission denied");
    expect(message).not.toContain("never-echo-this");
    expect(message).not.toContain("irrelevant provider body");
  });

  it("validates budget and threshold values before writing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(upsertProviderSecretAdminValue({
      key: "OPENAI_MONTHLY_BUDGET_USD",
      value: "-5",
      env,
    })).rejects.toThrow("positive number");

    await expect(upsertProviderSecretAdminValue({
      key: "AI_PROVIDER_BILLING_ALERT_PERCENT",
      value: "100",
      env,
    })).rejects.toThrow("between 1 and 99");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
