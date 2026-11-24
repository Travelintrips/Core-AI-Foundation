# CST-DEV Gate A — source-preserving JIT/relock QA port

**Source-only, never an operational runner or a release authorization.**

This directory records the previously tested isolated CST-DEV controller,
single-flight lock, durable nonce adapter, relock primitive, signed permit
verifier dependencies, and their regression tests. The eight implementation
Python files were copied byte-for-byte from the VPS QA snapshot
`/opt/cst-onejob-dev/qa/gatea-jit-db-clock-20261123/`
and independently compared against that snapshot during the port.

The three regression test files were also copied from that snapshot.
Two regression test fixtures originally passed an obsolete `now=`
parameter to `run_signed_one_stage`; their tests were updated to supply
the controller's actual PostgreSQL `CLOCK_SQL` response instead. Production
controller logic was **not changed**. All 36 tests pass from this tracked
source tree.

For source-only QA:

```sh
cd qa/gatea-jit
python3 -B -m unittest -q \
  test_cst_onejob_stage_jit_open_controller \
  test_cst_onejob_stage_nonce_adapter \
  test_cst_onejob_stage_single_flight
```

The nonce adapter deliberately reuses only the pre-existing signer
`consume_nonce` primitive in
`deploy/cst-onejob-vps/cst_onejob_vps_signer.py`. It does not run a signer,
create credentials, connect to any DB, or enable LOGIN.

**Never deploy this folder directly as a systemd service.** The JIT,
single-flight, nonce and relock modules still deny operational CLI execution.
An authorized and independently tested runtime bridge, narrowly scoped SQL
identity, short-lived signed lease, permanent single-flight/nonce state,
crash/reboot relock recovery, protected existing session credential,
Supavisor session drain, and authenticated Owner readback are prerequisites.
No signed stage permit, QA fixture, or local root-owned evidence grants
automatic runtime authority. Gate A remains **NO_GO**; PROD untouched.
