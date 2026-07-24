/**
 * providerHealthAlertService.test.ts
 *
 * Unit tests for the background provider health alert poller.
 *
 * Scenarios covered:
 *  1. Alert fires when consecutiveFailures >= threshold
 *  2. Suppression (de-dup): alert does NOT re-fire once delivered
 *  3. Auto-clear on recovery: provider removed from alerted set, recovery notification sent
 *  4. SSRF guard: private/localhost webhook URLs are blocked before fetch is called
 *
 * All DB, email, and outbound network calls are mocked.
 * validateExternalUrl is NOT mocked — we test real SSRF logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock handles ──────────────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() factories so these refs can be used inside them.

const mocks = vi.hoisted(() => {
  const mockDbWhere = vi.fn();
  const mockDbFrom = vi.fn().mockReturnValue({ where: mockDbWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbFrom });

  const mockDbInsertValues = vi.fn().mockResolvedValue(undefined);
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockDbInsertValues });

  const mockRunAllHealthChecks = vi.fn();
  const mockSendEmail = vi.fn().mockResolvedValue({ ok: true });
  const mockFetch = vi.fn().mockResolvedValue({ ok: true });

  return {
    mockDbSelect,
    mockDbFrom,
    mockDbWhere,
    mockDbInsert,
    mockDbInsertValues,
    mockRunAllHealthChecks,
    mockSendEmail,
    mockFetch,
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.mockDbSelect,
    insert: mocks.mockDbInsert,
  },
  aiSettingsTable: {
    key: "key",
    value: "value",
    valueType: "value_type",
    category: "category",
    description: "description",
    isSecret: "is_secret",
  },
}));

// drizzle-orm: eq() returns a sentinel object carrying the value so we can
// inspect it in the where() mock implementation.
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  lt: vi.fn(),
  and: vi.fn(),
}));

vi.mock("../services/providerHealthService.js", () => ({
  runAllHealthChecks: mocks.mockRunAllHealthChecks,
}));

vi.mock("../services/emailService.js", () => ({
  sendEmail: mocks.mockSendEmail,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Stub global fetch used by webhook delivery
vi.stubGlobal("fetch", mocks.mockFetch);

// ── Import the module under test (after mocks are set up) ─────────────────────

import {
  pollOnce,
  getAlertedProviders,
  _resetAlertedProvidersForTest,
} from "../services/providerHealthAlertService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Configure db.select().from().where() to return settings values keyed by
 * the sentinel value that eq() injects into the where() call.
 * This is robust against call ordering — each getSetting() call resolves by key.
 */
function setupSettingsMock(settings: {
  enabled?: string;
  threshold?: string;
  email?: string;
  webhookUrl?: string;
} = {}) {
  const map: Record<string, string> = {
    "provider_alert.enabled": settings.enabled ?? "true",
    "provider_alert.failure_threshold": settings.threshold ?? "3",
    "provider_alert.email": settings.email ?? "",
    "provider_alert.webhook_url": settings.webhookUrl ?? "",
  };

  // where() receives { __eq: "<setting-key>" } thanks to our drizzle eq() mock
  mocks.mockDbWhere.mockImplementation(
    async (condition: { __eq?: string }) => {
      const key = condition?.__eq ?? "";
      const value = map[key] ?? "";
      return [{ value }];
    },
  );
}

/** A standard failing provider result */
function failingProvider(overrides: Partial<{
  providerId: number;
  slug: string;
  consecutiveFailures: number;
  pingOk: boolean;
  error: string | null;
}> = {}) {
  return {
    providerId: 1,
    slug: "openai",
    consecutiveFailures: 3,
    pingOk: false,
    error: "HTTP 500: Internal Server Error",
    ...overrides,
  };
}

