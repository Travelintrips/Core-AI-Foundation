# DEV DELL ChatGPT account bindings

The dedicated DELL executor's binding protocol separates ChatGPT accounts while retaining the existing worker ID and Ed25519 key. Each new account requires one exact binding of its AI Core OAuth owner channel, ChatGPT conversation, worker and OpenClaw browser profile. The optional native transport uses Windows UI Automation for input and the supported OpenClaw response observer for assistant identity. It is disabled unless the exact local binding and its native transport are explicitly enabled. This change does not install code, authorize another account, change local configuration or establish an E2E PASS. Runtime activation still requires the live gates below.

The server must supply the matching `metadata.wakeBinding` protocol before a new account can be dispatched. GPT01 retains its v1 server metadata and signature format. The upgraded worker requires an explicit local GPT01 tuple for every already-authorized owner, so prepare those tuples before upgrading the running executor.

## Local registry

The existing file remains `%LOCALAPPDATA%\AI-Core\dell-chatgpt-wake-allowlist.json`. The following is an **inactive schema template**, with placeholders that must be replaced using verified account and conversation evidence. It is not a ready-to-install replacement for an existing file.

```json
{
  "enabled": false,
  "allowedConversationIds": ["<existing-gpt01-lowercase-uuid>"],
  "legacyBinding": {
    "version": 1,
    "accountAlias": "GPT01",
    "ownerChannel": "ai-engine-oauth:<existing-gpt01-lowercase-sha256>",
    "targetConversationId": "<existing-gpt01-lowercase-uuid>",
    "workerId": "openclaw-dell-chatgpt-wake-dev",
    "browserProfile": "openclaw",
    "enabled": false
  },
  "bindings": [
    {
      "version": 1,
      "accountAlias": "GPT02",
      "ownerChannel": "ai-engine-oauth:<verified-second-account-lowercase-sha256>",
      "targetConversationId": "<verified-second-account-lowercase-uuid>",
      "workerId": "openclaw-dell-chatgpt-wake-dev",
      "browserProfile": "<verified-openclaw-profile>",
      "enabled": false,
      "nativeTransport": {
        "version": 1,
        "enabled": false,
        "composerName": "Ask ChatGPT",
        "allowProviderLf": false
      }
    }
  ]
}
```

The global `enabled` value and the selected entry's `enabled` value must both be `true`. Each entry must contain a Boolean `enabled` field. A legacy conversation list by itself never authorizes the upgraded DELL worker. If `legacyBinding` is present, `allowedConversationIds` must contain exactly its conversation; the legacy alias and profile must remain `GPT01` and `openclaw`.

When the existing GPT01 destination has several authorized owner channels, replace the singular `legacyBinding` field with a nonempty `legacyBindings` array of those exact tuples. Both fields together are rejected. Each tuple keeps alias `GPT01`, worker `openclaw-dell-chatgpt-wake-dev`, profile `openclaw` and the same single conversation in `allowedConversationIds`; only its exact owner channel and Boolean enabled state differ. Preserve every verified existing owner during migration. This does not authorize extra conversations or combinations of owners and targets. Revoking one tuple does not revoke the others.

The registry validates all entries before selecting one, including disabled entries. Owner channels must be unique everywhere. Repeated aliases, conversations and profiles are permitted only within the validated legacy group above; an additional account cannot collide with that destination or any legacy owner. Profile conflicts are checked without case to avoid collisions on Windows; command selection still requires the exact configured case. The worker ID can be shared because one existing executor processes claims sequentially. Do not start a second consumer using that worker ID.

Additional aliases match `GPT[0-9]{2,4}` in uppercase and cannot be `GPT01`. Owner channels contain the `ai-engine-oauth:` prefix followed by 64 lowercase hex digits; conversation IDs are lowercase UUIDs. Profile names match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. A native Chrome profile label is not sufficient evidence of the OpenClaw profile that the worker controls.

An optional `bindingFingerprint` in a local entry must equal the computed fingerprint. A fingerprint is required in the server command. Neither the worker nor helper falls back to another profile, another conversation or the legacy list when a binding is missing, malformed, disabled or mismatched.

## Coordinated activation sequence

