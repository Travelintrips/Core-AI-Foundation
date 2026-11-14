# Issue159 GPT02 DELL provider-identity census — 2026-11-14 (DEV, read-only)

**Decision: NO_GO for real GPT02 provider admission and dispatch.** This file is an operational evidence note, not a secret, migration script, authorisation, or proof of E2E completion. Source-only Draft PR #1754; no merge/deploy/credential modification/worker send/PROD access.

## Evidence captured directly on the connected DELL device

All commands below were run for diagnosis only. No credential file content, token, provider account email, secret or private key was extracted.

| Check | Observed result | What it does *not* prove |
| --- | --- | --- |
| `openclaw --version` | `2026.10.7` | A working model sign-in |
| `openclaw status` | local gateway `ws://127.0.0.1:18789` reachable | A provider-authenticated GPT02 principal |
| `openclaw agents list` | `gpt02-dev` configured; model `openai/gpt-5.5` | Credentials loaded and usable |
| `openclaw models status --agent gpt02-dev` through the default CLI launcher | Reported runtime `missing` and 0 OAuth/token profiles from a **different CLI state directory**; see correction below | Live Gateway agent credential-store contents |
| `openclaw models auth list --agent gpt02-dev` through the default CLI launcher | Failed because launcher state directory differs from active Gateway state | Missing credentials in the actual Gateway state |
| `openclaw plugins info codex` | Codex plugin `enabled`, version `2026.10.7` | Plugin data/settings upgrade is completed |
| `openclaw update status --json` | `migrationWarnings`: Codex data/settings upgrade unfinished; retained pre-repair capture, no repair outcome | Safe to run `doctor --fix` unattended |
| `openclaw doctor --post-upgrade --json` | No findings in the five post-upgrade probes | A successful provider sign-in (warnings remain in update status) |
| `openclaw migrate plan codex --from <gpt02-dev codex-home> --agent gpt02-dev --json` | Six items: 0 planned, 6 skipped; two sensitive auth items skipped because credential inspection was not authorized; Codex app-server plugin root unavailable | Credential import or verification happened |
| `openclaw migrate plan codex --from <gpt02-dev codex-home> --agent gpt02-dev --item auth:openai --json` | `Unknown or unavailable migration item ids: "auth:openai"` without sensitive credential inspection | That `auth:openai` would never become available with an independently approved inspection |

File **existence and metadata only**: `gpt02-dev/agent/codex-home/auth.json` exists, 4,183 bytes, last modified 2026-11-13 11:41:40 UTC. The target agent's `openclaw-agent.sqlite` also exists. No credential payload was read. Therefore no conclusion about the validity, expiry or ownership of the old credential is justified.

The upstream migration documentation explicitly states that a per-agent OpenClaw runtime does **not** consume a copied `codex-home/auth.json` directly; an owner-scoped auth-store migration is a separate sensitive action. See https://docs.openclaw.ai/cli/migrate and https://docs.openclaw.ai/plugins/codex-harness-reference/auth .

## Correction — actual Gateway state readback (14 Nov 2026)

**The earlier `OAuth/token profiles = 0` observation was from the wrong state directory and is superseded.** On DELL the CLI launcher chain `openclaw.ps1 -> openclaw.cmd -> openclaw-browser-dev.cmd` sets `OPENCLAW_STATE_DIR` to `openclaw-browser-cli-state`, while the running Gateway uses `gateway-stable3-main`. The launcher overrides a caller-supplied `OPENCLAW_STATE_DIR`. The CLI reports the mismatch and refuses credential operations; this is a safety guard, not proof that the real agent has no stored credentials.

For the corrected checks, a one-shot **read-only** process invoked the installed OpenClaw Node CLI entrypoint directly, using the running Gateway's `OPENCLAW_STATE_DIR` and existing `OPENCLAW_CONFIG_PATH`. No wrapper, file or environment setting was changed persistently; no secrets were requested or printed.

