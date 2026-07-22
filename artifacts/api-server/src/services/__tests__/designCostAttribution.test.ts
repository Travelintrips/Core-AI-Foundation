/**
 * designCostAttribution.test.ts — Team 34: Design Cost, Usage, and Budget Attribution
 *
 * 20 required test cases:
 *  1.  complete attribution
 *  2.  missing optional dimensions
 *  3.  duplicate cost detection
 *  4.  retry attribution
 *  5.  canceled execution
 *  6.  provider usage unavailable
 *  7.  estimated cost
 *  8.  actual cost
 *  9.  pricing version
 * 10.  variance
 * 11.  currency mismatch
 * 12.  budget warning
 * 13.  budget block
 * 14.  project summary
 * 15.  order summary
 * 16.  tenant isolation
 * 17.  no secret metadata
 * 18.  idempotent record
 * 19.  existing cost service compatibility
 * 20.  image analytics compatibility
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  DesignUsageAttribution,
  DesignExecutionUsage,
  DesignCostAttribution,
} from "../designCostAttributionService.js";

// ── Shared insertion capture ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = () => any;

const insertedRows: Record<string, unknown>[] = [];
let simulateConflict = false;
let mockSelectImpl: AnyFn | null = null;

function buildDefaultSelect() {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([] as unknown[])),
      limit: vi.fn(() => Promise.resolve([] as unknown[])),
    })),
  };
}

const mockDb = {
  insert: vi.fn(() => ({
    values: vi.fn((v: Record<string, unknown>) => {
      const row = { ...v, id: insertedRows.length + 1 };
      return {
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => {
            if (simulateConflict) return Promise.resolve([]);
            insertedRows.push(row);
            return Promise.resolve([{ id: row.id }]);
          }),
        })),
        returning: vi.fn(() => {
          insertedRows.push(row);
          return Promise.resolve([{
            ...row,
            createdAt: new Date(),
            updatedAt: new Date(),
          }]);
        }),
      };
    }),
  })),

  // Default: returns empty arrays. Tests that need specific results set
  // mockSelectImpl before calling the function under test.
  select: vi.fn(() => {
    if (mockSelectImpl) return mockSelectImpl();
    return buildDefaultSelect();
  }),

  execute: vi.fn(() => Promise.resolve({ rows: [] })),
};

vi.mock("@workspace/db", () => ({
  db:                            mockDb,
  aiCostRecordsTable:            {},
  aiProviderPricingTable:        {},
  designCostAttributionsTable:   {},
  designBudgetPoliciesTable:     {},
}));

const svc = await import("../designCostAttributionService.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAttribution(overrides: Partial<DesignUsageAttribution> = {}): DesignUsageAttribution {
  return {
    tenantId:       "tenant-abc",
    projectId:      "proj-001",
    orderId:        "ord-001",
    workflowId:     "wf-001",
    stageId:        "stage-01",
    artifactId:     "asset-01",
    capabilityId:   "cap-branding",
    pluginId:       "plugin-01",
    agentId:        "agent-001",
    jobId:          "job-001",
    attempt:        0,
    providerId:     "openai",
    modelId:        "gpt-4o",
    operationType:  "text_generation",
    correlationId:  "corr-001",
    idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function makeUsage(overrides: Partial<DesignExecutionUsage> = {}): DesignExecutionUsage {
  return {
    inputTokens:          1000,
    outputTokens:         500,
    cachedTokens:         100,
    imageGenerationCount: null,
    renderCount:          null,
    runtimeSeconds:       1.5,
    storageBytes:         null,
    requestCount:         1,
    retryCount:           0,
    usageAvailable:       true,
    ...overrides,
  };
}

function makeCost(overrides: Partial<DesignCostAttribution> = {}): DesignCostAttribution {
  return {
    estimatedCostUsd:         0.0125,
    providerReportedCostUsd:  null,
    calculatedCostUsd:        0.0127,
    adjustedCostUsd:          null,
    finalAttributableCostUsd: 0.0127,
    currency:                 "USD",
    pricingVersion:           "v2024-01",
    pricingSource:            "ai_provider_pricing",
    pricingCalculatedAt:      new Date(),
    ...overrides,
  };
}

/** Build a mock select that returns `returnValue` from `.from().where()`. */
function mockSelectReturning(returnValue: unknown): AnyFn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return () => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(returnValue)),
      limit: vi.fn(() => Promise.resolve(returnValue)),
    })),
  });
}

