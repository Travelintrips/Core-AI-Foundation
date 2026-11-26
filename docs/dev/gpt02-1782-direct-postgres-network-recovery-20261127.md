# GPT02-1782 CST-DEV — direct PostgreSQL network recovery (read-only handoff)

**Status:** RELEASE HOLD / NO-GO. Source-only companion to [draft PR #1847](https://github.com/Travelintrips/Core-AI-Foundation/pull/1847). This is NOT permission to unban an IP, update a CIDR, modify credentials, start the custodian, open Nginx, or change a database role.

## Verified evidence from 26 Nov 2026 17:07–17:12 UTC

- PostgreSQL project ref `xssrfshdrtdfupgqwfdw`, `ACTIVE_HEALTHY` via management. Only **CST-DEV** is in scope.
- On approved Hostinger VPS `srv1792369`, the direct host `db.xssrfshdrtdfupgqwfdw.supabase.co:5432` resolves to native IPv6. An unauthenticated one-shot TCP/PostgreSQL STARTTLS connection failed **before TLS/authentication** with `ECONNREFUSED` (`errno=111`).
- VPS IPv6 is functional (credential-free `curl -6` public HTTPS 200) and independently observed outward-facing IPv6 is **`2a02:4780:59:69cb::1`**. Treat this as a *candidate* for exact-match IP-ban inspection, not proof the IP is banned.
- The shared Supavisor session pooler endpoint `aws-0-ap-southeast-2.pooler.supabase.com:5432` passed external TCP+TLS certificate/hostname verification using the already-installed Supabase 2021 root CA. **It did not prove PostgreSQL authentication**.
- CST-DEV read-only `pg_stat_activity JOIN pg_stat_ssl`: 11 active `Supavisor` sessions and 5 `Supavisor (auth_query)` sessions had `ssl=false` on their **backend PostgreSQL connection**. The existing dedicated GPT02 DBA custodian explicitly requires `pg_stat_ssl.ssl = true`; client-to-Supavisor TLS alone is insufficient. Do **not** delete or bypass this assertion.
- Dedicated `gpt02_owner_ledger_reader_1782_dev` role remains expired (`rolvaliduntil=2026-11-26T16:36:51Z`), `CONNLIMIT=1`, non-superuser/non-BYPASSRLS, 0 active sessions.
- Last Nginx safety baseline: public Owner Ledger HTTP **503** with exact active site SHA256 `e34dde83f676dec15d27b56241b830cbffe7cb3ba0b07e6699f011d48fb651ed`; no new gate-opening or reader lease was performed.

## Authorized DBA / Supabase administrator investigation

Perform **only read-only inspection** before considering any change:

1. Open the **CST-DEV** project (never Sport Center PROD) in Supabase Dashboard, then Database Settings → **Network Bans / Unban IP**. Examine the ban list for the **exact VPS IPv6 `2a02:4780:59:69cb::1`** (plus only the observed actual egress IP if it differs). Supabase documents temporary Fail2ban blocks after repeated bad login attempts as a potential explanation for `Connection refused`. A refused port **does not** by itself prove a ban.
2. Inspect **Network Restrictions** and effective IPv6 CIDRs, including pending configurations. Confirm whether the observed IPv6 source is allowed. Do not replace restrictions with `::/0` or `0.0.0.0/0` and do not alter PROD. An IP-ban removal or CIDR change requires a new authorized DBA/Supabase operator action with an explicit Owner approval for the exact scope.
3. If no ban/restriction explains the symptom, inspect Supabase direct-5432 health and Hostinger IPv6 egress/firewall with authorized platform support. Do not reset passwords, rotate database roles, or repeatedly attempt failed PostgreSQL logins.
4. **After authorized remediation**, run one credential-free connection check from the VPS, without any reader activation:
   ```bash
   getent ahostsv6 db.xssrfshdrtdfupgqwfdw.supabase.co
   ip -6 route get 2406:da1c:4c7:f801:bcbd:3b1e:62b7:afd6
   timeout 7 openssl s_client -starttls postgres \
     -connect db.xssrfshdrtdfupgqwfdw.supabase.co:5432 \
     -servername db.xssrfshdrtdfupgqwfdw.supabase.co \
     -CAfile /etc/gpt02-dev/supabase-root-ca-2021.crt \
     -verify_hostname db.xssrfshdrtdfupgqwfdw.supabase.co -brief </dev/null
   ```
   Re-resolve address first; the `ip -6 route get` literal above is diagnostic for the address observed on 26 Nov, not a permanent pinned address. Claim transport PASS only if TLS negotiation and certificate/hostname verification succeed.

### Operational resumption — separate fresh one-use authorization required

After direct transport PASS and explicit Owner authorization: independently verify a fresh worker attestation; renew the **dedicated** reader for a bounded lease; issue the genuine DBA custodian receipt only after the existing read-only role, SSL, RLS/privilege and lease checks PASS. The *source-only* `scripts/vps/gpt02_reader_login_readonly.py` requires a separately authorized root-controlled installation in place of the existing `/root/gpt02-1782-recovery/reader-login-readonly.py`; its synthetic no-secret tests run in CI. Never copy, print or reset the reader password through an assistant.

Only once all custody, operator readiness, safe independent ≤90-second rollback and live fresh signed Owner browser are prepared should the one-shot Nginx negative E2E be considered. It must record genuine signed alternate-challenge HTTP404 JSON/no-store, then restore exact baseline HTTP503 and expire reader. No Task190, PROD, Phase B, RLS, signing or dispatch changes.

## Sources

- [Supabase: Error "Connection refused" / network bans](https://supabase.com/kb/troubleshooting/error-connection-refused-when-trying-to-connect-to-supabase-database-hwG0Dr)
- [Supabase: Network Restrictions](https://supabase.com/docs/guides/platform/network-restrictions)
- [Supabase: PostgreSQL connection modes and strict TLS](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Issue #1782](https://github.com/Travelintrips/Core-AI-Foundation/issues/1782)
