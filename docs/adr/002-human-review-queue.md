# ADR-002: Human-in-the-Loop Review Queue

**Status:** Accepted
**Date:** 2026-07-26
**Phase:** Material Phase 5

---

## Context

Once the controlled import pipeline (ADR-001) was established, the question became: who makes the approval decision and how is it presented? Options ranged from fully automated ML-based approval to pure manual review.

The material catalog is customer-facing and directly influences AI-generated interior design recommendations. Incorrect material names, wrong price tiers, or duplicates would degrade AI output quality and customer trust.

---

## Decision

Use a **human-in-the-loop review queue** exposed as an admin UI page in the internal admin portal (`/admin/`).

- Admins see a list of staged records with status, duplicate score, and a diff view (incoming vs existing)
- For each record, the reviewer chooses: **Approve**, **Reject**, or a **Duplicate Resolution Strategy**
- Actions are submitted via `POST /ai/material-import/review`
- The reviewer's identity (`editorId: "admin"`) is logged in `material_import_audit`

No AI model autonomously writes to the canonical `materials` table. Every write is human-authorised.

---

## Alternatives Considered

### Fully Automated Approval
Use ML confidence scores to auto-approve all records above a threshold. Rejected for Phase 5 — insufficient training data for material-specific confidence scoring; risk of catalog corruption is too high at this stage of the product.

### Email-Based Review
Send review requests by email and allow approval via email reply. Rejected — not auditable; slow; no diff view; not integrated with the admin portal.

### Async Background Review
Queue records and process asynchronously without a dedicated UI. Rejected — no visibility into queue depth or individual record details; no structured approve/reject action.

---

## Consequences

**Positive:**
- Catalog quality is human-guaranteed before records go live
- Reviewers can use domain knowledge to resolve edge cases
- Full audit trail via `material_import_audit`
- Extensible — confidence-based auto-approval can be layered on top later (ADR-001 mitigations)

**Negative:**
- Requires trained admin reviewers to process the queue
- Review becomes a bottleneck under high import volume
- UI must be kept in sync with backend state machine

**Open questions for Phase 6:**
- Should there be a reviewer role separate from general admin?
- What is the SLA for queue review (target < 24h per record)?