/** A recovered provider result (pingOk=true, consecutiveFailures=0) */
function recoveredProvider(overrides: Partial<{
  providerId: number;
  slug: string;
}> = {}) {
  return {
    providerId: 1,
    slug: "openai",
    consecutiveFailures: 0,
    pingOk: true,
    error: null,
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // resetAllMocks clears call counts AND implementation/return-value queues.
  vi.resetAllMocks();
  _resetAlertedProvidersForTest();

  // Restore the DB query chain (resetAllMocks clears mockReturnValue implementations)
  mocks.mockDbFrom.mockReturnValue({ where: mocks.mockDbWhere });
  mocks.mockDbSelect.mockReturnValue({ from: mocks.mockDbFrom });
  mocks.mockDbInsert.mockReturnValue({ values: mocks.mockDbInsertValues });
  mocks.mockDbInsertValues.mockResolvedValue(undefined);

  // Default delivery success
  mocks.mockSendEmail.mockResolvedValue({ ok: true });
  mocks.mockFetch.mockResolvedValue({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Alert fires at threshold
// ─────────────────────────────────────────────────────────────────────────────

describe("pollOnce — alert fires at threshold", () => {
  it("sends an email alert when consecutiveFailures >= threshold and email is configured", async () => {
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ consecutiveFailures: 3 })]);

    await pollOnce();

    expect(mocks.mockSendEmail).toHaveBeenCalledOnce();
    expect(mocks.mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        subject: expect.stringContaining("openai"),
      }),
    );
  });

  it("sends to multiple email addresses (comma-separated)", async () => {
    setupSettingsMock({ threshold: "2", email: "a@example.com, b@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ consecutiveFailures: 2 })]);

    await pollOnce();

    expect(mocks.mockSendEmail).toHaveBeenCalledTimes(2);
    const recipients = mocks.mockSendEmail.mock.calls.map(
      (c: [{ to: string }]) => c[0].to,
    );
    expect(recipients).toContain("a@example.com");
    expect(recipients).toContain("b@example.com");
  });

  it("fires at exactly threshold (boundary)", async () => {
    setupSettingsMock({ threshold: "5", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ consecutiveFailures: 5 })]);

    await pollOnce();

    expect(mocks.mockSendEmail).toHaveBeenCalledOnce();
  });

  it("does NOT alert when consecutiveFailures is below threshold", async () => {
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ consecutiveFailures: 2 })]);

    await pollOnce();

    expect(mocks.mockSendEmail).not.toHaveBeenCalled();
  });

  it("does NOT poll or alert when provider_alert.enabled is 'false'", async () => {
    setupSettingsMock({ enabled: "false" });
    // runAllHealthChecks should never be called
    mocks.mockRunAllHealthChecks.mockResolvedValue([]);

    await pollOnce();

    expect(mocks.mockSendEmail).not.toHaveBeenCalled();
    expect(mocks.mockRunAllHealthChecks).not.toHaveBeenCalled();
  });

  it("skips result entries that carry notFound flag", async () => {
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([
      { error: "Provider not found", notFound: true },
      failingProvider({ consecutiveFailures: 3 }),
    ]);

    await pollOnce();

    // Only the real failing provider triggers an alert
    expect(mocks.mockSendEmail).toHaveBeenCalledOnce();
  });

  it("marks provider as alerted after successful email delivery", async () => {
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 42 })]);

    await pollOnce();

    expect(getAlertedProviders()).toContain(42);
  });

  it("does NOT mark provider as alerted when no channels are configured", async () => {
    setupSettingsMock({ threshold: "3", email: "", webhookUrl: "" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 7 })]);

    await pollOnce();

    // No channel → delivery not attempted → not added to alerted set → retried next cycle
    expect(getAlertedProviders()).not.toContain(7);
    expect(mocks.mockSendEmail).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Suppression (de-dup guard)
// ─────────────────────────────────────────────────────────────────────────────