/** Queue N consecutive select mocks — each consumed in order by `mockSelectImpl`. */
function queueSelectMocks(mocks: AnyFn[]) {
  let idx = 0;
  mockSelectImpl = () => {
    const fn: AnyFn = mocks[idx] ?? (() => buildDefaultSelect());
    idx++;
    return fn();
  };
}

beforeEach(() => {
  insertedRows.length = 0;
  simulateConflict    = false;
  mockSelectImpl      = null;
  vi.clearAllMocks();
});

// =============================================================================
// 1. Complete attribution
// =============================================================================
describe("1. complete attribution", () => {
  it("records all required and optional dimensions without error", async () => {
    const attribution = makeAttribution();
    const result = await svc.recordDesignCostAttribution({
      attribution,
      usage:           makeUsage(),
      cost:            makeCost(),
      operationStatus: "success",
      costRecordId:    42,
    });

    expect(result.idempotencyKey).toBe(attribution.idempotencyKey);
    expect(result.id).toBeGreaterThan(0);
    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["tenantId"]).toBe("tenant-abc");
    expect(saved["projectId"]).toBe("proj-001");
    expect(saved["jobId"]).toBe("job-001");
    expect(saved["costRecordId"]).toBe(42);
  });
});

// =============================================================================
// 2. Missing optional dimensions
// =============================================================================
describe("2. missing optional dimensions", () => {
  it("records successfully when only required fields are provided", async () => {
    const idem = `min-${Math.random().toString(36).slice(2)}`;
    const result = await svc.recordDesignCostAttribution({
      attribution: {
        tenantId:       "tenant-abc",
        attempt:        0,
        operationType:  "text_generation",
        idempotencyKey: idem,
      },
      usage:           { usageAvailable: false },
      cost:            { currency: "USD", pricingSource: "default_fallback" },
      operationStatus: "success",
    });

    expect(result.idempotencyKey).toBe(idem);
    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["projectId"]).toBeNull();
    expect(saved["orderId"]).toBeNull();
    expect(saved["agentId"]).toBeNull();
    expect(saved["inputTokens"]).toBeNull();
  });
});

// =============================================================================
// 3. Duplicate cost detection (reconciliation)
// =============================================================================
describe("3. duplicate cost detection", () => {
  it("flags a job that has two success attributions with attempt=0 as duplicate", async () => {
    const sharedJobId = "job-dup";
    const attrs = [
      { id: 1, idempotencyKey: "k1", jobId: sharedJobId, operationStatus: "success", attempt: 0,
        tenantId: "t1", finalAttributableCostUsd: "0.01", estimatedCostUsd: "0.01",
        projectId: null, usageAvailable: true, currency: "USD" },
      { id: 2, idempotencyKey: "k2", jobId: sharedJobId, operationStatus: "success", attempt: 0,
        tenantId: "t1", finalAttributableCostUsd: "0.01", estimatedCostUsd: "0.01",
        projectId: null, usageAvailable: true, currency: "USD" },
    ];
    queueSelectMocks([mockSelectReturning(attrs)]);
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const result = await svc.reconcileDesignCosts({ tenantId: "t1" });
    expect(result.duplicates).toContain(sharedJobId);
    expect(result.scannedAttributions).toBe(2);
  });
});

