# Production Environment Checklist

Use `pnpm readiness:env` to validate — it reports SET / MISSING / INVALID without printing values.

## Required Variables

```
NODE_ENV=production
AI_DISPATCHER_ENABLED=true
AI_SCHEDULER_ENABLED=true
ALLOWED_ORIGINS=<comma-separated domains>
PUBLIC_APP_URL=<https://your-domain.com>
SESSION_SECRET=<secret store>
ADMIN_API_KEY=<secret store>
SUPABASE_PROD_DATABASE_URL=<secret store>
SUPABASE_URL=<supabase project URL>
SUPABASE_SERVICE_ROLE_KEY=<secret store>
SUPABASE_ANON_KEY=<secret store>
SUPABASE_STORAGE_BUCKET=<supabase storage URL>
OPENAI_API_KEY=<secret store>
ANTHROPIC_API_KEY=<secret store>
GEMINI_API_KEY=<secret store>
REPLICATE_API_TOKEN=<secret store>
MISTRAL_API_KEY=<secret store>
SMTP_HOST=<smtp host>
SMTP_PORT=<465 or 587>
SMTP_USER=<smtp username>
SMTP_PASS=<secret store>
SMTP_FROM=<from address>
FONNTE_TOKEN=<secret store>
```

## Pre-Deployment Gates

1. `pnpm readiness:env` → all variables SET
2. `GET /api/healthz/full` → `{"status":"ok"}`
3. `GET /api/healthz/full` → `dispatcher.status: "running"` and `scheduler.status: "running"`
4. `pnpm security:scan-secrets` → no secrets detected
5. Full regression tests pass: `pnpm -r --if-present run test`

## Security Checklist

- [ ] All secrets set via Replit Secrets (encrypted), NOT in .replit plaintext
- [ ] ROTATION_REQUIRED.md secrets have been rotated
- [ ] .replit [userenv.*] blocks contain NO secret values
- [ ] git history scrubbed of credentials (if repo was ever public)
- [ ] ALLOWED_ORIGINS lists only production domains
- [ ] ADMIN_API_KEY is a fresh 48-char hex string (not the compromised one)
