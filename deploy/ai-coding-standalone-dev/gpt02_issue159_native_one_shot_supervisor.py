#!/usr/bin/env python3
"""CST-DEV Issue159: bounded native ONE-task supervisor adapter.

This provides the previously missing concrete adapter to the ORIGINAL
review_one_shot_reader_readback(packet, supervisor) contract. It does not mint
credentials, install DB roles, import approval state, sign, dispatch, or
contact the network until a separately authorized connection factory exists.

Only a DB/secret custodian may supply the five native libpq factories from
reviewed systemd-encrypted credentials and a separately committed one-task
issuance. Neither caller-supplied DSN nor a boolean auth flag is accepted.

On failure the original broker's finally calls relock_and_verify(). This
adapter calls the already-reviewed scoped Phase A/B RPCs with *separate*
COMMITs, and refuses a success report unless both phases reported progress.
The original broker then still requires INDEPENDENT native PostgreSQL
boolean catalog attestation for the *exact* role, not this self-report.

Release is ALWAYS NO_GO until original one-owner authenticated approval,
live cross-store canonical fence, one-read credential custody, and DELL
Final ACK are independently proven. Never import this file into an HTTP route.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from collections.abc import Callable, Iterator
import threading
import time
from typing import Any

from gpt02_issue159_native_relock_attestation import (
    AUDITOR_DB_USER, _target,
)
from gpt02_issue159_one_shot_reader_broker import (
    POOLER_HOST, POOLER_PORT, POOLER_USER_SUFFIX,
    consume_once_via_pinned_connection,
)
from gpt02_issue159_pinned_tls_ca import require_pinned_cst_dev_tls
from gpt02_issue159_writer_broker_contract import BrokerAdmissionError

# All openers are injected by a separately authorized encrypted-credential
# custodian. No service role, common issuer reader or global admin DSN.
# The five factories MUST open FRESH native sessions every time.
@dataclass(frozen=True)
class TrustedConnectionFactories:
    consumer: Callable[[], Any]
    guard: Callable[[], Any]
    scoped_reader: Callable[[], Any]
    auditor: Callable[[], Any]
    relock: Callable[[], Any]


PHASE_A = "SELECT gpt02_relock_audit.relock_reader_phase_a() AS count"
PHASE_B = "SELECT gpt02_relock_audit.relock_reader_phase_b() AS count"
MAX_RELOCK_SECONDS = 19.0
POLL_SECONDS = 0.40
# Reuse the exact original DEV relock service identity (not a new login).
# Its independently encrypted service credential targets this direct host,
# rather than the pooler user suffix used by the other four read sessions.
RELOCK_NATIVE_ROLE = "dev_gpt02_relock_catalog_auditor"
RELOCK_DIRECT_HOST = "db.xssrfshdrtdfupgqwfdw.supabase.co"


def _deny(code: str) -> None:
    raise BrokerAdmissionError(code)


def _identity(
    connection: Any, expected_user: str, *, autocommit: bool,
    expected_host: str = POOLER_HOST,
) -> None:
    """Validate native negotiated libpq identity and immutable CST-DEV CA."""
    info=getattr(connection,"info",None)
    if (
        info is None or getattr(info,"user",None) != expected_user
        or getattr(info,"dbname",None) != "postgres"
        or getattr(info,"host",None) != expected_host
        or str(getattr(info,"port",None)) != POOLER_PORT
        or getattr(connection,"autocommit",None) is not autocommit
    ):
        _deny("NATIVE_SCOPED_SUPERVISOR_SESSION_IDENTITY_INVALID")
    getter=getattr(info,"get_parameters",None)
    require_pinned_cst_dev_tls(
        getter() if callable(getter) else None,
        "NATIVE_SCOPED_SUPERVISOR_TLS_PIN_REQUIRED",
    )


def _phase(connection: Any, statement: str) -> int:
    """One committed Phase A or Phase B; never share a transaction."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ WRITE")
            cursor.execute("SET LOCAL statement_timeout = '9000ms'")
            cursor.execute(statement)
            rows=cursor.fetchmany(2)
            desc=tuple(c.name for c in cursor.description)
            if (
                desc != ("count",) or len(rows) != 1
                or len(rows[0]) != 1
                or type(rows[0][0]) is not int
                or not 0 <= rows[0][0] <= 1000
            ):
                _deny("NATIVE_SCOPED_SUPERVISOR_PHASE_RESULT_UNTRUSTED")
            result=rows[0][0]
        connection.commit()
        return result
    except Exception:
        try: connection.rollback()
        except Exception: pass
        raise


