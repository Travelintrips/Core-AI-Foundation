# Phase 6 Entry Checklist
## Room Design Template Library

**Repository:** Travelintrips/Core-AI-Foundation
**Prepared:** 2026-07-27
**Phase 5 release:** `material-v5.0.0` (`b5335e3`)

> Complete every item below before beginning any Phase 6 implementation.
> Each item must be verified — not assumed.

---

## 1. Repository Clean

- [ ] `git status` shows no uncommitted changes in source files
- [ ] No untracked release documents or task briefs in the working tree
- [ ] `.replit` environment metadata is at its intended state (no pending manual edits)
- [ ] All post-release hotfixes merged into `main` (`d330d84` — router scope fix ✅, `66d0f2a` — i18n fix ✅)
- [ ] No open merge conflicts in any file

**Verified by:** _______________
**Date:** _______________

---

## 2. Release Tagged

- [ ] Tag `material-v5.0.0` exists on commit `b5335e3` in the remote repository
- [ ] Tag is pushed to `origin` and visible on GitHub
- [ ] `CHANGELOG.md` entry for `v5.0.0` is present and accurate
- [ ] `docs/release-history.md` reflects the Phase 5 release
- [ ] No Phase 6 code exists in `main` under any branch or stash

**Verified by:** _______________
**Date:** _______________

---

## 3. Regression Stable

- [ ] Full regression suite passes locally: `pnpm -r --if-present run test` (target: 5,378+ tests, 0% error rate)
- [ ] Phase 5 focused import tests pass: 37/37 (`material-import-phase5.test.ts`)
- [ ] Material intelligence Phase 3 foundation tests pass: 98/98
- [ ] No new test failures introduced by post-release hotfixes (`d330d84`, `66d0f2a`)
- [ ] `pnpm run verify` (OpenAPI + typecheck) passes with no errors

**Test run output attached:** _______________
**Date:** _______________

---

## 4. Backlog Approved

- [ ] `docs/material-phase6-backlog.md` reviewed and approved by product owner
- [ ] Must Have items (M1–M6) prioritised and assigned
- [ ] Phase 6 scope formally agreed — no scope additions after this gate
- [ ] Dependencies between backlog items verified (M1 before M3 before S2)
- [ ] Estimated effort reviewed and sprint capacity confirmed

**Approved by:** _______________
**Date:** _______________

---

## 5. Architecture Approved

- [ ] `docs/adr/001` through `docs/adr/006` reviewed and accepted by engineering lead
- [ ] `docs/engineering-roadmap.md` reviewed and Phase 6 section confirmed accurate
- [ ] Room Design Template Library data model reviewed (tables: `room_templates`, `template_material_slots`)
- [ ] API surface for Phase 6 routes reviewed (no collision with existing `/ai/material-import`, `/material-library` prefixes)
- [ ] `material_categories` hierarchy finalised and seeded (prerequisite for Room Template Library)
- [ ] PluginManifest fragmentation resolution plan confirmed (backlog item M4)

**Reviewed by:** _______________
**Date:** _______________

---

## 6. Security Review Complete

- [ ] All Phase 5 security items from `docs/material-phase5-retrospective.md` (Section 9) resolved
- [ ] Admin auth middleware confirmed on all new Phase 5 routes (analytics auth test passing)
- [ ] SSRF guard verified active on asset URL ingestion paths
- [ ] Rate limiting confirmed on all public-facing endpoints
- [ ] Supabase RLS policies reviewed for new Phase 5 tables (`material_import_staging`, `material_import_audit`)
- [ ] No secrets present in source files, `.replit` userenv, or committed `.env` files
- [ ] `ADMIN_API_KEY` and `VITE_ADMIN_API_KEY` confirmed valid in Replit Secrets (not `.replit`)

**Reviewed by:** _______________
**Date:** _______________

---

## 7. Documentation Complete

- [ ] `CHANGELOG.md` exists and has Phase 5 entry ✅
- [ ] `docs/release-history.md` exists and reflects all phases ✅
- [ ] `docs/adr/` has 6 ADR files (ADR-001 through ADR-006) ✅
- [ ] `docs/engineering-roadmap.md` exists and is current ✅
- [ ] `docs/material-phase5-retrospective.md` exists and is complete ✅
- [ ] `docs/material-phase6-backlog.md` exists and is approved (item 4 above)
- [ ] `docs/production-migration-runbook.md` exists and covers Phase 5 tables (⚠️ **OUTSTANDING — must be created**)
- [ ] `replit.md` project overview is current

**Documentation gap note:** `docs/production-migration-runbook.md` is the only outstanding documentation item. It must be created before any Phase 6 schema changes are applied.

**Verified by:** _______________
**Date:** _______________

---

## 8. Production Deployment Verified

- [ ] Active Replit deployment registered and confirmed (was missing at Phase 5 release)
- [ ] `/api/healthz/full` returns HTTP 200 in production
- [ ] Privileged production smoke test completed:
  - [ ] Staff login (admin portal)
  - [ ] Public catalog visible (3+ categories, 38+ services)
  - [ ] Service request creation
  - [ ] Brief submission
  - [ ] Quotation generation and approval
  - [ ] Payment flow
  - [ ] AI generation triggered
  - [ ] Artifact produced
  - [ ] ZIP delivery
  - [ ] Customer workspace accessible
- [ ] Worker / Queue / Scheduler startup confirmed in production logs
- [ ] AI provider health checks green (no 401 errors from OpenAI, Anthropic)
- [ ] Material import pipeline accessible in production admin

**Smoke test report attached:** _______________
**Date:** _______________

---

## Sign-off

All items above must be checked before Phase 6 begins.

| Role | Name | Date | Signature |
|---|---|---|---|
| Engineering Lead | | | |
| Product Owner | | | |
| Release Manager | | | |

---

## Outstanding Items (as of 2026-07-27)

The following items from this checklist are **not yet complete** and must be resolved before Phase 6 begins:

| # | Item | Owner | Notes |
|---|---|---|---|
| 8 | Active Replit deployment registered | Engineering | Was blocking Phase 5 GO LIVE |
| 8 | Privileged production smoke test | Engineering | Requires active deployment |
| 7 | `docs/production-migration-runbook.md` | Engineering | Not yet created |
| 5 | `material_categories` hierarchy finalised | Product | Required by Room Template Library |
| 4 | Phase 6 backlog formally approved | Product | Pending product owner sign-off |