// =============================================================================
// 4. Retry attribution
// =============================================================================
describe("4. retry attribution", () => {
  it("flags a retry (attempt > 0) with a success cost as retryDoubleCharge", async () => {
    const attrs = [
      { id: 1, idempotencyKey: "retry-k1", jobId: "job-r", operationStatus: "success", attempt: 1,
        tenantId: "t1", finalAttributableCostUsd: "0.02", estimatedCostUsd: "0.02",
        projectId: null, usageAvailable: true, currency: "USD" },
    ];
    queueSelectMocks([mockSelectReturning(attrs)]);
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const result = await svc.reconcileDesignCosts({ tenantId: "t1" });
    expect(result.retryDoubleCharge).toContain("retry-k1");
  });

  it("records attempt number correctly on insertion", async () => {
    await svc.recordDesignCostAttribution({
      attribution:     makeAttribution({ attempt: 2, idempotencyKey: "retry-rec-1" }),
      usage:           makeUsage({ retryCount: 2 }),
      cost:            makeCost(),
      operationStatus: "success",
    });
    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["attempt"]).toBe(2);
    expect(saved["retryCount"]).toBe(2);
  });
});

// =============================================================================
// 5. Canceled execution
// =============================================================================
describe("5. canceled execution", () => {
  it("flags cancelled execution with non-zero cost in reconciliation", async () => {
    const attrs = [
      { id: 1, idempotencyKey: "cancel-k1", jobId: "job-c", operationStatus: "cancelled", attempt: 0,
        tenantId: "t1", finalAttributableCostUsd: "0.005", estimatedCostUsd: "0.01",
        projectId: null, usageAvailable: true, currency: "USD" },
    ];
    queueSelectMocks([mockSelectReturning(attrs)]);
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const result = await svc.reconcileDesignCosts({ tenantId: "t1" });
    expect(result.cancelledWithCost).toContain("cancel-k1");
  });

  it("records cancelled status on insertion", async () => {
    await svc.recordDesignCostAttribution({
      attribution:     makeAttribution({ idempotencyKey: "cancel-insert-1" }),
      usage:           makeUsage(),
      cost:            makeCost({ finalAttributableCostUsd: null }),
      operationStatus: "cancelled",
    });
    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["operationStatus"]).toBe("cancelled");
  });
});

// =============================================================================
// 6. Provider usage unavailable
// =============================================================================
describe("6. provider usage unavailable", () => {
  it("stores usageAvailable=false and null token fields when provider does not report", async () => {
    await svc.recordDesignCostAttribution({
      attribution:     makeAttribution({ idempotencyKey: "no-usage-1" }),
      usage: {
        usageAvailable: false,
        inputTokens:    null,
        outputTokens:   null,
      },
      cost:            makeCost(),
      operationStatus: "success",
    });
    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["usageAvailable"]).toBe(false);
    expect(saved["inputTokens"]).toBeNull();
    expect(saved["outputTokens"]).toBeNull();
  });

  it("flags partial usage in reconciliation when usageAvailable=false and status=success", async () => {
    const attrs = [
      { id: 1, idempotencyKey: "partial-k1", jobId: "job-p", operationStatus: "success", attempt: 0,
        tenantId: "t1", finalAttributableCostUsd: "0.01", estimatedCostUsd: "0.01",
        projectId: null, usageAvailable: false, currency: "USD" },
    ];
    queueSelectMocks([mockSelectReturning(attrs)]);
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const result = await svc.reconcileDesignCosts({ tenantId: "t1" });
    expect(result.partialProviderUsage).toContain("partial-k1");
  });
});

