# Replace the scoped DEV continuity conversation

## Approved scope

On 2026-10-18 Boss supplied replacement conversation
`https://chatgpt.com/c/6ad4a482-5368-83ec-a520-43a4b08d38a6` after the previous
conversation reached its maximum length. This authorizes replacing the single
DEV wake destination. It does not authorize additional owners, workers,
destinations, PROD operations, or changes to application behavior.

| Boundary | Retained value |
| --- | --- |
| Supabase project | CST-DEV, `xssrfshdrtdfupgqwfdw` |
| Runtime role | `aicore_dev_runtime` |
| OAuth owner | `ai-engine-oauth:84e4810f3b3b392675d0fd655ea01c3ee82c9160616adc35c1dfe06ac1568a67` |
| Worker | `openclaw-travelintrips-dev` |
| Previous target | `6ad3a9a6-97e4-83ec-af32-a0a5d580b649` |
| Replacement target | `6ad4a482-5368-83ec-a520-43a4b08d38a6` |

## Reviewed baseline and manual policy change

The live precheck found the named INSERT policy permissive, with exactly the
runtime role, no USING expression, and table RLS enabled. The reviewed
`pg_get_expr(polwithcheck, polrelid)` MD5 is
`85c089fec894985234498df3bf1c6ae2`. The MD5 is a catalog drift check, not an
authentication credential or proof of project identity.

The previous watch `ff523ae8-1495-4933-92d5-ad568f812a94` was confirmed
`CANCELLED`, revision 3, wake count 0, before replacement preparation. Recheck
the live state before applying; this record is not permission to ignore a new watch.

Apply only the exact reviewed GitHub revision of
[the retarget migration](../../artifacts/api-server/src/migrations/20261018110640_dev_continuity_retarget_6ad4a482.sql)
through the connector explicitly bound to CST-DEV. The migration filename was
allocated with the pinned official Supabase CLI `2.81.3 migration new` in
temporary staging, then placed in the repository's manual migration directory.
No Supabase project was linked by that filename allocation.

The transaction takes a bounded SHARE ROW EXCLUSIVE table lock before checking
the catalog and global watch state. It requires an unfiltered administrative
view, a runtime role without superuser/BYPASSRLS privileges, the exact reviewed
policy digest and attributes, and zero active or nonterminal continuity watches.
It changes one quoted target UUID using the live catalog expression and verifies
the exact expression and all retained attributes before committing. There are
no grants, row edits, policy drops, or automatic application hooks.

A missing guard or drift aborts the transaction. Reapplication after success
also aborts because the prior digest no longer matches. Inspect the current
evidence instead of editing the expected digest to force a retry.

## Runtime configuration and PC pairing

Complete the zero-watch check before removing the old target from the backend
allowlist. Afterwards the old watch target fails the runtime authorization
check, including status and checkpoint operations.

1. Preserve the current backend image and all unrelated configuration.
2. Replace the sole `AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS` value in
   `/opt/core-ai-dev/.env.dev` with the replacement UUID. Preserve the existing
   owner channels, browser-wake flag, continuity flag, credentials, and DEV base URLs.
3. Recreate only the DEV backend through its existing approved release process;
   a container restart does not reload an edited environment file.
4. In `%LOCALAPPDATA%\\AI-Core\\chatgpt-wake-dev-allowlist.json`, preserve
   `enabled: true` and replace the sole `allowedConversationIds` entry with the
   new UUID. Preserve existing receipt files.
5. Confirm exactly one authenticated Chrome tab has the exact new conversation
   URL and that its composer is available and empty. The helper uses
   `openclaw.cmd browser --browser-profile chrome`.
6. Verify backend and PC configuration contain the new target only. The gateway
   has no destination allowlist requiring a rebuild for this replacement.

This record does not change the live configuration by itself.

## Policy validation

Run [the rollback-only RLS probes](DEV_CONTINUITY_TARGET_RETARGET_RLS_PROBES.sql)
against the same verified CST-DEV project after the policy replacement. The
probes explicitly assume `aicore_dev_runtime` and require enforced RLS. They
expect the new target to pass and the old target, wrong owner, wrong worker, and
mismatched row owner to fail with table-specific RLS denials. Each attempted
INSERT rolls back in a subtransaction; the outer transaction also rolls back.

After execution, verify no probe records exist:

```sql
SELECT count(*) AS retained_probe_rows
FROM ai_platform.ai_coding_bridge_commands
WHERE command_type = 'DEV_CONTINUITY_WATCH'
  AND metadata_json #>> '{devContinuity,jobId}' = 'retarget-rls-rollback-probe';
```

Retain the before/after policy expressions, resulting digest, exact applied
commit, probe results, and zero retained row count as acceptance evidence.
A completed GitHub check does not prove the live policy was applied.

## Automatic wake canary

After all preflight checks, register one new UUID using the actual deployed
application SHA. The example values below are placeholders, not executed evidence:

```text
DEV_CHATGPT_WATCH_V1 conversation=6ad4a482-5368-83ec-a520-43a4b08d38a6 job=<uuid> checkpoint=<deployed-40-character-sha> idle=120 ttl=1800
```

Use `confirmed=true`. Preserve the returned job ID, watch command ID, revision,
deadline and expiry in the conversation checkpoint, then end the response
before the 120-second deadline. Do not send a manual WAKE command.

The automatic message contains `[AI_CORE_WAKE:<eventId>]` but no job ID.
When it arrives, use the preserved job ID to read WATCH_STATUS, match
`PROGRESS_DEADLINE_EXPIRED`, event and child command IDs, and verify the
authenticated worker callback plus actual browser message and assistant reply.
Read the matching durable response, ACK its exact response ID, and independently
check `acknowledged_at`. Only then send a COMPLETED checkpoint using the
current revision. The watch preserves the evidence on terminal completion.

The existing helper always reports `verifiedAssistantReply=false`; verify the
actual resumed assistant turn separately. Browser delivery alone does not prove
continued work. A busy composer/response blocks the wake, and a callback does
not automatically rearm another one. This canary verifies one scoped cycle.

## Rollback and verification status

Rollback is a separately reviewed inverse target replacement after new-target
watches are terminal. Pin its reviewed expected digest to the verified
post-change digest and retain the same guards. Do not drop the policy or
overwrite the original CREATE migration.

At preparation time, SQL application, role probes, GitHub CI and live wake E2E
are pending. Record each actual result separately; this document makes no PASS,
deployment, or browser delivery claim.