| Actual Gateway-state check | Sanitized finding |
| --- | --- |
| `models auth list --agent gpt02-dev --provider openai --json` | 3 saved profiles: 2 OAuth, 1 API-key |
| Profile health | one OAuth status reported `ok` in metadata (expiry 2026-11-16), one API-key profile `setup_inactive`, one legacy OAuth profile `expired` |
| `models status --agent gpt02-dev --json` | `auth.storePath` confirms the `gpt02-dev/agent/openclaw-agent.sqlite` store |
| Runtime authentication | `runtimeAuthRoutes`: `openai` / `codex` / `status=missing` |
| Selected model | `openai/gpt-5.5`; no fallback configured |
| Exact route failure | `modelRouteIssues` lists `missing-auth` for `openai/gpt-5.5` and the utility route; required auth `api-key`; the saved API-key profile is inactive |

**Correct root-cause boundary:** stored account/profile existence is not the same as an eligible, authenticated credential for the selected model/runtime. Do not automatically rotate, import, delete or relogin because an old launcher showed 0 profiles. An OAuth profile may be shown as `ok` while the selected `openai/gpt-5.5` route still reports `missing-auth`. The actual DELL provider principal and exact model-route readiness remain unverified; the Gate MUST remain NO_GO.

**Source follow-up:** the Issue159 claim adapter has additional read-only requirements `identity.proofId === binding.proofId`, `identity.runtimeAuthStatus === "ready"`, and `identity.modelRouteReady === true`; missing/stale/unsupported route evidence fails closed. These are synthetic port-contract checks, **not** proof that a real privileged host-owned provider reader exists.

**Revised next step:** determine whether the intended GPT02 provider/model runtime should use the existing OAuth identity or a separately authorized API-key profile, without changing the model or using fallback credentials accidentally. A privileged, host-owned runtime inspector must verify the actual selected model route and authenticated principal before any claim admission. If a credential migration is indeed required, review backups/exclusive state ownership and authorize it as a separate operation; do not infer migration necessity from a file's existence alone.

## Security interpretation

1. The `trusted.loadBinding(...)` and `trusted.inspectGatewayCredential(...)` synthetic tests in PR #1754 remain useful **source-contract tests only**. They have not established an authenticated OpenAI principal on DELL.
2. A reachable gateway, configured `GPT02` alias, `credentialStatus=VERIFIED` string, a nonsecret central registry mapping, or a local `auth.json` file must **not** be promoted to authenticated provider identity.
3. The source contract's `identity.source='gateway-credential-store'` field alone is not proof that the caller is actually using a trusted host-owned reader. The future adapter needs independent provenance and a current provider-auth readback from the real owning agent.
4. Unavailable reader, missing auth, conflicting data/settings upgrade state, rotated fingerprint, stale proof or ambiguous sign-in must fail closed. No claim RPC, no dispatch, no fallback to an unrelated model/agent/credential.

## Next acceptance gates (not performed)

- An independently reviewed DELL credential-custody and compatibility remediation plan must be authorized **before** any `--include-secrets`, `migrate apply`, `doctor --fix`, `models auth activate/login`, OpenClaw update or restart. Preserve and verify the old state first; never paste tokens into GitHub or logs.
- Under that reviewed plan, establish actual `gpt02-dev` OpenAI provider authentication using official OpenClaw mechanisms, then verify the active principal in the **running** runtime without dumping secrets.
- Build or connect a host-owned **read-only** identity reader to that actual credential store and verify the exact worker, gatewayAgentId, provider, principal fingerprint and release proof lineage; exercise missing/rotated/revoked identity rejection. Do not trust just a caller-owned object.
- Separately require fresh owner/PIC/Core Super Admin approvals, an independent release trust root and four-signature verification, single-use transaction fence, exactly-once DELL transport, and a signed Final ACK with the **same command UUID**.
- Run regression CI against the exact Draft HEAD and independently review the privileged boundary before any live DEV activation. PROD remains excluded.

**Explicitly not done:** no `--include-secrets`, no credential file read, no migration, no auth refresh/login, no doctor repair, no registry refresh, no credential rotation, no service restart, no DB write, no live task/approval, no dispatch, no Final ACK, no deploy/merge/PROD modification.