// =============================================================================
// 7. Estimated cost
// =============================================================================
describe("7. estimated cost", () => {
  it("estimateDesignCost returns positive estimate with pricing source from DB", async () => {
    const pricingRow = {
      id: 1, inputPricePer1m: "5.00", outputPricePer1m: "15.00",
      cachedInputPrice: "2.50", currency: "USD", effectiveDate: "2024-01-01",
    };
    queueSelectMocks([() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([pricingRow])),
        })),
        limit: vi.fn(() => Promise.resolve([pricingRow])),
      })),
    })]);

    const estimate = await svc.estimateDesignCost({
      providerId:   "openai",
      modelId:      "gpt-4o",
      inputTokens:  1000,
      outputTokens: 500,
      cachedTokens: 100,
      imageCount:   0,
    });

    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(estimate.pricingSource).toBe("ai_provider_pricing");
    expect(estimate.inputTokens).toBe(1000);
    expect(estimate.outputTokens).toBe(500);
    expect(estimate.cachedTokens).toBe(100);
  });

  it("falls back to defaults when no pricing row exists", async () => {
    queueSelectMocks([() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
        limit: vi.fn(() => Promise.resolve([])),
      })),
    })]);

    const estimate = await svc.estimateDesignCost({
      providerId:   "unknown-provider",
      modelId:      "unknown-model",
      inputTokens:  1000,
      outputTokens: 500,
    });

    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(estimate.pricingSource).toBe("default_fallback");
    expect(estimate.pricingVersion).toBeNull();
  });
});

// =============================================================================
// 8. Actual cost
// =============================================================================
describe("8. actual cost", () => {
  it("stores provider-reported and final-attributable cost separately from calculated cost", async () => {
    await svc.recordDesignCostAttribution({
      attribution:     makeAttribution({ idempotencyKey: "actual-cost-1" }),
      usage:           makeUsage(),
      cost: makeCost({
        providerReportedCostUsd:  0.015,
        calculatedCostUsd:        0.0127,
        finalAttributableCostUsd: 0.015,
      }),
      operationStatus: "success",
    });
    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["providerReportedCostUsd"]).toBe("0.01500000");
    expect(saved["finalAttributableCostUsd"]).toBe("0.01500000");
    expect(saved["calculatedCostUsd"]).toBe("0.01270000");
  });
});

// =============================================================================
// 9. Pricing version
// =============================================================================
describe("9. pricing version", () => {
  it("stores pricingVersion and pricingSource correctly", async () => {
    await svc.recordDesignCostAttribution({
      attribution:     makeAttribution({ idempotencyKey: "pricing-ver-1" }),
      usage:           makeUsage(),
      cost: makeCost({
        pricingVersion: "pricing-row-42",
        pricingSource:  "ai_provider_pricing",
      }),
      operationStatus: "success",
    });
    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["pricingVersion"]).toBe("pricing-row-42");
    expect(saved["pricingSource"]).toBe("ai_provider_pricing");
  });

  it("marks default_fallback source when pricing row is absent", async () => {
    await svc.recordDesignCostAttribution({
      attribution:     makeAttribution({ idempotencyKey: "pricing-fallback-1" }),
      usage:           makeUsage(),
      cost: makeCost({
        pricingVersion: null,
        pricingSource:  "default_fallback",
      }),
      operationStatus: "success",
    });
    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["pricingSource"]).toBe("default_fallback");
    expect(saved["pricingVersion"]).toBeNull();
  });
});

// =============================================================================
// 10. Variance detection
// =============================================================================
describe("10. variance detection", () => {
  it("flags attributions where actual vs estimated variance exceeds threshold", async () => {
    const attrs = [
      { id: 1, idempotencyKey: "var-k1", jobId: "job-v", operationStatus: "success", attempt: 0,
        tenantId: "t1",
        estimatedCostUsd:         "0.010",
        finalAttributableCostUsd: "0.020",   // 100% variance
        projectId: null, usageAvailable: true, currency: "USD" },
    ];
    queueSelectMocks([mockSelectReturning(attrs)]);
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const result = await svc.reconcileDesignCosts({ tenantId: "t1", varianceThresholdPct: 20 });
    expect(result.estimateVsActualVariance).toHaveLength(1);
    expect(result.estimateVsActualVariance[0].idempotencyKey).toBe("var-k1");
    expect(result.estimateVsActualVariance[0].variancePct).toBeGreaterThan(20);
  });

  it("does not flag variance below the threshold", async () => {
    const attrs = [
      { id: 1, idempotencyKey: "var-ok", jobId: "job-ok", operationStatus: "success", attempt: 0,
        tenantId: "t1",
        estimatedCostUsd:         "0.010",
        finalAttributableCostUsd: "0.011",   // 10% variance
        projectId: null, usageAvailable: true, currency: "USD" },
    ];
    queueSelectMocks([mockSelectReturning(attrs)]);
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const result = await svc.reconcileDesignCosts({ tenantId: "t1", varianceThresholdPct: 20 });
    expect(result.estimateVsActualVariance).toHaveLength(0);
  });
});

