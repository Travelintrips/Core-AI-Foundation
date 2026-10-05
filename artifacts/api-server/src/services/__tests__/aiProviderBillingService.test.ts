import { describe, expect, it } from "vitest";
import { evaluateAiProviderBillingStatus } from "../aiProviderBillingService.js";

describe("AI provider billing status", () => {
  it("keeps unconfigured providers explicit", () => {
    expect(evaluateAiProviderBillingStatus({
      configured: false,
      monthCost: null,
      monthlyBudget: 100,
    }).status).toBe("UNCONFIGURED");
  });

  it("warns after the configured threshold", () => {
    const result = evaluateAiProviderBillingStatus({
      configured: true,
      monthCost: 81,
      monthlyBudget: 100,
      thresholdPercent: 80,
    });
    expect(result.status).toBe("WARNING");
    expect(result.remainingBudget).toBe(19);
    expect(result.usagePercent).toBe(81);
  });

  it("requires top up when budget is exhausted", () => {
    expect(evaluateAiProviderBillingStatus({
      configured: true,
      monthCost: 100,
      monthlyBudget: 100,
      thresholdPercent: 80,
    }).status).toBe("TOP_UP_REQUIRED");
  });

  it("treats HTTP payment-required state as top-up required", () => {
    expect(evaluateAiProviderBillingStatus({
      configured: true,
      monthCost: null,
      monthlyBudget: 100,
      paymentRequired: true,
    }).status).toBe("TOP_UP_REQUIRED");
  });

  it("shows live usage as OK when no alert budget is configured", () => {
    const result = evaluateAiProviderBillingStatus({
      configured: true,
      monthCost: 25,
      monthlyBudget: null,
    });
    expect(result.status).toBe("OK");
    expect(result.usagePercent).toBeNull();
  });
});
