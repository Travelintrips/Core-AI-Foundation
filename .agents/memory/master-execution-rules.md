---
name: Master Execution Rules — Creative AI Universal Design Platform
description: Universal rules for all team branches on this repo. Apply before any implementation. Covers branch hygiene, baseline, architecture, multi-tenant, DB, API, UI, test, and final report format.
---

## Branch Rules (non-negotiable)
- Before any work: run `git branch --show-current`, `git status --short`, `git rev-parse HEAD`.
- Active branch MUST match the BRANCH WAJIB in the prompt exactly.
- Never switch branch, create new branches, merge to integration/release-candidate/main/other team branches, rebase, or force-push.
- Commit and push only to the active branch, only after work is complete.

## Baseline Rules (before implementation)
1. Audit repo structure.
2. Identify existing implementations.
3. Run baseline test, typecheck, build.
4. Record pre-existing failures — do NOT claim them as regressions.
5. Do not fix errors outside scope unless directly required.
6. Do not duplicate services, schemas, types, routes, or engines that already exist.
7. Prefer safe extension/refactor over replacement.

## Architecture Rules (all new modules must)
- TypeScript strict typing.
- Structured JSON as primary contract.
- Schema validation on all inputs/outputs.
- No hardcoded AI provider or model.
- Accept dependencies via interface or dependency injection.
- Tenant-aware for customer data.
- Include audit metadata.
- Never fake AI results, cost, status, production data, or metrics.
- No secrets in source code.
- No second source of truth.
- No direct DB access from UI.
- Do not bind core engine to Fashion/Interior/specific domain.

## Multi-Tenant Rules
- tenantId must come from authenticated context only — never raw from client body/query/header.
- All queries must be tenant-scoped.
- Platform-level access requires a dedicated guard.
- Tests must cover tenant isolation.

## Database Rules
- Migration only if truly necessary.
- Migrations must be idempotent or have safe guards.
- No destructive column drops/replacements.
- Add indexes only when queries require them.
- Report migration order and rollback strategy.
- Never apply production changes manually.

## API Rules
- Use existing routing, middleware, error handler, and authorization patterns.
- Validate all requests and responses.
- Never silently change existing response contracts.
- New contracts: use versioning or additive extension.
- Mutations must have audit trail and idempotency where relevant.
- No giant catch-all endpoints.

## UI Rules
- Use existing design system and components.
- No second design system.
- Maintain responsive behavior, accessibility, loading/empty/error states, keyboard navigation.
- Do not modify global pages or navigation outside scope.
- Never use demo data as live data without a clear label.

## Test Rules (minimum)
- Unit tests for pure logic.
- Schema validation tests.
- Negative tests.
- Authorization / tenant-isolation tests where relevant.
- Integration tests for important boundaries.
- Regression tests for touched existing contracts.

After changes: run relevant tests → full suite if feasible → typecheck → build affected packages → compare with baseline.

## Final Git Rules
```
git status
git diff --check
git diff --stat
git add .
git commit -m "<conventional commit>"
git push -u origin HEAD
```
Do NOT push if new critical tests fail due to team changes.

## Final Report Format
See attached_assets/Pasted-MASTER-EXECUTION-RULES-CREATIVE-AI-UNIVERSAL-DESIGN-PLA_1784647595955.txt lines 306–427 for the full FINAL TEAM REPORT template (sections: Baseline, Implementasi, File, Kontrak, Database, Verification, Compatibility, Risiko, Integration Notes).
