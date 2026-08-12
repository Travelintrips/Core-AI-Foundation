# Next Work Package Discovery & Implementation Plan
# Phase 6 WP-11 — Export Engine

**Status:** DISCOVERED — IMPLEMENTATION IN PROGRESS
**Date:** 2026-08-12
**Predecessor merge SHA:** `81edb468bab1be8df9b8261c16c51b7db133b0ca`
**Proposed branch:** `feature/wp11-export-engine`

---

## 1. Canonical successor resolution

The tracked Interior Design / Layout roadmap in `docs/phase6-work-packages.md`
defines the sequence:

```text
WP-09 Rendering Pipeline
  └── WP-10 Review & Versioning
        └── WP-11 Export Engine
              └── WP-12 QA & Release
```

WP-11 is the direct successor of the verified and merged WP-10. This resolution
uses the tracked Phase 6 roadmap and database blueprint, not uploaded prompts,
generic enterprise workstreams, or the unrelated soft-delete roadmap.

**Classification:** A — CLEARLY DEFINED

## 2. Objective

Compile an approved Interior Design version into a downloadable export package:
PDF specification, material list, furniture list, moodboard PDF, and a ZIP
bundle. The package must be generated through the existing `ai_jobs` dispatcher,
stored outside PostgreSQL, and exposed through short-lived signed download URLs.

## 3. Existing foundations

- `ai_jobs` and `jobWorkerService` for queued, retryable background work.
- WP-10 approved version and immutable snapshot boundaries.
- `creative_projects`, `id_concept_drafts`, `id_outputs`, and interior asset data.
- Existing PDFKit/document-engine and PDF layout helpers.
- Existing ZIP/JSZip security helpers and Supabase/App Storage clients.
- Existing signed download token service.
- Existing export-workspace job orchestration and admin UI.
- Existing admin auth, RequestContext tenant resolution, audit logging, and
  generated API client workflow.

## 4. Implementation gaps

### Backend

- Existing export-workspace execution records delegation placeholders instead
  of producing an Interior Design artifact.
- No canonical `export_packages` persistence for lifecycle, selected version,
  manifest, output path, expiry, and failure state.
- No Interior Design export compiler that aggregates approved snapshot data into
  specification, material, furniture, moodboard, and ZIP outputs.

### API

- Existing export-workspace endpoints need a real Interior Design path with
  server-side project/version ownership checks and package-aware result metadata.
- Add explicit WP-11 request/status/result contract coverage to OpenAPI.

### Frontend

- Existing Export Workspace page requires manually entering a project ID and
  presents generic formats. Interior Design detail needs a project-scoped
  export panel that refreshes status and exposes safe downloads.

### Persistence

- Add `ai_platform.export_packages` through hand-written additive DDL and the
  shared Drizzle schema. Do not use drizzle-kit push for this schema.

## 5. Scope

### In scope

- `export_packages` lifecycle: queued → generating → completed/failed/cancelled.
- Idempotent package requests per tenant, project, approved version, and format.
- PDF specification and moodboard PDF generation using PDFKit.
- Material and furniture CSV generation with formula-injection protection.
- ZIP compilation containing generated outputs plus a manifest.
- Supabase/App Storage upload and signed download URL generation.
- API request/status/result flows and project-scoped tenant/ownership checks.
- Customer/admin download panel in the existing Interior Design surface.
- Targeted security, idempotency, persistence, PDF/CSV/ZIP, API, and UI tests.

### Out of scope

- New render providers or changes to WP-09 rendering.
- New authentication, tenant, versioning, queue, or storage architectures.
- Payment, quotation, customer-workspace, and unrelated export workstreams.
- Destructive migrations or cleanup of the known 128 legacy API type errors.

## 6. Security and correctness requirements

- Resolve tenant and ownership server-side; never trust body/query tenant IDs.
- Only export an approved WP-10 version owned by the resolved tenant/project.
- Prevent IDOR on request, status, retry, result, and download routes.
- Never expose raw storage paths, provider credentials, or snapshot secrets.
- Sanitize filenames, ZIP entry paths, CSV cells, and bounded input sizes.
- Keep approved/history snapshots immutable; exports read a stable snapshot.
- Use idempotency and atomic lifecycle claims to prevent duplicate packages.
- Set a bounded signed URL TTL and return only safe metadata to clients.
- Apply explicit resource caps for rows, generated files, and ZIP size.

## 7. Migration and storage impact

- Add `scripts/migrations/wp11-export-packages.sql` with additive DDL and
  tenant/project/version indexes.
- Add the `export_packages` Drizzle table to the existing `ai_platform` schema.
- Store bytes in the existing configured object storage; PostgreSQL stores only
  metadata and object paths.
- Keep PDFKit external in the API esbuild build.

## 8. Test strategy

- Unit: snapshot normalization, PDF/CSV generation, filename/CSV/ZIP safety,
  size caps, lifecycle transitions, idempotency, and signed URL expiry.
- API: happy path, unauthorized, invalid identifiers, tenant isolation, IDOR,
  ownership, malformed input, retry/cancel terminal guards, and result secrecy.
- Persistence: insert/update/claim behavior and duplicate request reuse.
- UI: loading, empty, success, failure, polling, retry, and safe download states.
- Regression: API suite, AI Platform suite, Interior Design targeted suite,
  shared library typecheck, builds, and runtime smoke.

## 9. Release gates

- WP-11 targeted tests pass.
- API and AI Platform regressions pass.
- Shared typecheck passes.
- WP-11 TypeScript delta is zero.
- API build and AI Platform production build pass.
- Runtime health and protected-route smoke checks pass.
- Remote PR contains only WP-11 scope, is mergeable, and has P0 = 0/P1 = 0.
- Legacy API errors remain explicitly out of scope.

## 10. Genuine owner decisions

None required to implement the roadmap-defined MVP. The tracked roadmap already
specifies the package contents, dependency on approved WP-10 sessions, storage
pattern, and signed-download behavior. The implementation will reuse the
existing export-workspace/job/storage contracts rather than inventing a second
architecture.

## 11. Branch and implementation status

```text
feature/wp11-export-engine
```

Base:

```text
main @ 81edb468bab1be8df9b8261c16c51b7db133b0ca
```

**WP-11 implementation started: YES**