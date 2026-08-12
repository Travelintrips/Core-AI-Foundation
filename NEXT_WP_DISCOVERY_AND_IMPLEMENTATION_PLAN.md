# Next Work Package Discovery & Implementation Plan
# Phase 6 WP-10 — Review & Versioning

**Status:** DISCOVERED — IMPLEMENTATION NOT STARTED
**Date:** 2026-08-12
**Baseline SHA:** `e6fc276f15e8452daa94e9f1fb84f8654d7a9501`
**Proposed branch:** `feature/wp10-review-versioning`

---

## 1. Canonical successor resolution

The canonical Phase 6 dependency graph in `docs/phase6-work-packages.md` is:

```text
WP-08 Moodboard Generator
  └── WP-09 Rendering Pipeline
        └── WP-10 Review & Versioning
              └── WP-11 Export Engine
```

WP-10 — **Review & Versioning** is therefore the next work package. The unrelated
quotation, enterprise-platform, and generic design-versioning workstreams are not
used to redefine this sequence.

WP-09 was merged through PR #15. Local `main`, `origin/main`, and the verified
merge commit are all:

```text
e6fc276f15e8452daa94e9f1fb84f8654d7a9501
```

The new WP-10 branch is based directly on that verified `main`. No WP-10
implementation has been started.

## 2. Objective

Implement immutable design revision snapshots, named version boundaries, and the
reviewer approval workflow for the Interior Design session created by WP-06/WP-08
and rendered by WP-09.

The work package must let a designer or system create a revision from a design
state, let authorized reviewers approve or return it with notes, preserve the
lineage between revisions, and make the revision/version history visible without
allowing past snapshots to be silently mutated.

## 3. Canonical scope

### In scope

- `RevisionService` and the domain adapter for the canonical Interior Design
  session/project aggregate.
- Immutable revision snapshots and parent/child lineage.
- Named version boundaries and current-version selection.
- F3–F4 approve/reject endpoints, F7 create-revision endpoint, and F8
  name-version endpoint from the Phase 6 work-package specification.
- Designer revision timeline and version comparison/diff view.
- Admin reviewer approval/return workflow with notes.
- `design_revisions` and `design_versions` persistence, if confirmed by the
  owner decisions below.
- `design_agent_logs` persistence only for the approved WP-10 audit contract.
- RLS migration `rls-v14.sql` for design-session/revision access.
- Unit, integration, tenant-isolation, immutability, concurrency, and UI
  regression coverage.

### Out of scope

- New render providers, render orchestration, or changes to the completed WP-09
  rendering pipeline.
- Export package compilation, PDF generation, or material/furniture manifests;
  those belong to WP-11.
- Quotation, payment, customer-workspace, or unrelated generic versioning
  migrations.
- Replacing `ai_entity_versions` or the existing generic design-versioning
  service without a confirmed domain mapping.
- Drizzle schema replacement or destructive changes to the `ai_platform` schema.

## 4. Dependencies

### Hard dependencies

- **WP-06:** session, placement, tenant, and room-state foundations.
- **WP-08:** moodboard approval and concept-draft foundations.
- **WP-09:** approved render selection flows and render-session linkage.

### Reusable platform foundations

- Existing tenant resolution and `RequestContext`/`RepositoryContext` patterns.
- Global admin authentication and role/permission checks.
- Existing audit logging and safe event publication conventions.
- Existing generated OpenAPI client/Zod workflow.
- Existing `creative_render_sessions`, `creative_projects`, and Interior Design
  concept-draft data.

## 5. Existing foundations and overlap guards

The following foundations exist and must be reused or explicitly adapted:

1. `artifacts/api-server/src/domains/interior-design/` contains the canonical
   project, concept-draft, moodboard, approval-state, and WP-09 render boundary.
   WP-10 must not create a parallel Interior Design aggregate.
2. WP-09 now exposes the render lifecycle through
   `artifacts/api-server/src/services/interiorRenderService.ts` and the
   Interior Design router. Review/versioning should consume its persisted
   session and output identity rather than duplicating render state.
3. `lib/db/src/schema/ai-entity-versions.ts` and
   `artifacts/api-server/src/services/design-versioning/` provide generic,
   tenant-scoped append-only versioning primitives. Their current entity-type
   vocabulary (`brief_snapshot`, `artifact_metadata`, `design_spec`,
   `export_manifest`) does not by itself prove that they are the canonical
   WP-10 schema. Reuse requires an explicit mapping and security review.
4. Existing review-workspace and client-review modules provide patterns for
   reviewer permissions, decisions, notes, and audit behavior, but they must
   not be assumed to own the Phase 6 design-session state machine.
