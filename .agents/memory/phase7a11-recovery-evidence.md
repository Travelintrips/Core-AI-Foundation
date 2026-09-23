---
name: Phase 7A-11 recovery evidence
description: DEV recovery harness gotchas for worker claim markers and raw SQL parameter typing
---

Raw PostgreSQL expressions used by the worker queue must cast parameterized values when the
database cannot infer their type: use an explicit integer cast for `to_jsonb(workerId)` and a
`timestamptz` cast for recovery timestamps. Without these casts, the transaction fails and the
dispatcher fallback can hide the intended recovery result.

**Why:** The controlled DEV recovery test exposed both errors only when real Supabase rows were
claimed and rebalanced; mocked tests did not exercise PostgreSQL parameter inference.

**How to apply:** For future recovery evidence, isolate the claimed worker from the dispatcher
roster, verify `running` plus the ownership marker before making it stale, call recovery, and
then verify terminal job/run state, offline worker state, and duplicate-run count.