class OneTaskNativeSupervisor:
    """The five real interfaces consumed by the already-tested one-read broker.

    This object is per signed task/command/attempt. It never accepts an
    arbitrary role name, user-selected SQL or credentials through its public
    methods. All authorization remains in original pinned signed packet,
    persisted Owner readback, and PostgreSQL canonical fence.

    It expects all scope and credential issuance to be reviewed and committed
    by a separate owner/DB custodian BEFORE one-shot broker invocation.
    """

    def __init__(
        self, candidate: dict[str, Any], factories: TrustedConnectionFactories,
        *, monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if type(factories) is not TrustedConnectionFactories:
            _deny("NATIVE_SCOPED_SUPERVISOR_TRUSTED_FACTORIES_REQUIRED")
        for method in (
            factories.consumer, factories.guard, factories.scoped_reader,
            factories.auditor, factories.relock,
        ):
            if not callable(method):
                _deny("NATIVE_SCOPED_SUPERVISOR_FACTORY_UNAVAILABLE")
        self._role,self._scope_sha=_target(candidate)
        self._factories=factories
        self._candidate=candidate
        self._monotonic=monotonic
        self._sleep=sleep
        self._mutex=threading.Lock()
        self._consumption_attempted=False
        self._consumed=False
        self._reader_opened=False
        self._auditor_open_count=0
        self._relock_attempted=False
        self._guard_opened=False

    def _matched(self, candidate: dict[str, Any]) -> None:
        role,sha=_target(candidate)
        if (role,sha)!=(self._role,self._scope_sha):
            _deny("NATIVE_SCOPED_SUPERVISOR_CROSS_TASK_DENIED")

    def consume_scope_once(
        self, candidate: dict[str, Any], read_challenge: str,
    ) -> dict[str, Any]:
        self._matched(candidate)
        with self._mutex:
            if self._consumption_attempted or self._relock_attempted:
                _deny("NATIVE_SCOPED_SUPERVISOR_CONSUMPTION_REPLAY_DENIED")
            # Mark BEFORE any connection attempt so uncertain commits cannot
            # cause a second claim, even if an RPC/network error occurs.
            self._consumption_attempted=True
        with self._factories.consumer() as conn:
            value=consume_once_via_pinned_connection(
                conn, candidate, read_challenge,
            )
        self._consumed=True
        return value

    @contextmanager
    def open_minimal_auditor_connection(
        self, candidate: dict[str, Any],
    ) -> Iterator[Any]:
        self._matched(candidate)
        if not self._consumption_attempted:
            _deny("NATIVE_SCOPED_SUPERVISOR_AUDIT_BEFORE_CLAIM_DENIED")
        self._auditor_open_count+=1
        with self._factories.auditor() as conn:
            _identity(conn,AUDITOR_DB_USER,autocommit=False)
            yield conn

    @contextmanager
    def open_canonical_guard_connection(
        self, candidate: dict[str, Any],
    ) -> Iterator[Any]:
        self._matched(candidate)
        if not self._consumed or self._auditor_open_count<1:
            _deny("NATIVE_SCOPED_SUPERVISOR_GUARD_BEFORE_AUDIT_DENIED")
        if self._guard_opened or self._relock_attempted:
            _deny("NATIVE_SCOPED_SUPERVISOR_GUARD_REPLAY_DENIED")
        self._guard_opened=True
        with self._factories.guard() as conn:
            # Original broker checks exact guard role and holds FOR SHARE,
            # including a server-clock recheck AFTER the bounded reader.
            yield conn

    @contextmanager
    def open_one_scoped_connection(
        self, candidate: dict[str, Any],
    ) -> Iterator[Any]:
        self._matched(candidate)
        if not self._guard_opened or self._reader_opened or self._relock_attempted:
            _deny("NATIVE_SCOPED_SUPERVISOR_READER_REPLAY_OR_GUARD_MISSING")
        self._reader_opened=True
        with self._factories.scoped_reader() as conn:
            _identity(
                conn, self._role+POOLER_USER_SUFFIX, autocommit=False,
            )
            yield conn

    def relock_and_verify(self, candidate: dict[str, Any]) -> dict[str, Any]:
        self._matched(candidate)
        with self._mutex:
            if self._relock_attempted:
                _deny("NATIVE_SCOPED_SUPERVISOR_RELOCK_REPLAY_DENIED")
            self._relock_attempted=True
        # Cannot lock a role's grants until its DBA-issued 15s lease expires.
        # A separate pre-enabled timer must cover process SIGKILL/crash.
        # This bounded local loop covers normal/error return; it never
        # starts a new timer, creates a role or extends any lease.
        stop_at=self._monotonic()+MAX_RELOCK_SECONDS
        phase_a_seen=False
        phase_b_seen=False
        try:
            with self._factories.relock() as conn:
                _identity(
                    conn,RELOCK_NATIVE_ROLE,autocommit=False,
                    expected_host=RELOCK_DIRECT_HOST,
                )
                while True:
                    a=_phase(conn,PHASE_A)
                    # A is a committed, durable NOLOGIN before B begins.
                    b=_phase(conn,PHASE_B)
                    phase_a_seen=phase_a_seen or a>0
                    phase_b_seen=phase_b_seen or b>0
                    if phase_a_seen and phase_b_seen:
                        break
                    if self._monotonic()>=stop_at:
                        _deny("NATIVE_SCOPED_SUPERVISOR_RELOCK_DEADLINE_EXCEEDED")
                    self._sleep(min(POLL_SECONDS,max(0.0,stop_at-self._monotonic())))
        except Exception:
            # The caller MUST fail; installed independent watchdog remains
            # responsible for eventual terminal cleanup after a crash.
            raise
        # This is not an attestation: both counts may be about other roles.
        # The ORIGINAL broker immediately checks scoped_reader_fully_locked
        # through a separately authenticated read-only PostgreSQL auditor.
        return {
            "role":self._role,
            "scopeSha256":self._scope_sha,
            "noLogin":True,
            "passwordNull":True,
            "connectionLimitZero":True,
            "zeroActiveSessions":True,
            "grantsRevoked":True,
        }


if __name__=="__main__":
    raise SystemExit("NATIVE_ONE_TASK_SUPERVISOR_UNINSTALLED_NO_CREDENTIAL_OR_DISPATCH")
