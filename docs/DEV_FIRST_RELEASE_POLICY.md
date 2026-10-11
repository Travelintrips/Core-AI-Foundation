# AI Core release policy: DEV → validated → PROD

Every **new AI Core coding feature or new job type** is developed in `develop`. Real operational user requests in PROD continue to run against production data; do **not** copy real payments, tenant records, credentials or WhatsApp destinations into DEV.

## DEV acceptance (mandatory)

1. New coding tasks in the AI Core owner trigger and the manual live-coding delegation target `develop`; no direct production deployment authority.
2. Run **CI Verify** on the exact `develop` commit (typecheck, full test suite, build, release-gate regression tests).
3. Run **DEV Fast Verify** and **Hostinger DEV Deploy** on that same commit.
4. Assert `https://dev-aicore.cstlogistic.co.id/api/healthz` returns HTTP 200, `{"status":"ok"}`, and header `x-cst-commit-sha` equal to the current `develop` SHA.
5. Execute representative non-destructive smoke tests on isolated Supabase DEV and only smoke workers. Coding/OpenClaw/WhatsApp/GPU canaries require independently isolated DEV credentials; never reuse production side effects.
6. Record the tests and observed output; do not call untested features approved.

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