// =============================================================================
// 11. Currency mismatch
// =============================================================================
describe("11. currency mismatch", () => {
  it("flags attributions with non-USD currency in reconciliation", async () => {
    const attrs = [
      { id: 1, idempotencyKey: "curr-k1", jobId: "job-curr", operationStatus: "success", attempt: 0,
        tenantId: "t1", finalAttributableCostUsd: "0.01", estimatedCostUsd: "0.01",
        projectId: null, usageAvailable: true, currency: "EUR" },
    ];
    queueSelectMocks([mockSelectReturning(attrs)]);
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const result = await svc.reconcileDesignCosts({ tenantId: "t1" });
    expect(result.currencyMismatches).toContain("curr-k1");
  });
});

// =============================================================================
// 12. Budget warning
// =============================================================================
describe("12. budget warning", () => {
  it("returns isWarning=true when usage is at warning threshold", async () => {
    const policy = {
      id: 1, tenantId: "t1", scopeType: "project", scopeId: "proj-001",
      limitType: "monthly", actionType: "soft_warn",
      limitAmountUsd: "10.00", warningThresholdPct: 80,
      currency: "USD", active: true, description: null,
      createdAt: new Date(), updatedAt: new Date(),
    };

    // First call: policy list. Second call: spend aggregate.
    let callN = 0;
    queueSelectMocks([
      // policy list query
      () => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([policy])) })) }),
      // spend aggregate query — $8.50 spent (85% of $10)
      () => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([{ total: "8.50" }])) })) }),
    ]);

    const snapshots = await svc.checkDesignBudget("t1", "project", "proj-001");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].isWarning).toBe(true);
    expect(snapshots[0].isBlocked).toBe(false);
    expect(snapshots[0].spentAmountUsd).toBeCloseTo(8.5, 1);
    expect(snapshots[0].usagePct).toBeCloseTo(85, 0);
  });
});

// =============================================================================
// 13. Budget block
// =============================================================================
describe("13. budget block", () => {
  it("returns isBlocked=true when hard_block policy is exceeded", async () => {
    const policy = {
      id: 2, tenantId: "t2", scopeType: "tenant", scopeId: "t2",
      limitType: "daily", actionType: "hard_block",
      limitAmountUsd: "5.00", warningThresholdPct: 80,
      currency: "USD", active: true, description: null,
      createdAt: new Date(), updatedAt: new Date(),
    };

    queueSelectMocks([
      () => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([policy])) })) }),
      // $6 > $5 limit
      () => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([{ total: "6.00" }])) })) }),
    ]);

    const snapshots = await svc.checkDesignBudget("t2", "tenant", "t2");
    expect(snapshots[0].isBlocked).toBe(true);
    expect(snapshots[0].remainingAmountUsd).toBe(0);
  });

  it("returns requiresApproval=true for require_approval policy at limit", async () => {
    const policy = {
      id: 3, tenantId: "t3", scopeType: "capability", scopeId: "cap-image",
      limitType: "per_run", actionType: "require_approval",
      limitAmountUsd: "2.00", warningThresholdPct: 80,
      currency: "USD", active: true, description: null,
      createdAt: new Date(), updatedAt: new Date(),
    };

    queueSelectMocks([
      () => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([policy])) })) }),
      () => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([{ total: "2.50" }])) })) }),
    ]);

    const snapshots = await svc.checkDesignBudget("t3", "capability", "cap-image");
    expect(snapshots[0].requiresApproval).toBe(true);
    expect(snapshots[0].isBlocked).toBe(false);
  });
});

