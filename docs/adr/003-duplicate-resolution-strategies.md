# ADR-003: Four-Strategy Duplicate Resolution

**Status:** Accepted
**Date:** 2026-07-26
**Phase:** Material Phase 5

---

## Context

When an incoming staged record is identified as a potential duplicate of an existing canonical material, the reviewer must decide what to do. A binary approve/reject is insufficient — in practice there are four meaningfully different situations:

1. The existing record is correct and the incoming one is redundant
2. The incoming record is better (more complete, corrected data) and should replace the existing
3. Both records have useful fields — merge them
4. They look similar but are genuinely distinct materials — create both

---

## Decision

Expose four explicit **duplicate resolution strategies**, selectable per staged record in the review UI:

| Strategy | Description |
|---|---|
| `keep_existing` | Discard the incoming record; canonical record is unchanged |
| `replace_existing` | Overwrite the canonical record with the incoming record's fields |
| `merge` | Produce a new canonical record combining fields from both, with admin field-level override |
| `create_new` | Insert the incoming record as a new canonical material alongside the existing one |

The selected strategy is passed to `materialImportService.ts` which executes the appropriate database operation and logs the action.

---

## Alternatives Considered

### Binary Approve/Reject Only
Either approve (insert as new) or reject (discard). Rejected — does not handle the replace or merge cases, leading to either duplicates in the canonical table or loss of better-quality incoming data.

### Automated Merge with Field Confidence
Automatically pick the "better" field value from each record based on field-level confidence scores. Rejected — requires field-level confidence from OCR which is not reliably available; and removes human accountability for the merged result.

### Single "Merge All" Strategy
Always merge when a duplicate is detected. Rejected — sometimes the incoming record is simply wrong and should be rejected outright; sometimes the records are genuinely distinct materials.

---

## Consequences

**Positive:**
- Covers all real-world duplicate scenarios
- Reviewers have full control over catalog state
- All four paths are independently tested (`material-import-phase5.test.ts`)

**Negative:**
- Four strategies increase reviewer cognitive load slightly
- Merge UI requires field-level diff display (added implementation complexity)
- `create_new` can still produce near-duplicates if misused by reviewers

**Implementation note:**
- Duplicate score is computed at staging time (not at review time) to keep review latency low
- Scoring uses `material_code` + brand + category as the primary match key
