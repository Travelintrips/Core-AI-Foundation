# AI Core release policy: DEV → validated → PROD

Every **new AI Core coding feature or new job type** is developed in `develop`. Real operational user requests in PROD continue to run against production data; do **not** copy real payments, tenant records, credentials or WhatsApp destinations into DEV.

## DEV acceptance (mandatory)

1. New coding tasks in the AI Core owner trigger and the manual live-coding delegation target `develop`; no direct production deployment authority.
2. Run **CI Verify** on the exact `develop` commit (typecheck, full test suite, build, release-gate regression tests).
3. Run **DEV Fast Verify** and **Hostinger DEV Deploy** (the **VPS-isolated DEV verifier**, not the Hostinger shared-hosting deployment) on that same commit. The VPS pull-only watcher may release only a CI-green `develop` SHA.
4. Assert `https://dev.cstlogistic.co.id/api/healthz` returns HTTP 200, `{"status":"ok"}`, and header `x-cst-commit-sha` equal to the current `develop` SHA. The canonical DEV AI Task dashboard is `https://dev.cstlogistic.co.id/aicoding`.
5. Execute representative non-destructive smoke tests on isolated Supabase DEV and only smoke workers. Coding/OpenClaw/WhatsApp/GPU canaries require independently isolated DEV credentials; never reuse production side effects.
6. Record the tests and observed output; do not call untested features approved.

## DEV hosting boundary

- The canonical **AI Task / AI Core DEV frontend and API** live on the **isolated VPS** at `dev.cstlogistic.co.id`. Its backend is a separate container and port from `aicore.cstlogistic.co.id` production. The two share host-level CPU, disk and RAM, so builds remain capacity-bounded.
- `dev-aicore.cstlogistic.co.id` is a **legacy shared-hosting DEV console** whose Hostinger control-plane API may be unavailable. Its GitHub Actions workflow is **manual-only** and **not** a release gate or a substitute for VPS DEV verification. Do **not** change DNS or alias this hostname to VPS without a separate approved migration plan.
- The existing `Hostinger DEV Deploy` workflow, despite its historical name, verifies **VPS DEV** and production SHA invariants. The VPS watcher, not the shared-hosting workflow, pulls the tested release.
- Check the exact commit, static assets, protected API behavior, CI and smoke tests before reporting `DEPLOYED_VERIFIED` for DEV. Never infer a live browser-account GPT-02/03 binding from a dashboard deployment.

## Promotion to PROD

- Promote with a reviewed Git **merge commit** descending from the exact fully tested DEV SHA; do not squash away the DEV ancestry.
- Preserve distinct PROD environment configuration. Production releases must not share DEV DB credentials.
- Require a clean production PR and a fresh, green main CI. Do **not** auto-merge direct-to-main PRs.
- Before the Hostinger production action or AI Worker VPS deployment touches credentials or infrastructure, `node scripts/verify-dev-first-release.mjs "$EXPECTED_SHA"` validates:
  - DEV health and live commit match `develop`;
  - exact full CI + DEV Fast Verify + Hostinger DEV Deploy successful at that SHA;
  - the production commit descends from that exact DEV commit;
  - shared source files match DEV, with only reviewed DEV-specific exceptions.
- Fail closed on any missing/failed check, stale code, missing API evidence, or unapproved differences.
- Verify PROD smoke tests **after** deployment. If a smoke fails, investigate or roll back; do not claim success.

## Production paths outside GitHub Actions

Hostinger **native Git auto-deploy** is a separate transport and can trigger on main pushes before the GitHub Actions release guard. Disable native automatic production deploy in Hostinger or set it to manual/approved releases; otherwise no GitHub-only control can guarantee a universal DEV-first barrier. Protected GitHub branch rules and production environment reviewers should also require promotion approval.

## Limits

The automated gate does not mean all possible workflows, model providers, WA deliveries, or hardware failovers have been E2E tested; stage-specific evidence is required. A production hotfix is not exempt: fix/verify in DEV first, or handle as a separately authorized emergency with explicit recorded risk.
