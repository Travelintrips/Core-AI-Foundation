# GPT02 Issue #159 — Canonical DEV OTP redirect

Date: 2026-11-12. Scope: DEV UI and Supabase Auth URL configuration only.

## Live defect found
The existing standalone approval HTML on VPS `srv1792369` uses an OTP request with `redirect_to=https://dev.cstlogistic.co.id/gpt02-approval-api/` when opened at the canonical GPT02 page.

The canonical login page is actually `https://dev.cstlogistic.co.id/gpt02-approval.html` (verified HTTPS 200). That extra API-prefix redirect creates a second landing path, and the existing Supabase project's Site URL may send users to BizPortal if a requested redirect isn't allowed or the email template ignores it.

This patch changes only the OTP request's redirect URL to the canonical GPT02 static HTML. It also brings the live one-click hash/session restoration logic back into the repository. No password/TOTP step and no extra approval role is introduced. No login email is sent during offline tests.

## Required Supabase hosted-project settings — not editable through current Supabase connector
Project: `xssrfshdrtdfupgqwfdw` (CST-DEV).

At Supabase Dashboard > Authentication > URL Configuration, **add** exactly:

`https://dev.cstlogistic.co.id/gpt02-approval.html`

to **Redirect URLs** (allow list). Keep the existing Site URL unchanged, especially if it is used by BizPortal or another DEV application. Do not replace redirect entries for existing applications.

At Authentication > Email Templates > Magic Link, confirm that the link uses `{{ .ConfirmationURL }}`, not just `{{ .SiteURL }}`, so the per-request `redirect_to` is respected. For a code-only OTP fallback, the template may also provide `{{ .Token }}`. Do not send or disclose raw tokens or production secrets.

The connected Supabase project tools do not expose this Auth URL configuration read/write operation, and no Supabase Management API credential was found on the authorized DEV VPS. Consequently the actual allowed redirect list and email template remain **UNVERIFIED** until checked in the dashboard or by an authenticated real Super Admin magic-link test. A 200 response from the landing page alone is not OTP E2E PASS.

## Verified static contract
- The OTP request is `/auth/v1/otp?redirect_to=https%3A%2F%2Fdev.cstlogistic.co.id%2Fgpt02-approval.html`, encoded once.
- `create_user:false` remains unchanged.
- The redirected fragment `#access_token=...&refresh_token=...` is parsed, removed from URL history, and supplied to the existing authenticated session validator.
- Existing refresh-session behavior still works when no magic-link fragment is present.
- No actual OTP, mailbox access, approval or task is created in tests.
- Approval HTTP API still requires a valid Supabase session and an active Super Admin-to-Hub operator mapping.
- Full lifecycle remains NO-GO; four signer processes and dispatch remain disabled.

## Release sequence
1. Merge the narrowly scoped PR once CI passes.
2. Deploy only the verified login HTML to its VPS runtime path and copy it to the existing static approval URL. Test source SHA matches served HTML; preserve a backup for rollback.
3. Verify exact HTTPS 200 page, JS syntax, unauthenticated pending API 401 and no signing/dispatch side effects.
4. Verify/add the Supabase Auth redirect allow-list entry and email template as above **without changing Site URL**.
5. Only a real Super Admin may initiate and confirm one fresh task's OTP; never reapprove or reuse expired Task 139/140/141/142 or earlier.
