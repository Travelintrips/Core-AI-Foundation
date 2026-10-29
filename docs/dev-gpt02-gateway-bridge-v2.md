# GPT02 DEV — Gateway-native bridge v2 (isolated proposal)

**State:** CODE + UNIT TESTS ONLY. **Not deployed, not wired to the running worker.**
Do not interpret passing simulated tests as ChatGPT/GPT02 E2E PASS.

## Why replace the browser-reader chain

The October 24 A09 evidence verified a narrowly scoped delivery/attestation
through the managed ChatGPT browser. On October 30, A06 got as far as
SEND_INVOKED and failed with a native observation deadline. The original
worker depended on Chrome profile name, CDP port, PID, tab ownership,
composer coordinates, DOM text, a separate network capture and several phase
timeouts. Every additional observer could fail after sending, even if GPT02
had replied.

An approved Gateway-native agent can expose a structured run identifier
and result through OpenClaw instead. The new bridge does not read Chrome
pages, browser network requests, passwords or OAuth tokens. It has exactly
two public operations:

- dispatchOnce: validate the server-pinned principal, reserve an event
  durably, submit once to an authenticated Gateway with a deterministic
  idempotency key, and record its run ID.
- reconcile: query the original run without resending; verify the final
  assistant role, exact principal/run/session and challenge token; produce an
  Ed25519 signed receipt; submit a callback once; read a distinct verified
  server-side Final ACK.

The receipt signature is the **worker's attestation of a verified Gateway
result**, not a signature emitted by ChatGPT/OpenAI itself. AI Core must
verify the public key, trusted binding, receipt contents, and callback
before it can report E2E completion.

## Authority and identity

GPT02 is currently an authenticated ChatGPT browser identity, while the
DELL OpenClaw agent list uses ai-core/ai-core-agent and standalone model
status reported unresolved OPENCLAW_AI_CORE_API_KEY. A Gateway agent cannot
be assumed to be the same authenticated GPT02 account, even if its label
is GPT02.

**Hard prerequisite:** An administrator must authorize a provider model
account for a dedicated Gateway agent, establish the relationship between
that principal and GPT02, and publish a trusted principal fingerprint/proof.
If the provider cannot establish this relationship, label the route as a
separate agent, not GPT02. Never silently change GPT02's owner channel or
existing browser binding.

The experimental code requires:
- A trusted binding from worker-side protected configuration, never from
  mutable job metadata.
- A second live credential identity check from the Gateway adapter.
- A non-ai-core provider to prevent AI Core -> Gateway -> AI Core loops.
- Exact bound worker, owner, command, event, challenge, and session.
- A verified Final ACK from AI Core, not merely HTTP 200.

## Failure/restart semantics

| Step | Durable state | Only permitted recovery |
|---|---|---|
| Before send | RESERVED | Gateway idempotency lookup, no blind resubmission |
| Send accepted | SUBMITTED + runId | Observe this run |
| Send outcome unknown | SUBMISSION_UNKNOWN | Lookup original idempotency key only |
| Verified assistant reply | REPLY_VERIFIED + signed receipt | Commit callback ambiguity barrier |
| Callback attempted, response lost | CALLBACK_UNKNOWN | Query original callback receipt only |
| Callback accepted | CALLBACK_ACCEPTED | Read AI Core verified Final ACK |
| Verified finalization | FINAL_ACK | No more sends or callbacks |

Gateway chat.send supports an idempotency key. The actual adapter must
use that official RPC and implement read-only lookup of durable
submission/run history. A process-local map alone is not adequate:
store.reserve, store.transition, store.read must use durable transactional
storage with unique workerId/eventId and compare-and-swap transitions.
The transport idempotency key depends only on workerId and eventId.
A repeated event with changed commandId, correlation, challenge, owner,
credential fingerprint, agent, provider or prompt must fail with a
context-mismatch error, never result in another send. Never let an API
timeout trigger another send.

## Rollout gates (all DEV)

1. Prototype (done): offline tests for roles, correlation, signature tamper,
   parallel dedup, ambiguous send/callback, failed ACK.
2. Authority (blocked): confirm approved provider agent and credential/account
   fingerprint. Existing browser identity is not a Gateway identity proof.
3. Adapter (not done): implement authenticated OpenClaw Gateway chat.send and
   read-only result lookup; connect a DEV-only transactional ledger and AI
   Core's Ed25519 verifier.
4. Shadow validation: inspect new request IDs and prepared receipts without
   sending to ChatGPT or mutating the original A06 event.
5. Isolated E2E: ONE new job with unique event ID and immutable identity
   after authority/adapter gates. Verify AI Task -> AI Core -> Gateway ->
   provider -> signed callback -> Final ACK.
6. Consistency: ten separate jobs with zero duplicate sends or ACKs, plus
   worker restart and lost-response recovery. Only then propose guarded
   DEV cutover. PROD stays untouched.

## Test command

    node --test scripts/dev-gpt02-gateway-bridge.test.mjs

Tests use fully isolated fake Gateway/ledger/callback ports and an ephemeral
Ed25519 key pair. **They do not exercise live credentials or generate real
receipts or ACKs.**

## Safety / rollback

The code is not imported by the existing runtime, does not modify the
current allowlist or scheduled tasks, never sends A06 again, and does not
expose token values. Retain the existing browser transport until a verified
migration is available; do not erase existing SEND_INVOKED records. If
principal verification fails, stop with GATEWAY_PRINCIPAL_NOT_VERIFIED.
