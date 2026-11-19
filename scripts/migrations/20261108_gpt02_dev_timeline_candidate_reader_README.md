# DEV GPT02 timeline candidate reader

Optional DEV-only read-only migration. Requires the existing reservation table, an authorized migration session with ai_core.dev_migration_authorized=true, and the aicore_dev_runtime role. Never apply in PROD.

SECURITY DEFINER function accepts review ID, job ID and parent UUID, checks corresponding Human Review identity and returns only the matching candidate UUID. It must be owned by the privileged migration owner capable of reading the reservation table under RLS. GRANT EXECUTE is scoped to aicore_dev_runtime only, without any direct table SELECT. This is not an authentication substitute: the API enforces owner/admin session and DEV host.

Do not grant command issuance, dispatch, lease, or job closing. Test in disposable PostgreSQL and review function ownership before authorized DEV deployment. Inability to access the function must display explicit unknown state.

Security preflight: the migration requires execution as the owner of the reservation table (currently postgres in live DEV), RLS enabled and not forced, and verifies aicore_dev_runtime has no direct table SELECT. The arbitrary authorized session GUC alone is not enough. STOP if ownership/RLS does not match; do not grant broad SELECT to make this run.