describe("pollOnce — suppression after first alert", () => {
  it("does NOT re-send email on the second poll cycle for the same failing provider", async () => {
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 1 })]);

    // First cycle — alert fires
    await pollOnce();
    expect(mocks.mockSendEmail).toHaveBeenCalledOnce();
    expect(getAlertedProviders()).toContain(1);

    vi.clearAllMocks();
    mocks.mockSendEmail.mockResolvedValue({ ok: true });
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 1 })]);

    // Second cycle — still down, same provider → must be suppressed
    await pollOnce();

    expect(mocks.mockSendEmail).not.toHaveBeenCalled();
  });

  it("tracks each provider independently — suppressing one does not suppress another", async () => {
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([
      failingProvider({ providerId: 1, slug: "openai" }),
      failingProvider({ providerId: 2, slug: "anthropic" }),
    ]);

    await pollOnce();

    // Both providers should receive alerts
    expect(mocks.mockSendEmail).toHaveBeenCalledTimes(2);
    expect(getAlertedProviders()).toContain(1);
    expect(getAlertedProviders()).toContain(2);
  });

  it("re-alerts after a provider recovers then fails again", async () => {
    // Cycle 1: provider fails → alert fires
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 1 })]);
    await pollOnce();
    expect(getAlertedProviders()).toContain(1);

    // Cycle 2: provider recovers → cleared from alerted set
    vi.clearAllMocks();
    mocks.mockSendEmail.mockResolvedValue({ ok: true });
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([recoveredProvider({ providerId: 1 })]);
    await pollOnce();
    expect(getAlertedProviders()).not.toContain(1);

    // Cycle 3: provider fails again → alert must fire again (not suppressed)
    vi.clearAllMocks();
    mocks.mockSendEmail.mockResolvedValue({ ok: true });
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 1 })]);
    await pollOnce();

    expect(mocks.mockSendEmail).toHaveBeenCalledOnce();
    expect(getAlertedProviders()).toContain(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Auto-clear on recovery
// ─────────────────────────────────────────────────────────────────────────────

describe("pollOnce — auto-clear on recovery", () => {
  it("removes provider from alerted set when it recovers (pingOk=true, consecutiveFailures=0)", async () => {
    // Seed the alert state
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 1 })]);
    await pollOnce();
    expect(getAlertedProviders()).toContain(1);

    // Recovery poll
    vi.clearAllMocks();
    mocks.mockSendEmail.mockResolvedValue({ ok: true });
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([recoveredProvider({ providerId: 1 })]);
    await pollOnce();

    expect(getAlertedProviders()).not.toContain(1);
  });

  it("sends a recovery notification email on auto-clear", async () => {
    // Seed the alert
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 1, slug: "openai" })]);
    await pollOnce();

    // Recovery
    vi.clearAllMocks();
    mocks.mockSendEmail.mockResolvedValue({ ok: true });
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([recoveredProvider({ providerId: 1, slug: "openai" })]);
    await pollOnce();

    expect(mocks.mockSendEmail).toHaveBeenCalledOnce();
    expect(mocks.mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        subject: expect.stringContaining("openai"),
      }),
    );
  });

  it("does NOT send a recovery notification if the provider was never alerted", async () => {
    // Provider recovers without ever having been in the alerted set
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([recoveredProvider({ providerId: 99 })]);

    await pollOnce();

    expect(mocks.mockSendEmail).not.toHaveBeenCalled();
    expect(getAlertedProviders()).not.toContain(99);
  });

  it("does not fire for a provider still failing but below threshold", async () => {
    setupSettingsMock({ threshold: "3", email: "admin@example.com" });
    mocks.mockRunAllHealthChecks.mockResolvedValue([
      failingProvider({ consecutiveFailures: 1, pingOk: false }),
    ]);

    await pollOnce();

    expect(mocks.mockSendEmail).not.toHaveBeenCalled();
    expect(getAlertedProviders()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SSRF guard on webhook URL
// ─────────────────────────────────────────────────────────────────────────────

describe("pollOnce — SSRF guard on webhook URL", () => {
  const BLOCKED_URLS = [
    "http://localhost/hook",
    "http://127.0.0.1/hook",
    "http://10.0.0.1/hook",
    "http://192.168.1.1/hook",
    "http://172.16.0.1/hook",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/",
  ];

  for (const blockedUrl of BLOCKED_URLS) {
    it(`blocks webhook delivery to private URL: ${blockedUrl}`, async () => {
      setupSettingsMock({ threshold: "3", email: "", webhookUrl: blockedUrl });
      mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 1 })]);

      await pollOnce();

      // fetch must never be called for SSRF-blocked URLs
      expect(mocks.mockFetch).not.toHaveBeenCalled();
      // Delivery failed → provider must not be marked alerted
      expect(getAlertedProviders()).not.toContain(1);
    });
  }

  it("allows webhook delivery to a valid HTTPS URL", async () => {
    setupSettingsMock({
      threshold: "3",
      email: "",
      webhookUrl: "https://hooks.example.com/alerts",
    });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 1 })]);

    await pollOnce();

    expect(mocks.mockFetch).toHaveBeenCalledOnce();
    expect(mocks.mockFetch).toHaveBeenCalledWith(
      "https://hooks.example.com/alerts",
      expect.objectContaining({ method: "POST" }),
    );
    expect(getAlertedProviders()).toContain(1);
  });

  it("includes correct alert payload in webhook POST body", async () => {
    setupSettingsMock({
      threshold: "3",
      email: "",
      webhookUrl: "https://hooks.example.com/alerts",
    });
    mocks.mockRunAllHealthChecks.mockResolvedValue([
      failingProvider({
        providerId: 5,
        slug: "mistral",
        consecutiveFailures: 4,
        error: "timeout",
      }),
    ]);

    await pollOnce();

    expect(mocks.mockFetch).toHaveBeenCalledOnce();
    const [, fetchOptions] = mocks.mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(fetchOptions.body as string);

    expect(body.event).toBe("provider.down");
    expect(body.providerId).toBe(5);
    expect(body.slug).toBe("mistral");
    expect(body.consecutiveFailures).toBe(4);
    expect(body.error).toBe("timeout");
    expect(body.timestamp).toBeDefined();
  });

  it("does NOT mark provider as alerted when webhook fetch throws (network error)", async () => {
    setupSettingsMock({
      threshold: "3",
      email: "",
      webhookUrl: "https://hooks.example.com/alerts",
    });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 1 })]);
    mocks.mockFetch.mockRejectedValue(new Error("network error"));

    await pollOnce();

    // fetch threw → delivery failed → provider must NOT be in alerted set
    expect(getAlertedProviders()).not.toContain(1);
  });

  it("SSRF guard also blocks private webhook URLs in recovery notifications", async () => {
    // Cycle 1: alert fires via valid webhook
    setupSettingsMock({
      threshold: "3",
      email: "",
      webhookUrl: "https://ok.example.com/hook",
    });
    mocks.mockRunAllHealthChecks.mockResolvedValue([failingProvider({ providerId: 2 })]);
    await pollOnce();
    expect(getAlertedProviders()).toContain(2);

    vi.clearAllMocks();
    mocks.mockFetch.mockResolvedValue({ ok: true });

    // Cycle 2: provider recovers but webhook is now a private URL
    setupSettingsMock({
      threshold: "3",
      email: "",
      webhookUrl: "http://192.168.0.1/hook",
    });
    mocks.mockRunAllHealthChecks.mockResolvedValue([recoveredProvider({ providerId: 2 })]);
    await pollOnce();

    // fetch must NOT have been called for the private URL
    expect(mocks.mockFetch).not.toHaveBeenCalled();
    // Alert state should still be cleared (clearAlert deletes from set before attempting delivery)
    expect(getAlertedProviders()).not.toContain(2);
  });
});
