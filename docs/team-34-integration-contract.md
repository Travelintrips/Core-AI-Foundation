# Team 34 — Design Cost Runtime Integration Contract

## Purpose

This document defines the exact integration points for workflow runners (Team 39 and others) to use the Design Cost Attribution service.

## Call Order for a Single Execution

```
1. estimate(params)           → DesignCostEstimate
2. checkBudget(...)           → BudgetDecision   ← abort if status ≠ "allowed"
3. [run the workflow step]
4. record(params, status="success")     → { id, idempotencyKey }
   OR on failure:
   record(params, status="failed"|"cancelled")
```

## Fail-Closed Budget Check

```typescript
import { createDesignCostRuntimeContract, type BudgetDecision } from
  "./services/designCostAttributionService.js";

const contract = createDesignCostRuntimeContract();

const decision: BudgetDecision = await contract.checkBudget(
  tenantId, "project", projectId, "Asia/Jakarta"
);

if (decision.status !== "allowed") {
  // DO NOT proceed — handle each status:
  //   "blocked"           → reject with 402 / queue management error
  //   "approval_required" → pause job, notify approver
  //   "warning"           → proceed but log warning
  //   "unavailable"       → depends on execution policy (default: proceed with warning)
  throw new Error(`budget_${decision.status}: ${decision.reason}`);
}
```

## Idempotency Contract

| Scenario | idempotencyKey | attempt |
|---|---|---|
| First execution | `${jobId}-attempt-0` | 0 |
| Retry #1 | `${jobId}-attempt-1` | 1 |
| Retry #2 | `${jobId}-attempt-2` | 2 |

**Never reuse** a (jobId, attempt) idempotencyKey pair. The DB has a UNIQUE (tenant_id, idempotency_key) constraint — a duplicate insert is a no-op and returns the existing row's id.

## Failed / Cancelled Executions

Always record even for failures:

```typescript
await contract.record({
  attribution: {
    tenantId, attempt, operationType, idempotencyKey, jobId,
    ...otherDimensions,
  },
  usage: { usageAvailable: false },
  cost: {
    currency: "USD",
    pricingSource: "default_fallback",
    finalAttributableCostUsd: partialCost ?? 0,  // 0 if no cost incurred
  },
  operationStatus: "failed",   // or "cancelled"
});
```

This prevents the reconciliation scanner from flagging the job as "job without cost".

## Retry Double-Charge

The reconciliation scanner flags `attempt > 0` rows with `operationStatus = "success"` as potential double-charges for manual review. This is expected behavior — it enables the ops team to verify that the previous attempt's partial cost was correctly zeroed.

## Canonical Call Sites for Team 39

| File | Function | Integration Point |
|---|---|---|
| `artifacts/api-server/src/services/jobWorkerService.ts` | `executeJob()` | Before: estimate+checkBudget. After: record. |
| `artifacts/api-server/src/services/workerClusterService.ts` | Job dispatch loop | Same pattern. |

### Exact call site pattern

```typescript
// BEFORE execution
const estimate = await contract.estimate({ providerId, modelId, inputTokens, outputTokens });
const budget   = await contract.checkBudget(tenantId, "project", projectId);
if (budget.status === "blocked" || budget.status === "approval_required") {
  throw new Error(`budget_blocked: ${budget.reason}`);
}

// RUN EXECUTION
const result = await runDesignStep(...)

// AFTER execution
await contract.record({
  attribution: { tenantId, jobId, attempt, operationType, idempotencyKey, ...dims },
  usage:       { inputTokens: result.usage.input, outputTokens: result.usage.output, usageAvailable: true },
  cost: {
    estimatedCostUsd:         estimate.estimatedCostUsd,
    finalAttributableCostUsd: result.actualCost ?? estimate.estimatedCostUsd,
    pricingSource:            estimate.pricingSource,
    pricingVersion:           estimate.pricingVersion,
    currency:                 estimate.currency,
  },
  operationStatus: "success",
});
```

## Platform Reconciliation

Only `platform` actors (role = "owner" | "admin") can call `POST /ai/design-cost/reconcile` without a scoped tenantId. Tenant actors are restricted to their own tenantId.

## Endpoint Summary

| Method | Path | Notes |
|---|---|---|
| POST | `/api/ai/design-cost/record` | Spec-canonical alias |
| POST | `/api/ai/design-cost/estimate` | Pre-execution estimate |
| POST | `/api/ai/design-cost/calculate` | Post-execution calculation |
| GET  | `/api/ai/design-cost/project/:id` | Project cost summary |
| GET  | `/api/ai/design-cost/order/:id` | Order cost summary |
| GET  | `/api/ai/design-cost/project/:id/detail` | Per-model breakdown |
| POST | `/api/ai/design-cost/budget/check` | Fail-closed budget decision |
| POST | `/api/ai/design-cost/budget/policy` | Create budget policy |
| GET  | `/api/ai/design-cost/budget/policies` | List policies |
| POST | `/api/ai/design-cost/reconcile` | Actor-scoped reconciliation |

## Currency Safety

- All monetary values stored as `NUMERIC(12,8)` in the DB.
- JS layer uses `toMonetaryString(value, 8)` — HALF_UP rounding at 8 decimal places.
- Summaries are currency-single: the reconciler flags non-USD rows as `currencyMismatches`.
- No FX conversion is performed without explicit: rate source, timestamp, source currency, target currency.
- Mixed-currency totals are NEVER computed; group by currency before summing.

## Timezone

Budget period boundaries are calculated in the policy's `timezone_iana` column (default UTC). Supply an explicit IANA timezone string (e.g. `"Asia/Jakarta"`) in the policy or in the `POST /ai/design-cost/budget/check` body.