// =============================================================================
// 14. Project summary
// =============================================================================
describe("14. project summary", () => {
  it("returns aggregated cost summary for a project", async () => {
    const aggRow = {
      totalFinal:    "0.1234", totalCalc:  "0.1200", totalEstimated: "0.1100",
      totalInput:    "5000",   totalOutput: "2000",   totalCached: "500",
      totalImages:   "3",      totalRenders: "6",     totalRequests: "10",
      totalRetries:  "1",      recordCount: "10",
    };
    queueSelectMocks([() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([aggRow])) })) })]);

    const summary = await svc.getProjectCostSummary("proj-001", "tenant-abc");

    expect(summary.totalFinalAttributableCostUsd).toBeCloseTo(0.1234, 4);
    expect(summary.totalInputTokens).toBe(5000);
    expect(summary.totalImageGenerations).toBe(3);
    expect(summary.recordCount).toBe(10);
    expect(summary.currency).toBe("USD");
  });
});

// =============================================================================
// 15. Order summary
// =============================================================================
describe("15. order summary", () => {
  it("returns aggregated cost summary for an order", async () => {
    const aggRow = {
      totalFinal:    "0.0500", totalCalc: "0.0490", totalEstimated: "0.0480",
      totalInput:    "2000",   totalOutput: "1000",  totalCached: "0",
      totalImages:   "0",      totalRenders: "0",    totalRequests: "4",
      totalRetries:  "0",      recordCount: "4",
    };
    queueSelectMocks([() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([aggRow])) })) })]);

    const summary = await svc.getOrderCostSummary("ord-001", "tenant-abc");

    expect(summary.totalFinalAttributableCostUsd).toBeCloseTo(0.05, 4);
    expect(summary.totalRequests).toBe(4);
    expect(summary.currency).toBe("USD");
  });
});

// =============================================================================
// 16. Tenant isolation
// =============================================================================
describe("16. tenant isolation", () => {
  it("persists only the tenantId from the attribution params — not any other value", async () => {
    const idem = `iso-${Math.random().toString(36).slice(2)}`;
    await svc.recordDesignCostAttribution({
      attribution: makeAttribution({ tenantId: "isolated-tenant", idempotencyKey: idem }),
      usage:       makeUsage(),
      cost:        makeCost(),
      operationStatus: "success",
    });
    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["tenantId"]).toBe("isolated-tenant");
    // No other-tenant data in the row
    const strValue = JSON.stringify(saved);
    expect(strValue).not.toContain("other-tenant");
  });

  it("budget check returns empty when no policy exists for the scope", async () => {
    // Default mock returns [] from where() — no policies
    const snapshots = await svc.checkDesignBudget("ghost-tenant", "project", "proj-999");
    expect(snapshots).toHaveLength(0);
  });
});

// =============================================================================
// 17. No secret metadata
// =============================================================================
describe("17. no secret metadata", () => {
  it("does not persist API keys, tokens, passwords, or credentials in stored rows", async () => {
    await svc.recordDesignCostAttribution({
      attribution:     makeAttribution({ idempotencyKey: "secret-check-1" }),
      usage:           makeUsage(),
      cost:            makeCost(),
      operationStatus: "success",
    });

    const saved = insertedRows[0] as Record<string, string>;

    // Exact field-name prefixes that indicate stored secrets — never business fields.
    // "cachedTokens", "inputTokens", "outputTokens" are legitimate business fields
    // that contain "token" as a suffix, so we check for key names that are exactly
    // API-credential-shaped rather than doing a substring scan.
    const secretKeyPatterns = ["api_key", "apikey", "access_token", "auth_token",
      "bearer_token", "jwt", "password", "secret_key", "private_key", "credential"];
    for (const key of Object.keys(saved)) {
      const lk = key.toLowerCase();
      expect(secretKeyPatterns.some((p) => lk === p || lk.startsWith(p))).toBe(false);
    }

    // Values must not look like real secrets (e.g. OpenAI "sk-" prefix, Bearer headers)
    const strValue = JSON.stringify(saved).toLowerCase();
    expect(strValue).not.toContain("sk-proj-");
    expect(strValue).not.toContain("bearer eyj");
    expect(strValue).not.toContain("-----begin");
  });
});

