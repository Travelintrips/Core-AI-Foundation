# ADR-001: Controlled Import Pipeline for Material Data

**Status:** Accepted
**Date:** 2026-07-26
**Phase:** Material Phase 5

---

## Context

The material library needs to ingest data from external sources: OCR extraction from supplier catalogues (Phase 4A), manual bulk uploads, and future supplier API feeds. Directly inserting incoming records into the canonical `materials` table creates several risks:

- Duplicate materials with different formatting (e.g. "Engineered Wood" vs "eng_wood")
- Low-quality or incomplete records from imperfect OCR output
- No audit trail for how records entered the system
- No ability to review or reject bad data before it reaches customers

---

## Decision

All material data from external sources must pass through a **controlled import pipeline** before reaching the canonical `materials` table:

1. Incoming records are written to `material_import_staging` with status `pending`
2. The system computes a duplicate score against existing canonical materials
3. An admin reviews each staged record and chooses an action: approve, reject, or apply a resolution strategy
4. Only approved records are written to `materials`
5. Every action is logged to `material_import_audit`

The pipeline is implemented as a state machine in `materialImportService.ts`.

---

## Alternatives Considered

### Direct Insert with Validation
Insert directly into `materials` after schema validation. Rejected — passes the full deduplication and quality burden to the importer; no human review; no audit trail.

### Background Job with Auto-Approval
Queue records and auto-approve if duplicate score < threshold. Rejected — auto-approval cannot handle ambiguous cases (same material, different brand); and provides no human accountability for catalog quality.

### External ETL Tool
Use a third-party ETL tool (e.g. Airbyte) to manage the pipeline. Rejected — adds operational complexity; the review UI must be in the admin panel regardless; and the business needs custom duplicate resolution logic specific to material attributes.

---

## Consequences

**Positive:**
- Human review ensures catalog quality before data reaches customers
- Full audit trail of every import action
- Duplicate prevention reduces canonical table bloat
- Reviewers can catch OCR errors before they propagate

**Negative:**
- Import velocity is limited by reviewer throughput
- Adds operational overhead for every new data source
- Staging table accumulates records if review queue is not monitored

**Mitigations:**
- Confidence threshold auto-approval (planned for Phase 6 — backlog item C3)
- Dashboard statistics surface queue depth for monitoring
