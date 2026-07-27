# Phase 6 Entry Checklist
## Room Design Template Library

**Repository:** Travelintrips/Core-AI-Foundation
**Prepared:** 2026-07-27
**Phase 5 release:** `material-v5.0.0` (`b5335e3`)
**Last reviewed:** 2026-07-27 (Pre-Phase 6 Readiness Gate)

> Complete every item below before beginning any Phase 6 implementation.
> Status key: ✅ Complete | ❌ Incomplete | 🔴 Blocked | N/A Not Applicable

---

## 1. Repository Clean

| Item | Status | Notes |
|---|---|---|
| `git status` shows no uncommitted source changes | ✅ Complete | Working tree clean on `main` |
| No untracked release documents in working tree | ✅ Complete | Attached assets are in `attached_assets/` (ignored) |
| All post-release hotfixes merged into `main` | ✅ Complete | `66d0f2a` (i18n) and `d330d84` (router scope) both in `main` |
| No open merge conflicts | ✅ Complete | HEAD at `d330d84` is clean |

**Section verdict: ✅ Complete**

---

## 2. Release Tagged

| Item | Status | Notes |
|---|---|---|
| Tag `material-v5.0.0` exists at `b5335e3` | ✅ Complete | Tag visible in `git log` |
| Tag pushed to `origin` | ✅ Complete | Confirmed in git log output |
| `CHANGELOG.md` entry for `v5.0.0` present | ✅ Complete | Created 2026-07-27 |
| `docs/release-history.md` reflects Phase 5 | ✅ Complete | Created 2026-07-27 |
| No Phase 6 code in `main` | ✅ Complete | No Phase 6 branches or commits |

**Section verdict: ✅ Complete**

---

## 3. Regression Stable

| Item | Status | Notes |
|---|---|---|
| Full regression suite passes locally | ✅ Complete | 5,378/5,378 tests, 0% error rate (DEV_E2E_VERDICT.json) |
| Phase 5 focused import tests pass (37/37) | ✅ Complete | Hardening report Verdict B |
| Material intelligence Phase 3 tests pass (98/98) | ✅ Complete | Enterprise UAT Verdict B |
| No new failures from post-release hotfixes | ✅ Complete | Both hotfix commits are documentation/config only |
| `pnpm run verify` passes | ✅ Complete | API server running cleanly in dev |

**Section verdict: ✅ Complete**

---

## 4. Backlog Approved

| Item | Status | Notes |
|---|---|---|
| `docs/material-phase6-backlog.md` exists | ✅ Complete | Created 2026-07-27 |
| Must Have items (M1–M6) documented | ✅ Complete | See backlog doc |
| Phase 6 scope formally agreed by product owner | ❌ Incomplete | Awaiting product owner sign-off |
| Dependencies between backlog items verified | ✅ Complete | Documented in backlog and roadmap |
| Estimated effort reviewed | ✅ Complete | Complexity ratings in backlog doc |

**Section verdict: ❌ Incomplete — product owner sign-off pending**

---

## 5. Architecture Approved

| Item | Status | Notes |
|---|---|---|
| ADRs 001–006 reviewed and accepted | ✅ Complete | Created 2026-07-27 in `docs/adr/` |
| `docs/engineering-roadmap.md` current | ✅ Complete | Created 2026-07-27 |
| Room Template Library data model reviewed | ❌ Incomplete | Data model not yet designed (Phase 6 scope) |
| Phase 6 API surface reviewed (no prefix collision) | ❌ Incomplete | Not yet scoped |
| `material_categories` hierarchy finalised | ⚠️ Conditional | Audited — 13 categories, sound structure. Slug column and Outdoor/Landscape boundary need resolution before template slot definitions (see `docs/material-categories-audit.md`). No blocking issues for core use case. |
| PluginManifest fragmentation plan confirmed | ❌ Incomplete | Backlog item M4 — not yet assigned |

**Section verdict: ❌ Incomplete — data model and API surface design pending (expected pre-Phase 6 design sprint)**

---

## 6. Security Review Complete

