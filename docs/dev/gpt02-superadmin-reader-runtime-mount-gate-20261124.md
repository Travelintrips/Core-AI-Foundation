# GPT02 Owner Ledger Reader — DEV deployment mount gate

## Current verified facts (24 Nov 2026)

- Core-AI DEV active SHA `94dcde3dc9c513e8c257593e0d4323a1463bc100`.
- The separate PostgreSQL reader role `gpt02_owner_ledger_reader_dev` exists in CST-DEV, can SELECT only Owner ledger data under FORCE RLS, `PASSWORD NULL`.
- `GPT02_OWNER_LEDGER_READER_ENABLED` is unset/disabled in active container.
- Root-only encrypted storage path `/etc/credstore.encrypted` exists.
- Root CA available on VPS at `/etc/gpt02-dev/supabase-root-ca-2021.crt` but is not mounted into Core-AI DEV container.
- Active Docker release script `/usr/local/sbin/cst-vps-dev-release.py` has a **historic, important** runtime issuer-reader socket mount `/run/gpt02-issuer-reader` and `--group-add 999`. The tracked file `deploy/vps-dev/cst-vps-dev-release.py` is not byte-identical. **Never overwrite the active file from tracked source directly.**
- The Nginx ledger location currently returns explicit `503 GPT02_LEDGER_READER_NOT_PROVISIONED` and rejects non-GET requests. It must not fall back to SPA HTML.
- No reader password, encrypted reader credential or operative signing/dispatch grant was created.

## Candidate mount adapter

`scripts/vps/gpt02_superadmin_reader_mount_gate.py` is an inert, **source-only** function. It does not access credential contents, set privileges, execute systemctl, or modify Docker.

If and only if `GPT02_OWNER_LEDGER_READER_ENABLED=true`, `APP_ENV=development`, `NODE_ENV!=production` and the *already-provisioned* reader file exists as a non-symlink root-owned regular file mode 0600 within a mode-0700 root-only directory, it returns two read-only mounts:

- `/run/credentials/gpt02-owner-ledger-reader/reader.json` → identical path inside the DEV-only Core-AI container
- `/etc/gpt02-dev/supabase-root-ca-2021.crt` → identical path inside the container

The existing issuer-reader socket mount and group must remain intact and independent of these new optional mounts.

## Operational custody still REQUIRED

A custodian authorized for CST-DEV must provision a unique reader password and encrypted-at-rest credential using an approved secret-management workflow. This should materialize to the exact root-protected ephemeral runtime path **without saving plaintext to persistent disk**, and mount into the container with read-only flags. A database password or service role token must not be passed through user chat, GitHub, browser or public env.

The separate signed Super Admin authentication and the existing GPT02 Owner link must both pass before any reader query. Test `200` for one genuine signed session, `401/403` negative cases, `503` for absent credentials, verify Postgres session_user/current_user equals `gpt02_owner_ledger_reader_dev`, and keep signer/dispatch OFF.

## Release gate

Before changing active DEV deployment:
1. Compare tracked release file and installed executable; preserve existing issuer-reader mount, group, release exact SHA logic, rollback and PROD protection.
2. Run 10/10 offline mount tests and existing release watcher tests.
3. Require proof of reader encrypted credential, pinned CA and role. If absent, do not set the flag and do not mount/read secret.
4. Use a single reviewed DEV-only deployment, verify exact-SHA HTTPS and POST fallback behavior. Keep Nginx 503 fail-closed until signed Super Admin reader E2E passes.
5. Do not merge this candidate as a feature activation; it is only a readiness/mount contract.

No changes to Owner decision ledger, PostgreSQL role credentials, PROD, timer, signer or dispatch.
