---
name: Phase 7A-12 release gate
description: Production release checks for the file redirect fix, external Supabase schema verification, and dispatcher safety.
---

Production release readiness must treat these as separate gates: SAST/HoundDog cleanliness, dependency findings, complete workspace typecheck, and direct schema verification. The Replit production SQL callback cannot inspect the external Supabase database, so table existence remains unverified unless an authorized read-only Supabase path is available.

**Why:** The application has a production-specific default that can start dispatcher and scheduler when the production URL matches the live AI Front origin and the corresponding flags are absent. A release that must not activate production workers must explicitly verify those flags are false before rollout.

**How to apply:** Keep production worker flags explicitly disabled during security/release work, do not infer external Supabase table availability from local Drizzle schema or migration source, and report unresolved dependency/typecheck/schema gates as `RELEASE READY: NO`.