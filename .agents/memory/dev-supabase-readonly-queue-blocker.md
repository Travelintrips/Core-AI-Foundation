---
name: Development Supabase read-only queue blocker
description: Real dispatcher integration requires a writable development database; the observed Supabase runtime rejected all lifecycle writes with SQLSTATE 25006.
---

The development API may report healthy while the Supabase-backed database is read-only. In that state worker registration/leases, `ai_coding_tasks`, audit writes, and `ai_jobs` row-locking claims fail with `cannot execute ... in a read-only transaction` (SQLSTATE 25006).

**Why:** Phase 7A-10 requires real writes and `SELECT ... FOR UPDATE SKIP LOCKED`; unit tests and liveness checks cannot prove the queue path when the database is read-only.

**How to apply:** Before running queue integration, verify a writable development connection with a harmless write-path probe or a controlled task creation. Do not declare the integration passed from dispatcher status, health, or tests alone.