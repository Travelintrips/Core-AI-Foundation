---
name: TEAM 43 workflow and job contracts
description: Durable rules for queue capabilities, renderer routing, and evidence-backed job completion
---

# TEAM 43 workflow and job contracts

Every specialized job capability must be registered in the worker capability
map before enqueue paths persist it. Enqueue validation and worker
advertisement are a single contract: changing only one side can strand jobs.

**Why:** A persisted capability with no matching worker is indistinguishable
from a queue stall, while an unvalidated capability typo silently creates the
same failure mode.

File-producing workers must return concrete deliverable evidence before the
queue marks them completed. Renderer results use non-empty artifact arrays with
storage paths and HTTP(S) public URLs; ZIP/export paths use their own storage
path fields. Unsupported job types must fail explicitly rather than return a
dispatch placeholder.

**Why:** Queue status and delegated/placeholder messages are not proof that a
customer deliverable exists, and false completion blocks honest retry/recovery.

**How to apply:** Update the capability registry, enqueue validation, worker
switch, completion requirements, false-completion audit, and regression tests
together whenever adding a job archetype.