1. Record every currently verified GPT01 owner, its single conversation and `openclaw` profile. Prepare `legacyBinding` for one owner or `legacyBindings` for several owners, using every exact existing owner and keeping the legacy conversation list unchanged. An authorized runtime configuration change is required before replacing the worker; deploying code alone will otherwise reject legacy work. A dormant new-account entry must not remove an existing owner.
2. Verify the second account through its supported login and AI Core OAuth connection. Obtain its actual owner channel, exact destination conversation and separately authenticated OpenClaw profile. Keep its new registry entry disabled until these agree with the server's authorized mapping. An email address or an account visible in an unrelated Chrome profile does not establish this mapping.
3. Review and apply the corresponding server and worker changes through the normal DEV workflow. Preserve the existing worker identity, scoped credential and attestation key. Any live authorization or security configuration change follows the applicable approval gate in `AGENTS.md` and the communication SOP.
4. Review and verify the native transport before enabling it. A selected binding without `nativeTransport.enabled: true` fails before browser access, key reads or receipt writes. The transport configuration also requires `version: 1` and the actual exact composer name; `allowProviderLf` is a Boolean, false by default. Unknown options fail closed. The helper rereads this configuration before native operations and after response validation, so revocation prevents signing. Confirm exactly one matching conversation tab, the managed profile's current PID/data directory and idle generation state; apply the native draft and reader gates below.
5. Verify GPT01 regression and the new-account round trip independently. Require the observed assistant message, a valid signature for the expected binding, the server's accepted callback and the durable continuation ACK. Component tests and a visible echo marker alone cannot establish E2E PASS.

Rollback disables the new binding and restores the reviewed prior worker version/configuration as a coordinated operation. Do not broaden an allowlist or switch profiles to make a rejected command run.

The bound lease release must install all seven runtime files from one verified merged source: `dell-wake-executor.mjs`, `dev-chatgpt-wake-once.py`, `dev_chatgpt_native_lease.py`, `dev_chatgpt_native_transport.py`, `dev_chatgpt_native_reader.py`, `dev-chatgpt-native-composer.psm1` and `dev-chatgpt-native-bridge.ps1`. Stage and hash-check that complete set before stopping the existing worker, verify its queue is drained after stopping, and replace the set under the maintenance/native locks with a verified rollback. Preserve existing registry bytes, task, credentials and key during a runtime-only update; never start a second consumer with the same worker identity.

## Command and signature protocol

For a new account the command metadata contains:

```text
wakeBinding = {
  version: 1, accountAlias, ownerChannel, targetConversationId,
  workerId, browserProfile, bindingFingerprint
}
```

Other metadata must identify the dedicated worker and exactly match the instruction's conversation, event and challenge. It must include `capability: "chatgpt:wake"`, `source: "authorized-dev-browser-wake"`, `explicitWorkerTarget: true`, and `devOnly: true`. The owner channel remains in `metadata.conversationId`; the actual ChatGPT UUID is in `metadata.targetConversationId`.

The executor validates the local tuple before starting Python and passes the binding metadata with the selected profile. For a bound account it removes `metadata.claimToken` and the scoped HTTP bearer from the child environment; the authenticated Node worker alone uses those credentials for claim renewal and result delivery. Python independently reads the registry, checks the tuple and recomputes the challenge before accessing the browser. Missing `wakeBinding` is accepted only for the explicit legacy tuple. A present but invalid `wakeBinding` cannot use that compatibility path.

The fingerprint is SHA256 over UTF-8 fields joined with `|`, in this exact order:

```text
dev-chatgpt-wake-binding/v1
accountAlias
ownerChannel
targetConversationId
workerId
browserProfile
```

For bound accounts, the challenge is SHA256 over these UTF-8 fields joined with `|`:

```text
dev-chatgpt-assistant-attestation/v2
ownerChannel
targetConversationId
eventId
watchCommandId or empty string
jobId or empty string
checkpointRevision decimal string or empty string
bindingFingerprint
```

A continuity context requires all three watch fields together: UUID watch ID, UUID job ID and positive safe-integer revision. Watch and job IDs are normalized to lowercase. A legacy challenge retains the v1 domain and excludes the fingerprint. Instruction `DEV_CHATGPT_WAKE_V1` or `V2` controls whether task text is included; it does not select the attestation version.

New-account attestations use `version: 2` and the existing Ed25519 key. The signature covers this newline-separated payload without a trailing newline:

