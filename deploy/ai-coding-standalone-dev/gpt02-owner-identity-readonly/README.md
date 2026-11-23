# GPT02 CST-DEV Owner identity-link readiness service

This is a standalone **GET-only** identity verifier bound to loopback `127.0.0.1:18509`.
It restores only the existing Nginx read-only Owner-link endpoint:

`GET /api/ai-tasks/183/gpt02-owner-identity-readiness?companyId=default`

The service does exactly two checks:

1. It passes the supplied bearer token to the existing CST Hub API on `127.0.0.1:18499` and requires that API's signed-session middleware report a fresh, read-only Google Super Admin session.
2. It passes only the verified JWT claims to the existing root-owned `task183-owner-identity-readiness.py` reader. That reader opens the pinned `/opt/ai-coding-standalone-dev/tasks.db` in SQLite `mode=ro`, sets `PRAGMA query_only=ON`, and matches the exact enabled Google operator, email, Supabase Auth user ID, active `super_admin` identity, and Owner link.

It does not reuse or expose any Task #183 approval decision, nonce, consent, signature, signer, issuer, release marker, or dispatch state. It has no write method or approval route. POST/PUT/PATCH/DELETE/OPTIONS return 405. Unknown paths return 404. Responses are `no-store`; bearer tokens and actor claims are never logged.

## DEV installation

Install `api.py` as root:root mode `0400` at:

`/opt/ai-coding-standalone-dev/qa/gpt02-owner-identity-readonly-api.py`

Install `identity-readonly.service` as:

`/etc/systemd/system/gpt02-owner-identity-readonly.service`

Then validate with `systemd-analyze verify` and start the service. Do **not** enable it at boot as part of the initial DEV test; it is currently started manually and not enabled. The existing Nginx location already proxies this exact endpoint to `127.0.0.1:18509`, but a global Task183 GPT02 `410` guard also matched the path. The DEV vhost now exempts only this exact identity-readiness URI using a negative-lookahead allowlist; its location still permits GET only. The corresponding one-line guard change is documented in `deploy/nginx/dev-ai-task-gpt02-owner-identity-guard.patch`. Sibling GPT02 Task183 APIs remain `410`; no approval, preparation, or dispatch route was exposed.

## Verification

Run `python3 test_api.py` for synthetic HTTP boundary checks. The separate existing identity reader test verifies the exact operator-link policy using a synthetic temporary database. Live service testing without a bearer must return 401; an invalid token must return 403; the real Owner session is only tested from the authenticated UI/Core-AI path.

The service process is loopback-only, `ProtectSystem=strict`, `IPAddressDeny=any` with `IPAddressAllow=localhost`, has no Linux capabilities, and has no writable database or credential path.