5. Existing Phase 6 domain documentation defines `DesignSession`,
   `RevisionService`, `RevisionFactory.snapshot`, and the WP-10 dependency on
   WP-09. These documents are the architectural source of truth until owner
   decisions are resolved.

## 6. Proposed data and API boundaries

The implementation should define, before coding:

- The immutable revision identity, parent revision, actor, reason, created-at,
  snapshot hash, snapshot payload, and tenant ownership.
- The named version identity, version number/label, current pointer, and the
  revision(s) it represents.
- The review decision, reviewer identity, notes, decision timestamp, and
  allowed state transitions.
- Customer/designer-safe read views that exclude internal AI prompts, provider
  credentials, and unrelated tenant data.
- OpenAPI schemas first, followed by generated React Query and Zod bindings.

Any new route must use the application's existing route-prefix and global
authentication conventions. Tenant identity must be resolved server-side and
never trusted from a body, query parameter, or arbitrary client header.

## 7. Migration and storage requirements

Candidate additive migrations:

- `design_revisions`
- `design_versions`
- `design_agent_logs`
- `rls-v14.sql`

Before implementation, verify whether any of these tables or equivalent
production objects already exist. If new DDL is required:

- Use the `ai_platform` schema explicitly.
- Use hand-written additive SQL and preflight checks.
- Add tenant, ownership, lineage, current-version, and lookup indexes.
- Do not use `drizzle-kit push` against the existing production schema.
- Define rollback notes and verify development/prod migration safety.

## 8. Security implications

- RLS and application authorization must prevent cross-tenant revision reads,
  diffs, approvals, restores, and version promotion.
- Approved/committed snapshots must be append-only; restoration creates a new
  revision rather than mutating history.
- Customer-facing responses must redact internal prompts, agent traces,
  provider metadata, credentials, and unrelated tenant identifiers.
- Reviewer actions require authenticated role/permission checks and an audit
  record with actor, reason, and request correlation.
- Snapshot size, retention, and PII handling must be explicit because room
  snapshots and agent logs can contain customer-provided text.
- Diff endpoints must enforce same-entity and same-tenant constraints before
  comparing content.

## 9. Test and release strategy

- Revision state-machine transition tests, including invalid direct jumps.
- Append-only/immutability tests after approval.
- Concurrent revision creation and monotonic version-number tests.
- Parent/child lineage and restore-as-new-revision tests.
- Same-tenant and cross-tenant IDOR/RLS tests for every read and mutation path.
- Reviewer role/permission, approve, reject, and return-with-notes tests.
- Snapshot size, PII redaction, and audit/event emission tests.
- OpenAPI codegen and generated-client contract checks.
- Interior Design editor timeline/diff/approval regression tests.
- Full API and AI Platform regressions, library typecheck, builds, and runtime
  smoke tests before merge.

## 10. Genuine owner decisions

These decisions materially affect the data model or security contract and must
be resolved before implementation:

1. **Canonical aggregate:** Should WP-10 revisions attach directly to
   `creative_projects`, to a Phase 6 `DesignSession`, or to the approved
   concept-draft identity already used by WP-09? The mapping must be one
   server-owned identity, not a client-selectable union.
2. **Snapshot contents:** Which room/layout/moodboard/render references are
   immutable in the snapshot, and which large or sensitive fields are stored as
   hashes/references instead of full JSONB?
3. **Approval semantics:** Is the reviewer approval a designer workflow,
   internal-admin workflow, customer approval workflow, or an ordered
   combination? Which state is customer-visible after approval?
4. **Version boundary:** Does naming a version freeze one revision, a render
   selection, or a complete bundle of room state plus selected outputs?
5. **Restore behavior:** Confirm that restore always creates a new revision and
   whether it immediately becomes current or requires review again.
6. **Retention and PII:** Define retention, redaction, and access rules for
   full snapshots and `design_agent_logs`.
7. **Generic versioning reuse:** Confirm whether the existing
   `ai_entity_versions` implementation is extended with a canonical
   Interior Design entity type or whether dedicated WP-10 tables are required.

## 11. Proposed branch and implementation status

```text
feature/wp10-review-versioning
```

Base:

```text
main @ e6fc276f15e8452daa94e9f1fb84f8654d7a9501
```

**WP-10 implementation started: NO**

The branch contains discovery planning only. No schema, API, UI, migration,
dependency, or runtime implementation changes have been started for WP-10.

## 12. Readiness verdict

**A — Clearly defined successor, implementation not yet authorized.**

The canonical successor, objective, dependencies, foundations, scope, tests,
migrations, and security implications are defined by the tracked Phase 6
documents. Implementation remains blocked only on the genuine owner decisions in
section 10; no architecture should be invented to bypass them.