# DEV DELL ChatGPT account bindings

The dedicated DELL executor can serve separate ChatGPT accounts sequentially with the existing worker ID and Ed25519 key. Each new account requires one exact binding of its AI Core OAuth owner channel, ChatGPT conversation, worker and OpenClaw browser profile. This change supplies the worker protocol and component tests. It does not install code, authorize another account, change local configuration or establish an E2E PASS.

The server must supply the matching `metadata.wakeBinding` protocol before a new account can be dispatched. GPT01 retains its v1 server metadata and signature format. The upgraded worker requires an explicit local GPT01 tuple, so prepare that tuple before upgrading the running executor.

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
      "enabled": false
    }
  ]
}
```

The global `enabled` value and the selected entry's `enabled` value must both be `true`. Each entry must contain a Boolean `enabled` field. A legacy conversation list by itself never authorizes the upgraded DELL worker. If `legacyBinding` is present, `allowedConversationIds` must contain exactly its conversation; the legacy alias and profile must remain `GPT01` and `openclaw`.

The registry validates all entries before selecting one, including disabled entries. Duplicate aliases, owner channels, conversations or browser profiles invalidate the registry. Profile conflicts are checked without case to avoid collisions on Windows; command selection still requires the exact configured case. The worker ID can be shared because one existing executor processes claims sequentially. Do not start a second consumer using that worker ID.

Additional aliases match `GPT[0-9]{2,4}` in uppercase and cannot be `GPT01`. Owner channels contain the `ai-engine-oauth:` prefix followed by 64 lowercase hex digits; conversation IDs are lowercase UUIDs. Profile names match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. A native Chrome profile label is not sufficient evidence of the OpenClaw profile that the worker controls.

An optional `bindingFingerprint` in a local entry must equal the computed fingerprint. A fingerprint is required in the server command. Neither the worker nor helper falls back to another profile, another conversation or the legacy list when a binding is missing, malformed, disabled or mismatched.

## Coordinated activation sequence

1. Record the currently verified GPT01 owner, conversation and `openclaw` profile. Prepare `legacyBinding` using those exact values and keep the existing legacy conversation list unchanged. An authorized runtime configuration change is required before replacing the worker; deploying code alone will otherwise reject legacy work.
2. Verify the second account through its supported login and AI Core OAuth connection. Obtain its actual owner channel, exact destination conversation and separately authenticated OpenClaw profile. Keep its new registry entry disabled until these agree with the server's authorized mapping. An email address or an account visible in an unrelated Chrome profile does not establish this mapping.
3. Review and apply the corresponding server and worker changes through the normal DEV workflow. Preserve the existing worker identity, scoped credential and attestation key. Any live authorization or security configuration change follows the applicable approval gate in `AGENTS.md` and the communication SOP.
4. Enable the exact second-account tuple only after the mapping and browser state are verified. Confirm there is exactly one matching conversation tab and no draft or active response before a live wake test.
5. Verify GPT01 regression and the new-account round trip independently. Require the observed assistant message, a valid signature for the expected binding, the server's accepted callback and the durable continuation ACK. Component tests and a visible echo marker alone cannot establish E2E PASS.

Rollback disables the new binding and restores the reviewed prior worker version/configuration as a coordinated operation. Do not broaden an allowlist or switch profiles to make a rejected command run.

## Command and signature protocol

For a new account the command metadata contains:

```text
wakeBinding = {
  version: 1, accountAlias, ownerChannel, targetConversationId,
  workerId, browserProfile, bindingFingerprint
}
```

Other metadata must identify the dedicated worker and exactly match the instruction's conversation, event and challenge. It must include `capability: "chatgpt:wake"`, `source: "authorized-dev-browser-wake"`, `explicitWorkerTarget: true`, and `devOnly: true`. The owner channel remains in `metadata.conversationId`; the actual ChatGPT UUID is in `metadata.targetConversationId`.

The executor validates the local tuple before starting Python and passes the complete metadata with the selected profile. Python independently reads the registry, checks the tuple and recomputes the challenge before accessing the browser. Missing `wakeBinding` is accepted only for the explicit legacy tuple. A present but invalid `wakeBinding` cannot use that compatibility path.

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

## Component validation and browser limits

```sh
node --check scripts/dev/dell-wake-executor.mjs
node scripts/dev/test-dell-wake-executor.mjs
python -m py_compile scripts/windows/ai-core/dev-chatgpt-wake-once.py
python -m unittest discover -s scripts/windows/ai-core -p 'test_dev_chatgpt_wake_once.py' -v
```

Python tests require `cryptography`; the dedicated component workflow installs a pinned version in a temporary virtual environment. Tests use fake browser state and ephemeral keys, exercise the actual signature payload and cross-language vectors, and reject tuple conflicts, profile changes, forged envelopes and duplicate submissions. The workflow has `contents: read` permission and performs no deployment or live account access.

The existing browser parser recognizes an `Ask ChatGPT` composer and English stop buttons in an OpenClaw accessibility snapshot. A new profile must be inspected through its actual OpenClaw snapshot before activation. Unsupported localized composer labels fail before typing; native-browser screenshots alone do not validate this parser or prove that an assistant response was observed.