```text
dev-chatgpt-assistant-attestation/v2
keyId=<key ID>
workerId=<worker ID>
conversationId=<target ChatGPT UUID>
eventId=<event hash>
challenge=<challenge hash>
assistantMessageId=<observed assistant UUID>
assistantResponseHash=<SHA256 of observed assistant text>
observedAt=<UTC timestamp>
bindingFingerprint=<binding hash>
browserProfile=<exact selected profile>
```

GPT01 continues to sign the v1 domain and original fields only. Bound receipts are stored as `<bindingFingerprint>-<eventId>.json` in `chatgpt-wake-dev-receipts`; existing legacy receipt names remain `<eventId>.json`. Receipt context must match before reconciliation. An ambiguous submission is not replayed; an already visible marker is reconciled with the assistant response instead.

The executor checks the helper's returned context and signature envelope; the server performs cryptographic verification before accepting completion. Changing the profile, owner, target or fingerprint changes the bound challenge or signed payload and cannot reuse an accepted proof from another binding.

### Bound command lease and process lifetime

Bound accounts use an asynchronous Node child process and the helper argument `--bound-lease-v1`. GPT01 retains its existing synchronous helper, 180-second cap and legacy input protocol. Before spawning a bound helper, the worker verifies renewal of the exact claimed command through the existing `/ai/agent-runtime/work/:commandId/renew` endpoint using its worker ID and claim token. The server claim remains 300 seconds. The worker requests another renewal 60 seconds after each successful renewal response; a transient failure retries after at most 5 seconds while the previous acknowledged lease is still usable. Authentication failure, revocation or an unconfirmed renewal stops ownership.

Each local grant expires 275 seconds after the renewal HTTP request started: the 300-second server lease minus a 25-second safety margin. HTTP latency therefore consumes usable time. Expiry is latched locally and cannot be reversed by a late `renewed: true` response; the existing server renewal query alone does not supply that fence. A separate timer supervises expiry while HTTP requests or the helper are pending.

The initial bounded JSONL envelope contains `protocol: "ai-core-native-lease/v1"`, command ID, instruction, worker ID, binding metadata, `maxRunMs: 1980000` and a sequence-zero lease grant. Subsequent grants name the same command and carry strictly consecutive sequence numbers, `issuedAtUtcMs` and `validForMs`; explicit revocation is also terminal. The Python reader rejects malformed frames, unexpected fields, a wrong command, nonconsecutive sequence, future timestamps and frame age over 5 seconds. It subtracts frame age before setting its own monotonic deadline, checks wall/monotonic clock drift at grant acceptance, and never compares unrelated process-monotonic clock origins. Parent-pipe EOF also terminates the bound operation. The fixed helper total is independent of all renewal grants.

Before creating any subprocess, `dev_chatgpt_native_lease.py` puts the Python helper itself in a private Windows Job Object with `KILL_ON_JOB_CLOSE` and no breakaway flags. The handle is not inherited, while subprocess membership follows the Windows job rules; the already-running browser is never assigned to this job. If containment cannot be established, the helper fails before browser operations. Node cancels the exact spawned process handle; no PID-tree search or `taskkill` fallback is used. Python's concurrent control reader and watchdog also stop the job on parent loss, lease failure or total expiry. On normal completion, Python flushes the complete final JSON before process exit closes the private job handle and terminates remaining descendants. The stdin writer stays with Node; subprocesses receive no inherited lease-control writer.

The native bridge receives a finite `leaseExpiresTickCount64` snapshot based on Windows `GetTickCount64`, and checks it before input, Invoke and reader navigation. A renewal does not extend an already-running bridge action's snapshot. Registry authorization and the current helper lease are rechecked at operation boundaries, before key access and before signing. Native input and reader markers retain uncertain attempts; neither expiry nor a restarted worker authorizes replay.

The executor requires the helper's `close` event and complete bounded UTF-8 output, not an early JSON prefix. Output overflow, encoding failure and stream errors remain failures even if the process already exited. If process/stream termination cannot be confirmed within the additional 5-second drain bound, the worker preserves reconciliation and stops claiming work.

