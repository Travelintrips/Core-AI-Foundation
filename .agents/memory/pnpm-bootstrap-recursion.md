---
name: pnpm bootstrap recursion
description: Prevent recursive pnpm self-installation from exhausting workflow process and thread limits.
---

Keep the root `packageManager` declaration aligned with the pnpm version supplied by the active Replit runtime.

**Why:** A newer mismatched declaration caused every artifact workflow to run a nested `pnpm add pnpm@...`. The installer recursively spawned itself until the container reached its thread limit, producing Node `pthread_create` and `uv_thread_create` failures and 502 previews.

**How to apply:** If several pnpm-based workflows fail together with installer recursion or thread-creation errors, stop the stale installer chain, align the declared version with `command -v pnpm` / the runtime package version, then restart workflows sequentially.