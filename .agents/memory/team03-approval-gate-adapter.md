---
name: team03-approval-gate-adapter
description: Pattern for adapting a team-local approval state machine to use ai_commercial_gates as backing store instead of a parallel table.
---

## Rule
Never create a parallel approval state machine (new table + status columns) when `ai_commercial_gates` with `gate_type='admin_approval'` can serve as the backing store.

## Pattern
- Insert into `ai_commercial_gates` with `gate_type='admin_approval'`, `quotationId=null`, `serviceQuotationId=null` (both nullable in schema — legal).
- Store domain metadata in `notes` as JSON string: `{actionType, actionPayload, requestedBy, customerProfileId, source: "team-name"}`.
- Use `source` field in `notes` to namespace/filter rows by domain.
- Idempotency: before INSERT, run `SELECT WHERE gate_type='admin_approval' AND status='pending' AND (notes->>'customerProfileId')::int = $1 AND notes->>'actionType' = $2 AND notes->>'source' = $3`.
- Approve → `verifyGate(id, approvedBy)` from `commercialGateService`; Reject → `failGate(id, reason)`.
- Status mapping: `pending→pending`, `verified→approved`, `failed/waived→rejected`.

## Why
Audit finding: duplicate approval state machines create race conditions, double reward issuance risk, and data consistency gaps between two tables.

## How to apply
- Any time a domain needs an admin-approval gate without a quotation, use this pattern.
- The `notes` JSON is stored as TEXT in the current schema — use `notes->>'key'` not `notes->'key'` in WHERE clauses (text JSON cast, not JSONB). If performance degrades, ask Team 24 to ALTER COLUMN to JSONB.

## mapGate gotcha
`db.execute()` returns snake_case column names (`verified_by`, `created_at`) but `AiCommercialGate` (Drizzle type) is camelCase. The `mapGate` function must handle both:
```ts
const verifiedBy = row.verified_by ?? gate.verifiedBy ?? null;
const verifiedAt = row.verified_at ?? gate.verifiedAt ?? null;
```
Use `RawGateRow` type (snake_case) for `db.execute` results; `AiCommercialGate` for `db.insert().returning()` results.
