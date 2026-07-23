# SECRET ROTATION REQUIRED

**Status:** URGENT  
**Date Discovered:** 2026-07-23  
**Reason:** Plaintext credentials found in `.replit` file which is version-tracked by git.

---

## ⚠️ COMPROMISED SECRETS

The following secrets have been stored in plaintext in `.replit` under `[userenv.shared]`,
`[userenv.development]`, and `[userenv.production]` blocks, which are committed to git history.
**All of these must be considered compromised and rotated immediately.**

### AI Provider Keys
| Secret | Location in .replit | Action Required |
|---|---|---|
| `OPENAI_API_KEY` | [userenv.shared] | Rotate at platform.openai.com |
| `ANTHROPIC_API_KEY` | [userenv.shared] | Rotate at console.anthropic.com |
| `GEMINI_API_KEY` | [userenv.shared] | Rotate at console.cloud.google.com |
| `REPLICATE_API_TOKEN` | [userenv.shared] | Rotate at replicate.com/account/api-tokens |
| `MISTRAL_API_KEY` | [userenv.shared] | Rotate at console.mistral.ai |
| `COHERE_API_KEY` | [userenv.shared] | Rotate at dashboard.cohere.com |

### Database Credentials
| Secret | Location | Action Required |
|---|---|---|
| `SUPABASE_DATABASE_URL_DEV` | [userenv.development] | Rotate Supabase DB password (dev project) |
| `SUPABASE_DEV_DATABASE_URL` | [userenv.development] | Same dev project (alias) |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | [userenv.development] | Rotate via Supabase dashboard (dev) |
| `SUPABASE_DATABASE_URL` | [userenv.production] | Rotate Supabase DB password (prod project) |
| `SUPABASE_PROD_DATABASE_URL` | [userenv.production] | Same prod project (alias) |
| `SUPABASE_SERVICE_ROLE_KEY` | [userenv.production] | Rotate via Supabase dashboard (prod) |

### Application Secrets
| Secret | Location | Action Required |
|---|---|---|
| `ADMIN_API_KEY` | [userenv.shared] | Generate new key, update all admin clients |
| `SMTP_PASS` | [userenv.shared] | Rotate Hostinger SMTP password |
| `FONNTE_TOKEN` | [userenv.shared] | Rotate at fonnte.com |

### Internal Admin Credentials
| Item | Location | Action Required |
|---|---|---|
| `INITIAL_INTERNAL_ADMIN_PASSWORD` | [userenv.development] | Change after rotation |

---

## Post-Rotation Steps

1. **Rotate all secrets above** with their respective providers.
2. **Set new values as Replit Secrets** (encrypted store) — NOT in `.replit` plaintext.
3. **Remove** the `[userenv.shared]`, `[userenv.development]`, `[userenv.production]` secret values from `.replit`.
4. **Verify app still works** after rotation by checking `/api/healthz/full`.
5. **Run** `pnpm security:scan-secrets` to confirm no remaining plaintext credentials.
6. **Update** `INITIAL_INTERNAL_ADMIN_EMAIL` and reset the admin password via:
   ```bash
   pnpm --filter @workspace/api-server run reset:admin-password
   ```

---

## How to Set Secrets Correctly

Use Replit Secrets (encrypted store):
1. In the Replit sidebar, click **Secrets**.
2. Add each key-value pair.
3. Remove the corresponding line from `.replit` `[userenv.*]` blocks.

**Never use `setEnvVars` for sensitive values** — it writes to `.replit` plaintext.

---

## Note on git History

These secrets may have been present in git commits before this remediation.  
Even after removing them from `.replit`, they may remain in git history.  
**If this is a private repository**, the risk is contained to authorized collaborators.  
**If this repository is or has ever been public**, treat all above secrets as fully compromised.

Consider using `git filter-repo` to scrub history after rotating all secrets.
