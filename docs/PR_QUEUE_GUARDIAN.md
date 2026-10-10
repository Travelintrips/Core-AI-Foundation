# PR Queue Guardian — Operating contract

Scope: this repository only until the same vetted workflow is installed in each other repository.

- Executes hourly (minute 17 UTC) and via manual GitHub Actions workflow dispatch, using trusted default-branch code only. No pull-request checkout or head-branch code execution.
- Audits up to 80 open PRs; writes a per-run summary with CI readiness, GitHub mergeability and next action.
- `safe-sync` label: for non-draft PR branches in the same repository, may request GitHub's non-force **update branch** when GitHub reports the branch behind. The API checks the expected old head SHA; CI must rerun after the update.
- `safe-automerge` label: may activate native GitHub auto-merge only when the PR is non-draft, same repository, from a member/collaborator, mergeable and clean, with existing completed successful checks, and a small diff without sensitive paths. GitHub branch protection, required reviews, and required status checks are never bypassed.
- Sensitive paths include workflow files, migrations, finance, payment, invoice, tax, authentication, deployment, security, secrets and production configuration. These always require explicit human evaluation and merge.
- CI failure, blocked permissions, conflicts, and policy checks are **not** grounds to force push, skip checks, or falsely claim green. The workflow diagnoses these conditions but does not automatically rewrite application code or blindly rerun deterministic failures.
- No cross-repo token, workflow bypass, deployment, payment action, or privilege escalation is requested.
- Labels are deliberately opt-in: repository maintainers must apply them only to preauthorized PRs. Do not use either label for financial changes, secrets, deployment protections or irreversible work without corresponding review.
- Verify the first real scheduled/manual run and ensure the GitHub Actions token has the permissions declared in the workflow. If organization policies override token permissions, the summary reports errors; never loosen organization protections to fix this.

Caveat: GitHub status checks are recorded on the head SHA; a branch update creates a new commit and all mandatory checks must pass again. The workflow itself does not independently guarantee deploy safety or perform production deployment.
