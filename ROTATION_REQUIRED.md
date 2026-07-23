# ROTATION REQUIRED

> **Because these credentials were stored in a git-tracked file, they must be
> treated as compromised even after removal from the current working tree.**
> Git history preserves the exposed values permanently until history is rewritten.
> Rotate ALL credentials listed below immediately, regardless of whether
> unauthorized access is confirmed.

---

## 1. AI Providers

| Variable | System / Provider | Exposure source | Status | Action required | Owner | Verification after rotation |
|---|---|---|---|---|---|---|
| `OPENAI_API_KEY` | OpenAI | tracked `.replit` | **NOT ROTATED** | Revoke key in OpenAI dashboard, generate new key, update Replit Secret | Platform team | API call returns 200 with new key |
| `ANTHROPIC_API_KEY` | Anthropic | tracked `.replit` | **NOT ROTATED** | Revoke key in Anthropic console, generate new key, update Replit Secret | Platform team | API call returns 200 with new key |
| `GEMINI_API_KEY` | Google AI / Gemini | tracked `.replit` | **NOT ROTATED** | Revoke key in Google Cloud console, generate new key, update Replit Secret | Platform team | API call returns 200 with new key |
| `MISTRAL_API_KEY` | Mistral AI | tracked `.replit` | **NOT ROTATED** | Revoke key in Mistral dashboard, generate new key, update Replit Secret | Platform team | API call returns 200 with new key |
| `COHERE_API_KEY` | Cohere | tracked `.replit` | **NOT ROTATED** | Revoke key in Cohere dashboard, generate new key, update Replit Secret | Platform team | API call returns 200 with new key |
| `REPLICATE_API_TOKEN` | Replicate | tracked `.replit` | **NOT ROTATED** | Revoke token in Replicate account settings, generate new token, update Replit Secret | Platform team | API call returns 200 with new token |

---

## 2. Database / Supabase

| Variable | System / Provider | Exposure source | Status | Action required | Owner | Verification after rotation |
|---|---|---|---|---|---|---|
| `SUPABASE_DEV_DATABASE_URL` / `SUPABASE_DATABASE_URL_DEV` | Supabase (dev) | tracked `.replit` | **NOT ROTATED** | Reset database password in Supabase dashboard, update connection string in Replit Secret | Platform team | `pnpm --filter @workspace/api-server run dev` connects without error |
| `SUPABASE_PROD_DATABASE_URL` / `SUPABASE_DATABASE_URL` | Supabase (prod) | tracked `.replit` | **NOT ROTATED** | Reset database password in Supabase dashboard, update connection string in Replit Secret | Platform team | Production API health check passes |
| `SUPABASE_ANON_KEY_DEV` | Supabase (dev) | tracked `.replit` | **NOT ROTATED** | Rotate JWT secret in Supabase dashboard (Project Settings → API), update Replit Secret | Platform team | Dev frontend loads without 401 |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | Supabase (dev) | tracked `.replit` | **NOT ROTATED** | Rotate JWT secret in Supabase dashboard (Project Settings → API), update Replit Secret | Platform team | Seeding / admin operations succeed |
| `SUPABASE_ANON_KEY` | Supabase (prod) | tracked `.replit` | **NOT ROTATED** | Rotate JWT secret in Supabase dashboard (Project Settings → API), update Replit Secret | Platform team | Production frontend loads without 401 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (prod) | tracked `.replit` | **NOT ROTATED** | Rotate JWT secret in Supabase dashboard (Project Settings → API), update Replit Secret | Platform team | Production admin operations succeed |
| `VITE_SUPABASE_ANON_KEY` | Supabase (prod, frontend) | tracked `.replit` | **NOT ROTATED** | Same as `SUPABASE_ANON_KEY` — update Replit Secret after rotation | Platform team | Production frontend Supabase client initialises |

---

## 3. SMTP

| Variable | System / Provider | Exposure source | Status | Action required | Owner | Verification after rotation |
|---|---|---|---|---|---|---|
| `SMTP_PASS` | Hostinger SMTP | tracked `.replit` | **NOT ROTATED** | Change email account password in Hostinger control panel, update Replit Secret | Platform team | Test email delivery succeeds |

---

## 4. WhatsApp / Fonnte

| Variable | System / Provider | Exposure source | Status | Action required | Owner | Verification after rotation |
|---|---|---|---|---|---|---|
| `FONNTE_TOKEN` | Fonnte (WhatsApp gateway) | tracked `.replit` | **NOT ROTATED** | Revoke token in Fonnte dashboard, generate new token, update Replit Secret | Platform team | WhatsApp notification delivery succeeds |

---

## 5. Admin / API Authentication

| Variable | System / Provider | Exposure source | Status | Action required | Owner | Verification after rotation |
|---|---|---|---|---|---|---|
| `ADMIN_API_KEY` | Internal API server | tracked `.replit` | **NOT ROTATED** | Generate new random hex key (`openssl rand -hex 24`), update both `ADMIN_API_KEY` and `VITE_ADMIN_API_KEY` Replit Secrets | Platform team | Admin dashboard authenticates; existing admin sessions will be invalidated |
| `VITE_ADMIN_API_KEY` | Internal API server (frontend) | tracked `.replit` | **NOT ROTATED** | Same rotation as `ADMIN_API_KEY` — values must match | Platform team | Same as above |

---

## 6. Session / Token Secrets

| Variable | System / Provider | Exposure source | Status | Action required | Owner | Verification after rotation |
|---|---|---|---|---|---|---|
| `SESSION_SECRET` | Express session middleware | Replit Secrets (not in `.replit`) | **NOT ROTATED** | Generate new secret (`openssl rand -hex 32`), update Replit Secret — all active sessions will be invalidated | Platform team | Login flow succeeds after rotation |

> Note: `SESSION_SECRET` was managed via Replit Secrets and was not exposed in the tracked `.replit` file.
> It is included here for completeness because it is a credential that should be rotated as a precaution
> alongside the exposed secrets.

---

## 7. Internal Admin Bootstrap

| Variable | System / Provider | Exposure source | Status | Action required | Owner | Verification after rotation |
|---|---|---|---|---|---|---|
| `INITIAL_INTERNAL_ADMIN_EMAIL` | Internal admin seed | tracked `.replit` | **NOT ROTATED** | Change the admin account email via the admin dashboard, update Replit Secret | Platform team | Admin login succeeds with new email |
| `INITIAL_INTERNAL_ADMIN_PASSWORD` | Internal admin seed | tracked `.replit` | **NOT ROTATED** | Change the admin account password via the admin dashboard or re-seed, update Replit Secret | Platform team | Admin login succeeds with new password |

---

## Remediation Checklist

- [ ] All AI provider keys rotated
- [ ] Supabase dev database password reset
- [ ] Supabase prod database password reset
- [ ] Supabase dev JWT secret rotated (invalidates anon + service-role keys)
- [ ] Supabase prod JWT secret rotated (invalidates anon + service-role keys)
- [ ] SMTP password changed
- [ ] Fonnte token revoked and replaced
- [ ] `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` replaced
- [ ] `SESSION_SECRET` rotated (precautionary)
- [ ] Internal admin credentials changed
- [ ] Git history scrubbed or repository access reviewed (consider `git filter-repo` or GitHub secret scanning alerts)
- [ ] All active sessions invalidated after `SESSION_SECRET` rotation
- [ ] Verify no third-party access to Supabase project using old service-role key
