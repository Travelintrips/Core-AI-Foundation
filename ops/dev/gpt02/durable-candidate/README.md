# Task190 durable gate candidate — DEV source only

This is NOT an executable authorization service. It has no credential issuance,
live independent Owner/issuer verification, external durable atomic consumption,
socket server, or deployment unit. Do not start it as a gate or use synthetic
tests to claim runtime approval or release readiness.

gate-durable-core.mjs requires injected, independently authenticated Owner
identity, authority verification, receipt verification and atomic issuer
consumption. durable-ledger.py writes a restricted local state machine
(READY -> CLAIMED -> COMPLETED) which remains CLAIMED after an uncertain
issuer operation, to prevent automated replay. A DBA/custodian must supply
externally verified reconciliation before any live integration.

Offline commands:
- node --test ops/dev/gpt02/durable-candidate/gate-durable-core.test.mjs
- python3 ops/dev/gpt02/durable-candidate/path-guards.test.py

Do not reuse expired Task190 Owner decisions/receipts. No PROD changes.