// =============================================================================
// 18. Idempotent record
// =============================================================================
describe("18. idempotent record", () => {
  it("returns existing id without re-inserting when idempotencyKey conflicts", async () => {
    simulateConflict = true;

    // The service falls back to a SELECT to find the existing id
    queueSelectMocks([() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ id: 55 }])),
        })),
      })),
    })]);

    const result = await svc.recordDesignCostAttribution({
      attribution:     makeAttribution({ idempotencyKey: "idempotent-key-1" }),
      usage:           makeUsage(),
      cost:            makeCost(),
      operationStatus: "success",
    });

    expect(insertedRows).toHaveLength(0);   // nothing new pushed
    expect(result.id).toBe(55);
    expect(result.idempotencyKey).toBe("idempotent-key-1");
  });
});

// =============================================================================
// 19. Existing cost service compatibility
// =============================================================================
describe("19. existing cost service compatibility", () => {
  it("accepts null costRecordId (no pre-existing cost record link required)", async () => {
    await svc.recordDesignCostAttribution({
      attribution:     makeAttribution({ idempotencyKey: "no-cost-rec-1" }),
      usage:           makeUsage(),
      cost:            makeCost(),
      operationStatus: "success",
      costRecordId:    null,
    });
    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["costRecordId"]).toBeNull();
  });

  it("estimateDesignCost with defaults produces values compatible with existing cost service", async () => {
    // No pricing row — should use defaults ($2.50/1M in, $10/1M out)
    queueSelectMocks([() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })]);

    const estimate = await svc.estimateDesignCost({
      providerId:   "any",
      modelId:      "any",
      inputTokens:  1_000_000,   // 1M input → $2.50
      outputTokens: 1_000_000,   // 1M output → $10
    });

    // Total ≈ $12.50 with built-in defaults (same as costService.ts hardcoded defaults)
    expect(estimate.estimatedCostUsd).toBeCloseTo(12.5, 1);
    expect(estimate.pricingSource).toBe("default_fallback");
  });
});

// =============================================================================
// 20. Image analytics compatibility
// =============================================================================
describe("20. image analytics compatibility", () => {
  it("records image generation count alongside null token fields without fabrication", async () => {
    await svc.recordDesignCostAttribution({
      attribution: makeAttribution({
        idempotencyKey: "image-gen-1",
        operationType:  "image_generation",
        modelId:        "flux-1-schnell",
        providerId:     "replicate",
      }),
      usage: {
        usageAvailable:       true,
        inputTokens:          null,   // image models don't report tokens
        outputTokens:         null,
        cachedTokens:         null,
        imageGenerationCount: 4,
        renderCount:          4,
        runtimeSeconds:       12.5,
        requestCount:         1,
        retryCount:           0,
      },
      cost: makeCost({
        pricingSource:            "default_fallback",
        finalAttributableCostUsd: 0.16,   // 4 images × $0.04
      }),
      operationStatus: "success",
    });

    const saved = insertedRows[0] as Record<string, unknown>;
    expect(saved["imageGenerationCount"]).toBe(4);
    expect(saved["renderCount"]).toBe(4);
    expect(saved["operationType"]).toBe("image_generation");
    // Null tokens — not fabricated as 0
    expect(saved["inputTokens"]).toBeNull();
    expect(saved["outputTokens"]).toBeNull();
    expect(saved["finalAttributableCostUsd"]).toBe("0.16000000");
  });
});