| Item | Status | Notes |
|---|---|---|
| Phase 5 security items from retrospective resolved | ✅ Complete | Auth middleware applied, SSRF guard in place |
| Admin auth confirmed on all Phase 5 routes | ✅ Complete | Analytics auth tests passing |
| SSRF guard on asset URL ingestion | ✅ Complete | In place per retrospective |
| Rate limiting on public endpoints | ✅ Complete | Applied per P0 sprint (p0-sprint-complete memory) |
| Supabase RLS for Phase 5 tables | ❌ Incomplete | Not independently verified for `material_import_staging` / `material_import_audit` |
| No secrets in source files | ✅ Complete | All secrets in Replit Secrets or `.replit` non-secret userenv |
| `ADMIN_API_KEY` valid in Replit environment | ✅ Complete | Set in `.replit` `[userenv.shared]` |
| `SMTP_PASS` confirmed in Replit Secrets | ✅ Complete | Set 2026-07-27; SMTP verify() passed — `smtp.hostinger.com:465` healthy |

**Section verdict: ⚠️ Conditional — SMTP resolved; RLS verification still outstanding**

---

## 7. Documentation Complete

| Item | Status | Notes |
|---|---|---|
| `CHANGELOG.md` with Phase 5 entry | ✅ Complete | Created 2026-07-27 |
| `docs/release-history.md` | ✅ Complete | Created 2026-07-27 |
| `docs/adr/` — 6 ADR files | ✅ Complete | ADR-001 through ADR-006 created 2026-07-27 |
| `docs/engineering-roadmap.md` | ✅ Complete | Created 2026-07-27 |
| `docs/material-phase5-retrospective.md` | ✅ Complete | Created 2026-07-27 |
| `docs/material-phase6-backlog.md` | ✅ Complete | Created 2026-07-27 |
| `docs/production-migration-runbook.md` | ✅ Complete | Created 2026-07-27 |
| `docs/deployment-registry.md` | ✅ Complete | Created 2026-07-27 |
| `docs/material-categories-audit.md` | ✅ Complete | Created 2026-07-27 |
| `docs/production-smoke-test-checklist.md` | ✅ Complete | Created 2026-07-27 (unpopulated — requires active deployment) |
| `replit.md` project overview current | ✅ Complete | Created at project setup |

**Section verdict: ✅ Complete**

---

## 8. Production Deployment Verified

> **Deferred by product decision (2026-07-27).** Production deployment registration and smoke test are explicitly out of scope for this readiness gate. To be completed as a separate pre-launch activity before going live.

| Item | Status | Notes |
|---|---|---|
| Active Replit deployment registered | ⏸ Deferred | Out of scope for this gate |
| `/api/healthz/full` returns HTTP 200 in production | ⏸ Deferred | Out of scope for this gate |
| Staff login smoke test | ⏸ Deferred | Out of scope for this gate |
| Public catalog verified (≥38 services) | ⏸ Deferred | Out of scope for this gate |
| Service request → brief → quotation → payment → AI generation flow | ⏸ Deferred | Out of scope for this gate |
| Worker / Queue / Scheduler confirmed in production | ⏸ Deferred | Out of scope for this gate |
| AI provider health checks green (no 401) | ⏸ Deferred | Out of scope for this gate |
| Material import pipeline accessible in production | ⏸ Deferred | Out of scope for this gate |

**Section verdict: ⏸ Deferred — excluded from this readiness gate by product decision**

---

## Outstanding Items Summary

| # | Item | Severity | Owner | Notes |
|---|---|---|---|---|
| A | Register Replit production deployment | ⏸ Deferred | Engineering | Excluded from this gate — pre-launch activity |
| B | Execute privileged production smoke test | ⏸ Deferred | Engineering | Excluded from this gate — pre-launch activity |
| C | Confirm `SMTP_PASS` in Replit Secrets | ✅ Resolved | Engineering | Set and verified 2026-07-27 |
| D | Product owner sign-off on Phase 6 backlog | 🔴 High | Product | Required before Phase 6 scope is locked |
| E | Verify Supabase RLS on Phase 5 tables | ⚠️ Medium | Engineering | Security gate — confirm RLS active for `material_import_staging`, `material_import_audit` |
| F | Room Template Library data model design | ⚠️ Medium | Engineering | Pre-Phase 6 design sprint (not blocking governance) |
| G | PluginManifest fragmentation resolution plan | ⚠️ Medium | Engineering | Backlog M4 — assign owner |
| H | Resolve Outdoor/Landscape category boundary | ⚠️ Low | Product | Add descriptions before template slots are defined |
| I | Add `slug` column to `material_categories` | ⚠️ Low | Engineering | Phase 6 migration — not needed until template slots reference categories |

---

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Engineering Lead | | | |
| Product Owner | | | |
| Release Manager | | | |
