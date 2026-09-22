---
name: Supabase pooler search_path
description: Supabase pooler rejects libpq startup search_path options; initialize the session after connection checkout.
---

Supabase pooler connections must not receive `search_path` through libpq's startup `options` parameter. Initialize each new `pg` client with the pool's awaited `verify` hook instead.

**Why:** The pooler rejects the startup parameter with `unsupported startup parameter in options: search_path`, which makes the production API fail before it can query the database.

**How to apply:** Keep the app's dedicated `ai_platform` schema and run `SET search_path TO ai_platform, public` in `verify`; do not replace it with an unawaited `pool.on("connect")` query.