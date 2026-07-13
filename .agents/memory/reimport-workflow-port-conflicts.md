---
name: reimport-workflow-port-conflicts
description: Workflows fail with EADDRINUSE right after a GitHub re-import even though runPostMergeSetup succeeded
---

After `runPostMergeSetup()` restores artifacts/workflows on a re-imported project, the newly registered workflows can immediately fail with `EADDRINUSE` (port already in use) on their very first run, even though nothing else was started intentionally.

**Why:** stale node/vite processes from an earlier session (before the import wiped registration) can still be holding the artifact's ports. `WorkflowsRestart` alone doesn't reliably reap them.

**How to apply:** if a freshly-registered workflow fails with `EADDRINUSE`, run `lsof -i:<port>` for each affected port, `kill -9` the PIDs found, then `WorkflowsRestart` again. Don't assume the code or config is broken — check for a stale listener first.
