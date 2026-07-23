# ROTATION_REQUIRED.md

> Generated: 2026-07-23  
> Branch: production-readiness-remediation  
> Status: **ACTION REQUIRED — credentials in tracked files**

---

## Summary

The `.replit` file is tracked by git and contains live production credentials in plaintext under `[userenv.shared]`, `[userenv.development]`, and `[userenv.production]` sections. Any actor with read access to the repository can extract these credentials.

All listed credentials must be rotated and re-issued before this branch is merged to main or deployed.

---

## Credentials Requiring Rotation

| Variable Name | Environment | Type | Exposed in `.replit` | Rotation Required |
|---|---|---|---|---|
| `OPENAI_API_KEY` | shared | AI provider key | YES | **YES** |
| `ANTHROPIC_API_KEY` | shared | AI provider key | YES | **YES** |
| `COHERE_API_KEY` | shared | AI provider key | YES | **YES** |
| `GEMINI_API_KEY` | shared | AI provider key | YES | **YES** |
| `MISTRAL_API_KEY` | shared | AI provider key | YES | **YES** |
| `REPLICATE_API_TOKEN` | shared | AI provider token | YES | **YES** |
| `ADMIN_API_KEY` | shared | Internal admin auth | YES | **YES** |
| `VITE_ADMIN_API_KEY` | shared | Frontend admin auth | YES | **YES** |
| `FONNTE_TOKEN` | shared | WhatsApp API token | YES | **YES** |
| `SMTP_PASS` | shared | Email password | YES | **YES** |
| `SMTP_USER` | shared | Email username | YES | Verify unchanged |
| `SMTP_HOST` | shared | SMTP host (non-secret) | YES | No |
| `SMTP_PORT` | shared | SMTP port (non-secret) | YES | No |
| `SMTP_FROM` | shared | Email from (non-secret) | YES | No |
| `ALLOWED_ORIGINS` | shared | CORS origins (non-secret) | YES | No |
| `SUPABASE_DATABASE_URL_DEV` | development | DB connection string w/ password | YES | **YES** |
| `SUPABASE_DEV_DATABASE_URL` | development | DB connection string w/ password (alias) | YES | **YES** |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | development | Supabase service role JWT | YES | **YES** |
| `SUPABASE_ANON_KEY_DEV` | development | Supabase anon JWT | YES | Assess — anon keys are public-safe but rotation confirms intent |
| `SUPABASE_STORAGE_BUCKET_DEV` | development | Storage URL (non-secret) | YES | No |
| `SUPABASE_URL_DEV` | development | Supabase project URL (non-secret) | YES | No |
| `INITIAL_INTERNAL_ADMIN_EMAIL` | development | Admin seed email | YES | Change password |
| `INITIAL_INTERNAL_ADMIN_PASSWORD` | development | Admin seed password | YES | **YES** |
| `SUPABASE_DATABASE_URL` | production | Prod DB connection w/ password | YES | **YES — CRITICAL** |
| `SUPABASE_PROD_DATABASE_URL` | production | Prod DB connection w/ password (alias) | YES | **YES — CRITICAL** |
| `SUPABASE_SERVICE_ROLE_KEY` | production | Prod Supabase service role JWT | YES | **YES — CRITICAL** |
| `SUPABASE_ANON_KEY` | production | Prod Supabase anon JWT | YES | Assess |
| `VITE_SUPABASE_ANON_KEY` | production | Prod Supabase anon JWT (frontend) | YES | Assess |
| `SUPABASE_STORAGE_BUCKET` | production | Storage URL (non-secret) | YES | No |
| `SUPABASE_URL` | production | Supabase project URL (non-secret) | YES | No |
| `PUBLIC_APP_URL` | production | Public domain (non-secret) | YES | No |
| `SESSION_SECRET` | — | Session signing key | In Replit Secrets ✓ | No (not exposed) |

---

## Required Actions

### Step 1 — Rotate all marked credentials

1. **OpenAI**: Revoke `sk-proj-...` in https://platform.openai.com/api-keys and generate a new key.
2. **Anthropic**: Revoke `sk-ant-api03-...` in https://console.anthropic.com and generate a new key.
3. **Cohere**: Rotate in https://dashboard.cohere.com
4. **Google Gemini**: Rotate in https://aistudio.google.com/app/apikey
5. **Mistral**: Rotate in https://console.mistral.ai
6. **Replicate**: Rotate `r8_...` in https://replicate.com/account/api-tokens
7. **Supabase (production)**: Rotate database password via Supabase dashboard → Settings → Database → Reset Password. This rotates the connection string.
8. **Supabase (development)**: Same for dev project.
9. **Supabase service role keys**: Rotate via Supabase dashboard → Settings → API → rotate JWT secret (or re-generate service role key).
10. **SMTP password**: Change via Hostinger email admin panel.
11. **ADMIN_API_KEY / VITE_ADMIN_API_KEY**: Generate new 48-char hex value (`openssl rand -hex 24`).
12. **Fonnte token**: Rotate in Fonnte dashboard.
13. **INITIAL_INTERNAL_ADMIN_PASSWORD**: Change the internal admin account password in the application.

### Step 2 — Store new values in Replit Secrets

After rotating, store each new credential value through the Replit Secrets UI (not in `.replit`).

### Step 3 — Clean `.replit`

Remove all actual values from `[userenv]` sections in `.replit`. Keep the variable names (for documentation) but replace values with empty strings or remove the assignments entirely. The Replit Secrets will supply the values at runtime.

### Step 4 — Confirm git history

Because the credentials were committed to git, rotation alone is not sufficient. The git history also contains the old values. If this repository is public or has broad internal access:
- Consider a git history rewrite (`git filter-repo`) to purge the old values from history.
- Alternatively, treat all old values as permanently compromised and rely solely on rotation.

---

## AUTOMATED PAYMENT GATEWAY EXCLUDED FROM SCOPE BY PRODUCT DECISION.

No Midtrans, Xendit, Paylabs, or automated payment callback credentials are present in `.replit`. The manual payment flow remains unchanged.
