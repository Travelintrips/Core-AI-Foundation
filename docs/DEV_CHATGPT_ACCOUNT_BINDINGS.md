# Additional ChatGPT account bindings in DEV

This change supplies dormant server support. It does not pair an account, change
OAuth users, activate a browser profile, alter RLS, create credentials, or verify
a live round trip. The existing GPT01 settings and worker identity remain in use.

## Configuration and ownership

The optional non-secret `guardrail` setting
`dev.chatgpt_wake.account_bindings` contains JSON with `version: 1` and `bindings`.
The safe default is `{"version":1,"bindings":[]}`. The corresponding environment
override is `AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON`. No configuration
value is inserted by this patch. Nonempty environment overrides take precedence;
an explicit `AI_CORE_DEV_BROWSER_WAKE_ENABLED=false` disables all wakes even if
the central setting is true.

Each additional entry requires all of these fields:

| Field | Constraint |
| --- | --- |
| `accountAlias` | Uppercase `GPT` plus 2–4 digits; GPT01 is reserved |
| `ownerChannel` | Exact server-derived OAuth principal/client channel |
| `targetConversationId` | Lowercase UUID of the verified target conversation |
| `workerId` | `openclaw-dell-chatgpt-wake-dev` |
| `browserProfile` | Exact OpenClaw profile; letters, digits, underscore or hyphen; 1–64 characters |
| `enabled` | Explicit boolean; false is dormant |

Aliases, owners, conversations and profiles must be unique, including disabled
entries. Profile uniqueness is case-insensitive because DELL uses Windows;
runtime matching is exact. The legacy profile `openclaw`, GPT01 alias, legacy
owner and legacy conversation cannot be redefined by additional entries.
Unknown fields and malformed or conflicting entries disable all additions while
retaining a valid GPT01 baseline. Legacy configuration must identify exactly one
owner and one conversation. Lists no longer authorize every possible pairing.

Every raw wake, REST wake, alias lookup and continuity registration/deadline uses
the same resolver. OAuth channel derivation and relay authentication are
unchanged. A confirmed raw wake can bootstrap only the configured exact pair;
aliases additionally require its signed receipt and final owner-bound MCP ACK.
Alias dispatch fences the verified worker and binding fingerprint against a
configuration change before queueing. Timers reload revocable settings; they do
not activate missing accounts or search for a fallback profile.

## Worker contract

New account commands carry `metadataJson.wakeBinding`:
`version`, `accountAlias`, `ownerChannel`, `targetConversationId`, `workerId`,
`browserProfile`, and `bindingFingerprint`. GPT01 commands keep legacy metadata
without this object. The fingerprint is SHA-256 of UTF-8 strings joined by `|`:

1. `dev-chatgpt-wake-binding/v1`
2. accountAlias
3. ownerChannel
4. targetConversationId
5. workerId
6. browserProfile

The browser instruction remains `DEV_CHATGPT_WAKE_V1` or `DEV_CHATGPT_WAKE_V2`.
For a bound account its challenge hashes the existing owner, target, event,
optional watch ID, optional job ID and optional checkpoint revision, with domain
`dev-chatgpt-assistant-attestation/v2` and the binding fingerprint as the final
pipe-separated field. Missing optional fields are empty strings.

The worker signs attestation version 2 with the existing DELL key. Its canonical
newline-separated payload uses domain `dev-chatgpt-assistant-attestation/v2`, then
the existing `keyId`, `workerId`, `conversationId`, `eventId`, `challenge`,
`assistantMessageId`, `assistantResponseHash`, and `observedAt` lines, followed by
`bindingFingerprint` and `browserProfile`, in that order. Each line after the
domain is `name=value`; there is no trailing newline. A new account cannot use a
version 1 receipt. The signed fingerprint and profile must match the persisted
command and currently enabled server configuration.

Terminal DELL completion and its response remain one transaction under the
existing worker/claim-token fence. A forged, downgraded, revoked or mismatched
successful receipt rolls back before completion or response insertion. A worker
failure can still be recorded without a successful assistant attestation. The
handshake and continuity restore revalidate the account-specific receipt rather
than treating a browser flag or queue ACK as proof.

Historical DELL progress is visible only for the authenticated command owner,
dedicated worker and bounded wake metadata. This read path does not add DELL to
the generic dispatch allowlist, grant shell access, or enable a wake.

## Activation gates

1. Review the server and matching worker PRs; require CI for their exact heads.
   Deploy only through the existing DEV release path and verify backend/gateway
   build identities. Preserve the actual DEV runtime network and rollback data.
2. Verify the target ChatGPT account through its own login and OAuth flow. Record
   its actual server-derived owner channel, conversation ID and dedicated
   OpenClaw profile. A normal Chrome profile or an installed connector without
   its own OAuth tools is insufficient browser execution evidence.
3. Prepare the DELL local configuration with an explicit legacy GPT01 tuple and
   the exact new binding. Verify profile login and isolated composer state. The
   worker upgrade has a separate legacy-config migration gate; this server patch
   does not modify that file or the existing attestation key.
4. Review and separately authorize narrowly scoped DEV database policies for the
   actual tuple. Existing DELL RLS permits only GPT01. Application guards do not
   replace a restrictive owner/target guard, and RLS alone does not prove tuple
   immutability across UPDATE. No migration or grant is included here.
5. Enable only the verified tuple and run one bounded correlated DEV test.
   Verify command ID, worker claim, exact browser destination, assistant-signed
   version 2 receipt, durable callback and final MCP ACK. Verify that the other
   OAuth owner cannot read or acknowledge the result and that GPT01 still routes
   to its original destination. Retry only the same event after reconciliation.

Offline tests and green CI are component evidence. They are not `E2E_VERIFIED`
and do not establish that the second account is connected or running.
