# ADR-006: Database Migration Strategy — Hand-Written DDL over ORM Push

**Status:** Accepted
**Date:** 2026-07-26
**Phase:** Material Phase 5 (formalising existing practice)

---

## Context

The project uses Drizzle ORM with a Supabase PostgreSQL database under the `ai_platform` schema (not `public`). Drizzle provides `drizzle-kit push` as a migration mechanism, but during Phase 5 engineering it was discovered that `drizzle-kit push` proposes to **drop the entire `ai_platform` schema** even for additive (non-breaking) changes. This is a critical production risk.

A safe, repeatable migration strategy is required that:
- Does not risk data loss on additive changes
- Works with the `ai_platform` non-default schema
- Is auditable (each migration is a versioned file)
- Can be applied to both dev and production databases safely

---

## Decision

All database schema changes use **hand-written DDL SQL files** stored in `artifacts/api-server/src/migrations/`.

Rules:
1. Never use `drizzle-kit push` against any database that contains production or seeded data
2. Every schema change is a new `.sql` file named `YYYYMMDD_<feature>.sql`
3. Each migration file includes a rollback block in a comment (`-- ROLLBACK: ...`)
4. Migrations are applied manually by an engineer following the production migration runbook (`docs/production-migration-runbook.md`)
5. All SQL explicitly sets `search_path = ai_platform` or uses schema-qualified names (`ai_platform.table_name`)
6. Migrations are additive by default — columns are only dropped in a dedicated, reviewed migration file

Drizzle ORM is still used for query-building in application code (type-safe queries) — only the migration mechanism is replaced.

---

## Alternatives Considered

### `drizzle-kit push` (ORM-managed migrations)
Use Drizzle's built-in migration push. Rejected — `drizzle-kit push` proposed dropping the entire `ai_platform` schema even for additive changes (observed and documented in memory notes). Risk of catastrophic data loss is unacceptable.

### `drizzle-kit generate` + `drizzle-kit migrate`
Use Drizzle's migration generation (diff-based) rather than push. Partially viable — generates SQL files that can be reviewed before application. Rejected in favour of hand-written DDL because: generated SQL still requires manual review for schema-path issues; hand-written DDL is more explicit and easier to audit; team already has hand-written DDL in place for all Phase 5 tables.

### Prisma Migrate
Switch ORM to Prisma for its safer migration model. Rejected — too large a refactor; Drizzle is already embedded throughout the codebase.

### Flyway / Liquibase
Use a dedicated migration tool. Rejected — adds a new operational dependency; hand-written DDL with naming conventions achieves the same versioning and auditability at zero additional tooling cost.

---

## Consequences

**Positive:**
- Zero risk of accidental schema drop from ORM tooling
- Every migration is a human-readable, reviewable SQL file
- Rollback instructions are co-located with the migration
- Schema-path issues are caught at authoring time, not at push time

**Negative:**
- Engineers must write SQL manually (no ORM-generated diff)
- Migration files can drift from Drizzle schema definitions if not kept in sync
- No automated migration runner — manual application requires discipline

**Mitigations:**
- Production migration runbook (`docs/production-migration-runbook.md`) documents the exact application procedure
- Pre-Phase-6 checklist requires migration runbook to be up to date before any Phase 6 schema changes
- CI typecheck catches Drizzle schema / migration drift at the TypeScript level (column type mismatches)