Renewal continues after helper exit while the same result is being delivered. Up to eight result attempts use the existing bounded backoff; they never rerun the helper. A successful HTTP status alone is insufficient: the response must identify the same command, terminal status and durable response UUID, matching worker/checkpoint fields, consistent evidence codes and every submitted detail, including exact assistant text and attestation. The response message must match the route's trimmed message, while the signed text in details remains unchanged. A matching committed response can resolve a concurrent renewal 409 caused by that result transaction; malformed or unrelated 2xx responses cannot. Unconfirmed delivery stops the worker loop and leaves evidence for reconciliation.

The existing presence heartbeat runs after a verified grant has been written, with `activeJobs: 1` and `availableSlots: 0`, and continues while result delivery is pending. It has a separate bounded HTTP request, cannot overlap another presence pulse and cannot extend command ownership or delay the lease watchdog. The next ordinary idle heartbeat clears those busy details. Presence has its own 90-second lease; the 60-second renewal cadence plus worst-case HTTP latency can still cause a temporary presence lapse. Presence success therefore does not establish continuous worker eligibility or command ownership.

## Component validation and browser limits

```sh
node --check scripts/dev/dell-wake-executor.mjs
node scripts/dev/test-dell-wake-executor.mjs
python -m py_compile scripts/windows/ai-core/dev-chatgpt-wake-once.py scripts/windows/ai-core/dev_chatgpt_native_reader.py scripts/windows/ai-core/dev_chatgpt_native_transport.py scripts/windows/ai-core/dev_chatgpt_native_lease.py
python -m unittest discover -s scripts/windows/ai-core -p 'test_dev_chatgpt_*.py' -v
# Windows, synthetic UI functions only:
powershell -NoProfile -File scripts/windows/ai-core/test-dev-chatgpt-native-composer.ps1
```

Python tests require `cryptography`; the dedicated component workflow installs a pinned version in a temporary virtual environment. Tests use fake browser state and ephemeral keys, exercise the actual signature payload and cross-language vectors, and reject tuple conflicts, profile changes, forged envelopes and duplicate submissions. Native tests cover the opt-in gate, exact transcript validation, original timestamps, context drift and revocation. Synthetic signature and transport fixtures are not captured account evidence. The Windows component job replaces native UI functions before invoking the module. The workflow has `contents: read` permission and performs no deployment or live account access.

The browser parser recognizes exactly one accessibility `textbox` named `Ask ChatGPT` or `Tanya ChatGPT`. Other names or roles, multiple recognized composers and malformed draft state fail before typing. The Indonesian name has been observed in native Chrome UI; the tests use synthetic snapshot rows, not a captured OpenClaw snapshot. English GPT01 uses the same pairing, draft and duplicate-delivery checks as before.

Stop-button recognition still covers English `Stop` / `Stop generating` only. Before activating any new profile, inspect its actual OpenClaw snapshot and verify both idle and active-generation state, draft preservation and the expected assistant-response identity. A native-browser screenshot or synthetic localized fixture does not prove this integration or an assistant reply. Unsupported snapshot shapes remain an activation blocker; do not add an arbitrary textbox fallback or enable the worker on name recognition alone.


### Live managed-profile activation blockers (2026-10-20)

Live OpenClaw inspection of the managed `travelincars-dev` profile reported this composer fragment:

```text
- textbox "Ask ChatGPT" [active] [ref=f13e409]:
  - paragraph: Ask ChatGPT
```

This is an observed fragment, separate from the synthetic locale fixtures. The parser recognizes `eN` and frame-scoped `fNeN` references but rejects this fragment before typing because it does not provide a draft value. A paragraph matching the placeholder does not prove that the draft is empty. Missing values remain unknown, and a whitespace-only value remains a draft. Widening the reference pattern alone or clearing a draft is not an activation fix.

