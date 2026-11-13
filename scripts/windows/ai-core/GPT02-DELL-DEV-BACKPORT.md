# GPT02 DELL DEV — canonical source backport (DRAFT / NO DEPLOY)

This change brings the existing proven GPT02 DELL DEV native transport and its direct CDP + local IndexedDB cache helpers into the **tracked canonical source tree**. It does not rebuild or replace an operational service. This is a **source review PR**, not a deployment or an authorization to merge.

## Verified evidence
The already deployed DEV GPT02 browser-wake / DELL / signed callback / acknowledged final ACK route had three distinct complete command IDs on 13 Nov 2026:
- \`41eb9f27-3ab1-4a8e-9615-3cc338428af4\`
- \`798bb8df-c380-4e00-8ec6-8bc3d176db60\`
- \`057d9f3c-f74c-4c4c-ab51-fa43a65dea69\`

One separate command \`e5e1d428-1ef1-45bb-8041-603d31ee8bf2\` remains FAILED; preserve its incident evidence. Issuer Task #166 has a separate proof-only \`NO_DISPATCH\` receipt and is **not linked to any of those three command IDs**.

## Canonical source guardrails
- Native transport from DELL was carried through using **exact LF-normalized source bytes**. Scoped \`.gitattributes\` reconstructs DELL's original Windows CRLF bytes for the Python transport and the one-shot executor. Their Windows SHA-256 and the cache JS LF SHA-256 are checked in CI. **Do not autoformat or alter their trailing newlines without updating hash pins and tests**.
- Scoped \`package.json\` sets \`type=commonjs\` only for the existing Windows native helper directory. All existing \`.mjs\` modules retain their ESM semantics. This avoids the parent \`scripts/package.json\` ESM default breaking actual CommonJS helpers on a checkout.
- The 35 existing Python native tests **retain the original test names/expectations**. The synthetic reader adapter uses the new \`_cdp_create_blank_target\` API and each test gets a private temp-dir 200-rate-log fixture. It does not touch actual ChatGPT, Supabase, production state, or OAuth.
- The local cache path verifies exact GPT02 binding, one user/assistant pair, original input SHA-256, precise challenge/ACK, message UUIDs and send timestamp; duplicate/unverified reader and replay attempts remain fail-closed.
- The legacy GET capture rate-limit circuit and history are not deleted. Do not reinterpret a local cache gate as approval to reuse a consumed issuer lease.
- No credentials, private keys, browser profile data, token files, logs, or conversation transcripts are in this PR.

## Before merge or deployment
1. Review the changes to the canonical native transport, CJS module boundary, and exact Windows hash pins.
2. Require Ubuntu **and Windows** CI on this branch. Check the full existing native and agent Python suite and synthetic malformed/replay cases. Verify no real ChatGPT/browser requests happen in CI.
3. Reconcile installed DELL tasks' binary hashes and scripted installer paths with the resulting artifact before allowing a supervised DEV deploy. Do not restart the healthy listener just to mirror GitHub.
4. An independently authorized, fresh DEV command must prove per-command callback/Final ACK after any deploy. The Task Hub/issuer to bridge-command same-ID linkage is a separate unresolved gate.
5. **PROD must not be deployed or changed** based on this PR. Leave it Draft pending explicit release review.

Historical details and source custody are recorded in PR #1723 and review-only PR #1748.
