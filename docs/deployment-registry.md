# Deployment Registry
## Core AI Foundation — Creative Studio Platform

**Repository:** Travelintrips/Core-AI-Foundation
**Current release:** `material-v5.0.0`
**Last updated:** 2026-07-27

---

## Deployment Environments

### Production

| Field | Value |
|---|---|
| **Repository** | Travelintrips/Core-AI-Foundation |
| **Branch** | `main` |
| **Release tag** | `material-v5.0.0` (commit `b5335e3`) |
| **Deployment target** | Replit Autoscale |
| **Custom domain** | `https://aicore.cstlogistic.co.id` |
| **Replit deployment** | ⚠️ **NOT REGISTERED** — domain responds but no active Replit deployment is associated with this workspace |
| **Status** | `"This app isn't live yet"` (Replit default page) |
| **Responsible owner** | CST Logistic Engineering |
| **Database** | Supabase production (`nzdweipzckfszczzqtuw`) — `ai_platform` schema |
| **Storage bucket** | `ai-assets` on production Supabase project |

**Known issue:** The custom domain `aicore.cstlogistic.co.id` previously served a healthy app (Phase 5 final release report confirmed `/api/healthz/full` returned HTTP 200 and public catalog returned 38 services). As of 2026-07-27, the domain returns Replit's "This app isn't live yet" page. The production Replit deployment must be re-registered before Phase 6 begins.

**Required environment variables (Replit Secrets — production):**

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key (valid key required — previous value was invalid) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `MISTRAL_API_KEY` | Mistral API key |
| `COHERE_API_KEY` | Cohere API key |
| `SESSION_SECRET` | Express session signing secret |
| `SMTP_PASS` | Hostinger SMTP password for email sending |
| `SUPABASE_DATABASE_URL` | Production Supabase connection string |
| `SUPABASE_SERVICE_ROLE_KEY` | Production Supabase service role key |
| `SUPABASE_ANON_KEY` | Production Supabase anon key |
| `VITE_SUPABASE_ANON_KEY` | Same as above, for Vite frontend build |

**Non-secret config (set in `.replit` `[userenv.production]`):**

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://nzdweipzckfszczzqtuw.supabase.co` |
| `PUBLIC_APP_URL` | `https://aicore.cstlogistic.co.id` |
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` |
| `SMTP_FROM` | `info@cstlogistic.co.id` |
| `SMTP_USER` | `info@cstlogistic.co.id` |
| `ADMIN_API_KEY` | Set in `.replit` `[userenv.shared]` |
| `VITE_ADMIN_API_KEY` | Same value as `ADMIN_API_KEY` |

---

### Development (Replit Workspace)

| Field | Value |
|---|---|
| **Repository** | Travelintrips/Core-AI-Foundation |
| **Branch** | `main` |
| **Current commit** | `d330d84` (post-release hotfixes applied) |
| **Deployment target** | Replit workspace (preview only — not published) |
| **Dev domain** | `https://$REPLIT_DEV_DOMAIN` (workspace-specific) |
| **Status** | ✅ Running (all 4 workflows active) |
| **Responsible owner** | Engineering (Replit workspace) |
| **Database** | Supabase dev (`xssrfshdrtdfupgqwfdw`) — `ai_platform` schema |
| **Storage bucket** | `ai-assets` on dev Supabase project |

**Running workflows:**

| Workflow | Service | Port | Status |
|---|---|---|---|
| `artifacts/api-server: API Server` | Express backend | 8080 | ✅ Running |
| `artifacts/ai-platform: web` | Admin portal | 20785 | ✅ Running |
| `artifacts/customer-portal: web` | Customer portal | 23434 | ✅ Running |
| `artifacts/mockup-sandbox: Component Preview Server` | Component sandbox | 8081 | ✅ Running |

**Required environment variables (Replit Secrets — development):**

| Variable | Description | Status |
|---|---|---|
| `SESSION_SECRET` | Express session secret | ✅ Set |
| `OPENAI_API_KEY` | OpenAI key | ✅ Updated (was invalid) |
| `SMTP_PASS` | Hostinger SMTP password | ✅ Set and verified (2026-07-27) |

---

### Staging

| Field | Value |
|---|---|
| **Status** | ❌ **Not configured** |
| **Notes** | No dedicated staging environment exists. Development Replit workspace serves as de-facto staging. For Phase 6, a dedicated staging deployment is recommended to gate production releases. |

---

## Deployment Verification Procedure

Run after any deployment to confirm the environment is healthy:

```bash
# 1. API health (replace domain with target environment URL)
curl -s https://aicore.cstlogistic.co.id/api/healthz
# Expected: HTTP 200

curl -s https://aicore.cstlogistic.co.id/api/healthz/full
# Expected: {"database":"ok","schema":"ok","environment":"ok"}

# 2. Public catalog
curl -s https://aicore.cstlogistic.co.id/api/ai/catalog/public | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('categories:', len(d.get('categories',[])), '| services:', sum(len(c.get('services',[])) for c in d.get('categories',[])))"
# Expected: categories: 3 | services: 38

# 3. Customer portal renders
curl -s https://aicore.cstlogistic.co.id/ | grep -c "Creative Studio"
# Expected: 1 (or more)

# 4. Admin portal renders
curl -s https://aicore.cstlogistic.co.id/admin/ | grep -c "Internal AI Portal\|Sign in"
# Expected: 1 (or more)

# 5. Invalid token is rejected (fail-closed)
curl -o /dev/null -w "%{http_code}" https://aicore.cstlogistic.co.id/api/workspace/invalid-token-test
# Expected: 404
```

---

## Action Required Before Phase 6

1. **Re-register Replit deployment** for production environment
2. ~~**Confirm `SMTP_PASS` secret**~~ ✅ Set and verified — `smtp.hostinger.com:465` healthy
3. **Run privileged smoke test** (see `docs/production-smoke-test-checklist.md`)
4. **Create staging environment** (recommended but not blocking)