Pinned OpenClaw v2026.9.9 supports `snapshot --format aria` with browser-level `--json`, but its [ARIA formatter](https://github.com/openclaw/openclaw/blob/bcfc88812a35243893585dbeca87ca41b48272ca/extensions/browser/src/browser/cdp.ts) omits the value field both for an empty string and for an unavailable value. Its native `axN` references identify nodes; they do not resolve that ambiguity. A supported read must establish the exact draft value and target identity before automated submission can be enabled.

The legacy `_assistant_probe()` invokes `browser evaluate --fn` to obtain the assistant message UUID and text. This conflicts with the [communication SOP](SOP_AI_CORE_CHATGPT_OPENCLAW_COMMUNICATION.md) restriction on JavaScript snippets in the ChatGPT page. GPT02 uses only `NativeTransport`; it cannot enter the legacy attestation loop or fall back to the page-script probe. Direct legacy probing on a non-`openclaw` DELL profile is rejected. The existing GPT01 implementation and live configuration are not activated or changed by this PR. Visible ACK text alone cannot replace the signed proof.

### Windows native composer

`scripts/windows/ai-core/dev-chatgpt-native-composer.psm1` performs no action when imported. The fixed-action bridge accepts JSON data on stdin; it never evaluates command text. The Python transport validates normal OpenClaw `status` and `tabs` output for the exact profile, current PID, managed user-data directory and one target page. These commands run serially: actual same-profile concurrent calls took approximately 36 seconds and produced an unusable inventory projection; that measurement did not retain the envelope keys and does not establish that the actual inventory was empty. Subsequent sequential calls returned the verified inventory. Mutations also remain sequential. It explicitly focuses the exact raw target with the supported OpenClaw command, checks the profile again, then resolves the native window. The native resolver searches only top-level windows of that PID and requires one visible window whose address matches the known conversation. The same target is rechecked before native operations. Account login and the local owner mapping still require independent verification at activation.

The component checks the supplied window's PID and one visible, enabled, non-password edit control named `Ask ChatGPT` or `Tanya ChatGPT`. The independent OpenClaw page URL must be exactly `https://chatgpt.com/c/<target UUID>`. The native address provider may return precisely that string or the observed scheme-elided `chatgpt.com/c/<target UUID>`; HTTP, another host/target, query, fragment, trailing slash or other normalization is rejected. It uses `ValuePattern.ValueProperty` with `ignoreDefaultValue: true`; an unsupported or non-string value is rejected. Other nonempty drafts, including whitespace, are preserved before input. The observed provider value `Ask ChatGPT\n` is treated as placeholder-shaped **unknown**, not empty. In that one shape the component appends without clearing. If it represents real text, the combined draft fails the exact readback check and remains for reconciliation; it is never sent or automatically erased.

Input follows the observed native recipe: set composer focus, verify the foreground window and keyboard focus, use `Ctrl+End` to collapse selection at the end, then insert a literal message. It rechecks native target and focus before each keyboard action. The initial supported message set is bounded printable ASCII. [Microsoft's documented SendKeys escaping](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.sendkeys) protects reserved characters, including the wake protocol's square brackets. Control characters and unsupported text are rejected before input. Two fresh complete draft reads must match the intended message exactly before one native `Send` button's `InvokePattern` is used. A single provider LF may be accepted only through an explicit policy supplied before insertion; it is disabled by default. No general trimming, `Ctrl+A`, clearing, clipboard substitution, Enter-to-send or alternate-button fallback exists.

An exclusive `<bindingFingerprint>-<eventId>.native-input.json` marker is persisted and flushed to disk before the first input attempt and before Invoke. It records `inputStartedAt` and `sendAttemptedAt` epoch seconds with the exact owner, profile, raw tab, conversation, event, challenge and message hash. The original timestamp is mandatory during reconciliation; a missing or mismatched marker cannot be replaced with a new timestamp. Unknown insertion or Invoke outcomes leave the marker in place, preventing replay. It contains no raw draft/message text. `SEND_INVOKED` and `sendInvoked: true` mean only that the native call returned. Delivery and assistant verification remain false until independently observed. [SendWait itself does not reliably wait for another process to finish handling input](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.sendkeys.sendwait); exact fresh readback is the gate. A Windows byte lock prevents simultaneous native UI transactions by this worker.

### Native assistant identity reader

The pinned OpenClaw CLI exposes `requests` and `responsebody` for managed profiles. The transport selects a successful GET already observed for the exact target conversation, retaining its full URL and query. It never constructs an endpoint, clears the request history, replays the request, exports headers or uses page evaluation. It starts the CLI through the verified portable `node.exe` and `openclaw.mjs` paths with direct argv, so `&` in a query cannot become shell syntax.

`responsebody` observes the next matching response. The capture uses one newly owned `about:blank` reader, leaving the original conversation and its draft intact. Before the supported `open about:blank` command, the transport exclusively creates and flushes `<bindingFingerprint>-<eventId>.native-reader.json` with `OPEN_ATTEMPTING`, the original Send timestamp, binding, message hash, observed request URL and complete preopen raw-ID inventory. The returned raw ID must be new and is persisted before further actions. A missing or ambiguous open result leaves the marker in place and never permits another open. Any existing reader marker blocks the entire automatic retry before browser actions; a prior marker cannot authorize duplicate-tab exclusion.

The supported exact-ID focus command selects the new reader. A fresh profile inventory must identify it as the sole `about:blank` page. The native bridge requires the exact PID, HWND and observed window title `about:blank - Google Chrome`; the address provider must explicitly return `about:blank`. Read-only resolution may start with the browser in the background. It then focuses the native address bar, checks foreground and keyboard focus, and uses writable `ValuePattern.SetValue` to stage only the original full HTTPS conversation URL. An immediate native check before one Enter requires the same blank window title, PID, HWND, focused address bar and exact staged URL. The window title still identifies the blank document while the omnibox contains the new URL; generic visible UIA Document nodes are unsuitable because actual Chrome observations included background documents. `NAVIGATION_ATTEMPTING` is flushed before SetValue, and any uncertain SetValue or Enter outcome remains unreplayable.

The response listener is bound to that reader's exact raw ID and the successful GET URL observed in the original tab. The [pinned response route](https://github.com/openclaw/openclaw/blob/bcfc88812a35243893585dbeca87ca41b48272ca/extensions/browser/src/browser/routes/agent.act.ts) resolves its current tab URL after receiving the response, allowing the strict parser to require the original conversation URL in the reader envelope. The pure parser retains all original user/final-assistant, timestamp, current-node and exact-text checks. Returned dispatch identity and signing evidence retain the original raw tab and original `sendAttemptedAt`; `captureRawTargetId` separately identifies the reader. Account revocation is checked before native navigation, during final proof and before signing.

The transport now has a fixed 1,950-second total deadline and the executor caps the bound helper at 1,980 seconds. The existing 300-second command lease is renewed as described above; those renewals never extend either total. Actual sequential DELL measurements on 2026-10-20 were approximately 24 seconds for `status` and 22 seconds for `tabs`, with only about 0.2 seconds between complete JSON and process exit. The previous short envelope could not accommodate that startup cost.

The source budgets each remaining phase before an irreversible step:

| Phase or gate | Bound |
| --- | --- |
| Ordinary OpenClaw command | 75 seconds, with CLI `--timeout 60000` |
| Native resolve or navigation | 45 seconds, also bounded by its lease snapshot |
| Native submission, `S` | `min(240, max(60, ceil((30 + 0.051 * messageLength) / 5) * 5))` seconds |
| Assistant readiness, including its first snapshot and further polls | 120 seconds total |
| Listener startup lead | 25 seconds |
| Response capture after navigation | At most 90 seconds, leaving the final-proof reserve |
| Before Send | At least `S + 1195` seconds remaining |
| After the pre-open profile guard, before reader open | At least 850 seconds remaining |
| Before reader navigation | At least 480 seconds remaining |
| Final original snapshot, focus, status, tabs and native resolution | 345 seconds reserved |

The native submission formula is a conservative policy allowance informed by the measured 38 seconds for a 1,126-character owner input, not an input-success guarantee. Input remains restricted to at most 4,096 printable ASCII characters. Insufficient total time, lease time, phase time or native identity proof fails closed and preserves the attempt.

The listener's CLI event timeout is 180 seconds, with an outer CLI timeout of 210 seconds; the transport's own lead, navigation, capture and total limits remain authoritative. The pinned command has **no listener-registration acknowledgment**. The 25-second lead only mitigates startup delay. The original sole-blank inventory proof retains a strict 30-second age limit measured from completion of the actual `tabs` read, including native resolution and listener startup time. A later UIA check cannot re-date that earlier raw-ID proof. No extra same-profile OpenClaw command is issued while the listener waits; native identity, foreground, address-focus and lease checks still run immediately before navigation. A delayed listener or stale inventory fails without a second navigation, and a startup delay exceeding the freshness allowance remains an availability limitation.

The original F5 adapter remains strict: only an actual empty ValuePattern string permits refresh. Both ValuePattern and TextPattern were observed returning `Ask ChatGPT` plus LF on the target account, so neither supplies that proof. The owned-reader route never invokes F5 and never closes a tab. It requires final original focus and the same original native window, then marks `CAPTURE_VERIFIED` while retaining `PRESERVED_RECONCILIATION_REQUIRED`. An authentication wall, changed conversation, missing reader or any unowned duplicate blocks proof and preserves all tabs.

The pure validator checks exact raw tab ID, HTTPS page URL, observed response URL, HTTP 200 and an untruncated bounded body. It accepts only the observed `conversation_id`, `messages`, `current_node` schema. The unique latest user message must exactly equal the sent prompt and contain the event/challenge markers once. The final assistant must follow that user, have role `assistant`, channel `final`, recipient `all`, status `finished_successfully`, `end_turn: true`, one string text part and the actual UUID in `current_node`. Hidden, malformed, stale, ambiguous or incomplete candidates fail. Only user text and explicit final assistant text are inspected for markers; analysis/tool content and arbitrary metadata text are never evidence.

The timestamps must satisfy `sendAttemptedAt <= user.create_time <= final.create_time <= captured_at`, without a clock-skew allowance. The visible snapshot must also contain the exact sent prompt and an ACK beyond the one quoted in that prompt. A single ACK in the user's instruction does not establish an assistant reply. The validator rejects text over 4,000 UTF-16 code units and hashes the exact UTF-8 text without trimming. The helper signs only after this validation and a fresh binding/activation check. The executor checks the returned exact text against its signed hash and preserves it unchanged for bound replies.

All raw subprocess response output and headers remain in memory and are discarded after projection; errors expose fixed diagnostics. Only correlated final text, actual message UUID, digest and signed receipt reach the callback. A valid local proof still requires the server to accept and persist the callback and continuation ACK before E2E can pass.

### Evidence limits

The Windows tests cover literal key encoding, invalid payloads, exact readback, draft preservation, focus/context drift, ambiguous Send, an adopted provider terminator and one-attempt behavior with native operations replaced. A 16-case earlier module snapshot passed on actual Windows PowerShell 5.1 with native functions mocked; that does not validate later source revisions or a live input operation. The controlled native UI send and passive response capture observed during preparation prove individual capabilities, not this worker integration or a signed new-account round trip. Accessibility refs, runtime IDs and conversation UUIDs are not assistant message UUIDs.

At 2026-10-20 14:30:06.146 UTC, the five actual Windows process-containment checks passed for lease module SHA256 `91a411f3283830497816efcfce93888b3e6a1c441f141962776fb86aaf9dfe3e` and helper SHA256 `8f23a718c52cfb44f6533855765de61b917c4f794cf318a146b25185b70c286c`. They exercised parent loss/EOF, expiry and normal final-output teardown, confirming owned descendants ended while the unrelated control process survived. This is **5/5 containment evidence only**.

At 2026-10-20 14:34:44.5199805 UTC, the final DELL component run reported PASS with source hashes verified: **28 Node cases** on actual portable Node v26.11.1, exit code 0, and **39 native component cases** on Windows PowerShell 5.1.26100.9711 Desktop. Native UI functions were mocked; `browserTouched` and `realE2e` were both false. These component and containment results do not establish an actual assistant reply, server callback or E2E continuation ACK.

Earlier temporary reader experiments were not adopted: one stopped when the address representation changed and another encountered a Google sign-in destination. The bounded owned-reader followup requires its own live proof of native blank identity, exact address SetValue/Enter and a successful correlated response capture. A source test or an account tuple alone cannot satisfy that gate.

The retained reader is an explicit operational limitation. Only the reader created by the current invocation is excluded from original-tab uniqueness. A later job sees that retained conversation tab as an unowned duplicate and stops until safe reconciliation has been performed. A loaded reader can contain user draft text even when its URL is unchanged, and placeholder-shaped UNKNOWN cannot authorize closing it. This followup therefore supports a reviewable single capture; it does not claim unattended continuous operation or silently clean up preserved tabs. A future lifecycle change needs separate evidence and review.

The exact source head, Windows component gate, actual locale/generation state, draft-preserving capture route and correlated signed callback must all be verified before activation or E2E completion is reported. Component tests and CI success do not establish those live facts.
