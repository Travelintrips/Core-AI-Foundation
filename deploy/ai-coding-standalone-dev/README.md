# AI Coding DEV: on-demand GCP Ollama dispatch

This package records the standalone DEV dashboard/worker integration. It does not modify PROD configuration or authorize PROD deployment.

## Behavior

- The authenticated DEV approval API accepts `requires_ollama: true` on an allowlisted `coding_test` job.
- The durable DEV worker checks this flag **after** claiming that durable job, then invokes the scoped Compute Engine controller.
- Requests without the flag stay local; no unsolicited VM starts or polling occur.
- The controller checks the exact project `ollama-510011`, zone `asia-northeast1-c` and instance `instance-20260928-124118`, using the established service identity, and starts only an observed TERMINATED instance.
- The worker persists a GCP operation identifier in its checkpoint, associating the wake event with the initiating job ID.
- The cloud VM owns its idle shutdown. The DEV dispatcher **never** issues an automatic stop operation.
- The source here reflects the dedicated VPS DEV runtime and is not a generic PROD job executor.

## Preconditions

The worker must be restricted to DEV, run with the `cryptography` and `requests` Python modules, and be allowed to read a service-account file only at the configured protected server path. Set `GCP_OLLAMA_AUTOSTART_DEV_ENABLED=true` **only in the dedicated DEV worker systemd service**, not the PROD application. Keep the service-account file permission at 0600 and never commit it.

## Verification

Run `python3 -m py_compile` on the Python files, then `python3 gcp_dispatch_e2e.py` on the restricted DEV VPS with the existing admin test principal, worker service and DEV DB available. Check the resulting job checkpoint for `gcp_controller.gcp_start=requested` and the corresponding VM status in GCP. The fixture does not merge code or deploy production changes.

Run `python3 gpu_idle_guard_test.py` to validate active ComfyUI, active Ollama, malformed/unavailable ComfyUI and idle behavior of the conservative shared-GPU guard in dry-run mode.

**Deployment hold:** The guard implementation is versioned and offline-tested here; deploy it to the GCP VM and verify an active workload is not interrupted before enabling any new PROD autostop logic. Do not treat a positive DEV job wakeup test as proof of full model inference or full shared-workload safety.
