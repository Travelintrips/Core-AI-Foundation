# WP-14 Rollback Runbook — AI Platform Production

**Audience:** On-call engineer  
**Scope:** Full rollback procedures for every layer: code, database, secrets, and dependent services.  
**Last updated:** 2026-07-14

---

## 1. Decision Matrix — When to Roll Back vs. Hot-Fix

| Symptom | Severity | Action |
|---|---|---|
| `/healthz/full` returns `status: "fail"` | Critical | **Roll back immediately** |
| 5xx error rate > 5% sustained for 2+ minutes | Critical | **Roll back immediately** |
| DB pool exhausted (all connections waiting) | Critical | **Roll back + notify DBA** |
| Admin API key auth leaking 401 to valid keys | High | Roll back after confirming key mismatch |
| RLS blocking legitimate reads (zero rows returned) | High | Disable RLS policy, then hot-fix |
| Single endpoint returning 500 | Medium | Hot-fix unless root cause unclear |
| Smoke test SSRF check failing | Medium | Hot-fix (guard regression) |
| Slow response (p95 > 5s) without errors | Low | Investigate before rollback |

---

## 2. Code Rollback (Replit Checkpoint)

Replit stores checkpoints automatically. Rolling back reverts both code **and** `node_modules`.

```
1. Open the Replit IDE → Checkpoints panel (left sidebar → clock icon)
2. Find the last known-good checkpoint (use "Pre-WP-12 deploy" label if set)
3. Click "Restore this checkpoint"
4. After restore, restart all 4 workflows:
     pnpm run build:generated
     pnpm run build:api
     # Workflows will auto-restart; confirm in the workflow panel
5. Run smoke test to verify:
     API_BASE_URL=https://<replit-domain>/api \
     ADMIN_API_KEY=<key> \
     bash scripts/smoke-test.sh
```

**Expected outcome:** All smoke test checks pass, `/healthz/full` returns `status: ok`.

---

## 3. Database Migration Rollback

### 3a. Roll back RLS policies (rls-v12.sql)

If RLS is blocking legitimate data access, disable it per-table:

```sql
-- Connect as service-role user (bypasses RLS, so verify the fix in anon role)
SET search_path TO ai_platform, public;

-- Disable RLS on affected tables (preserves the policy definitions)
ALTER TABLE ai_platform.ai_installed_packages DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_quotations          DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_commercial_gates    DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_services            DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_service_packages    DISABLE ROW LEVEL SECURITY;

-- To fully remove (only if disabling alone is insufficient):
-- DROP POLICY IF EXISTS tenant_isolation ON ai_platform.ai_installed_packages;
```

**To re-enable after fix:** Re-run `scripts/migrations/rls-v12.sql`.

**Fail-closed verification after re-enable (run as anon key):**
```sql
-- Should return 0 rows (no session variable set):
SELECT COUNT(*) FROM ai_platform.ai_installed_packages;

-- Should return rows with correct tenant:
SELECT set_config('app.current_tenant_id', 'default', true);
SELECT COUNT(*) FROM ai_platform.ai_installed_packages;
```

### 3b. Roll back indexes (indexes-v12.sql)

Indexes are additive and non-destructive. To remove one if it causes issues:
```sql
DROP INDEX IF EXISTS ai_platform.idx_audit_resource_id;
-- (repeat for any other index from indexes-v12.sql)
```

No data is lost when dropping an index.

---

## 4. Environment Variable / Secret Rollback

If a secret was changed (e.g. `ADMIN_API_KEY` rotated) and the old value needs restoring:

```
1. Go to Replit Secrets panel
2. Update the secret to the previous value
3. Restart all workflows (secrets are injected at start-up)
4. Run pre-deploy-check.sh to verify auth enforcement is correct
```

**Warning:** The `VITE_ADMIN_API_KEY` must always equal `ADMIN_API_KEY`. If they diverge, the admin frontend will fail silently.

---

## 5. Individual Service Rollback

### api-server only
```bash
# If only the api-server is broken, rebuild and restart without touching frontend:
pnpm run build:api
# Then restart the api-server workflow in the Replit UI
```

### Frontend only (ai-platform / customer-portal)
```bash
# Rebuild libs (includes codegen):
pnpm run build:generated
# Frontend workflows will hot-reload via Vite HMR
```

---

## 6. Post-Rollback Checklist

After any rollback, confirm ALL of the following before closing the incident:

- [ ] `/healthz` → HTTP 200
- [ ] `/healthz/full` → `status: ok` or `degraded` (not `fail`)
- [ ] Admin route without key → 401
- [ ] Admin route with key → 200
- [ ] Public catalog → 200 (no key required)
- [ ] SSRF probe → 400 (guard active)
- [ ] `pnpm test` in api-server → all tests passing
- [ ] Smoke test script (`scripts/smoke-test.sh`) exits 0

---

## 7. Escalation Contacts

| Layer | Owner | How |
|---|---|---|
| Supabase DB | DB admin | Supabase dashboard → SQL editor |
| Replit infrastructure | Replit support | replit.com/support |
| Secret rotation | Platform admin | Replit Secrets panel |
| API keys (OpenAI etc.) | Platform admin | Provider dashboards |

---

## 8. Known Safe Defaults

| Setting | Safe rollback value |
|---|---|
| `NODE_ENV` | `development` (fail-open auth) |
| `ADMIN_API_KEY` | Re-generate with `openssl rand -hex 24` |
| `SESSION_SECRET` | Re-generate; existing sessions will be invalidated |
| Rate limits (globalLimiter) | 200 req/15min (hardcoded in rateLimiter.ts) |
| DB pool size | Default pg.Pool (10 connections max) |

---

*This runbook should be reviewed and updated after every production incident.*
