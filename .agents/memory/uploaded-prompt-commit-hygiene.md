---
name: Uploaded prompt commit hygiene
description: Handling uploaded prompt files that unexpectedly appear in imported Git history
---

An uploaded prompt can be present as an untracked file initially but also appear in a local import-time commit. Before creating a feature branch commit, compare the branch with `origin/main` and remove prompt-only commits from the feature history.

**Why:** Prompt/session files are prohibited from product branches, and leaving one in local history makes an otherwise clean implementation unsuitable for review.

**How to apply:** If a prompt-only commit is ahead of `origin/main`, stash the actual work, reset the feature branch and local `main` to `origin/main`, then reapply and commit only the product changes. Also compare the remote feature branch diff before merging: an apparently valid branch may now contain only prompt/config files because the product commits were already merged to `main`.