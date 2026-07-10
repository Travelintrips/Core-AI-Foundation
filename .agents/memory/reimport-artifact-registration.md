---
name: reimport-artifact-registration
description: Artifacts and workflows disappear after a GitHub re-import even though artifact.toml files remain on disk
---

After a project is re-imported from GitHub, `listArtifacts()` can return empty and no workflows are configured, even though every artifact still has a valid `.replit-artifact/artifact.toml` on disk. `createArtifact()` can't be used to fix this (slug already exists / directory not empty).

**Fix:** call `runPostMergeSetup()` (post-merge-setup skill). As a side effect it re-registers all artifacts from their on-disk `artifact.toml` files and recreates their managed workflows. Ignore the setup script's own success/failure — check for the "Added artifact" / "Configured workflows changed" system messages that follow instead.

**Why:** artifact/workflow registration lives outside git-tracked files, so it doesn't survive a GitHub import even when the TOML source of truth does.

**Caution:** if the post-merge script also runs a schema push (e.g. `drizzle-kit push`), it may prompt interactively and fail (stdin is closed on this runtime) — check the diff before forcing it, since a naive `push --force` can drop tables with real data.

**Never write a DB connection string (or any credential) into `.replit` via `setEnvVars`** — even to alias an existing var under a different name. `.replit` is plaintext and version-tracked. If a required env var name differs from what an existing plaintext var already provides, add a fallback read in code (`process.env.A || process.env.B`) instead of duplicating the value into a new var.
