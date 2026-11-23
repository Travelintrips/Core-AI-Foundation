#!/usr/bin/env python3
"""No DB, no real systemd unit stop, no live watchdog. AF_UNIX socket tests."""
import os
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cst_onejob_gatea_stage_stop_bridge as b

class StopBridgeTest(unittest.TestCase):
    def serve_pair(self, cmd=b.COMMAND, *, pid=1234, expected=1234,
                   uid=9999, gid=9999, member=True, ack=b.ACK[0]):
        server, client = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        called=[]
        errors=[]
        def stop():
            called.append(b.BROKER)
            return ack
        def run_server():
            try:
                b.serve_one(server,
                    peer_reader=lambda _:(pid,uid,gid),
                    pid_reader=lambda:expected,
                    membership_checker=lambda _:member,
                    stop_broker=stop)
            except Exception as e:
                errors.append(type(e).__name__)
            finally:
                server.close()
        th=threading.Thread(target=run_server,daemon=True)
        th.start()
        try:
            client.settimeout(3)
            # On an invalid peer, the server correctly rejects BEFORE reading
            # the command; the early FIN may produce BrokenPipe on the client.
            try:
                client.sendall(cmd)
                client.shutdown(socket.SHUT_WR)
            except (BrokenPipeError,ConnectionResetError,OSError):
                pass
            try:
                result=client.recv(64)
            except (ConnectionResetError,BrokenPipeError):
                result=b""
        finally:
            client.close()
            th.join(timeout=2)
        self.assertFalse(th.is_alive())
        return result,called,errors
    def test_exact_watchdog_pid_stops_only_broker(self):
        r,c,e=self.serve_pair()
        self.assertEqual(r,b.ACK[0])
        self.assertEqual(c,[b.BROKER])
        self.assertEqual(e,[])
    def test_absent_broker_safe_and_acknowledged(self):
        r,c,e=self.serve_pair(ack=b.ACK[1])
        self.assertEqual(r,b.ACK[1])
        self.assertEqual(c,[b.BROKER])
        self.assertEqual(e,[])
    def test_wrong_pid_denied_no_stop(self):
        r,c,e=self.serve_pair(pid=1111,expected=2222)
        self.assertEqual(r,b"");self.assertFalse(c);self.assertTrue(e)
    def test_root_peer_denied_no_stop(self):
        r,c,e=self.serve_pair(uid=0)
        self.assertEqual(r,b"");self.assertFalse(c);self.assertTrue(e)
    def test_wrong_group_denied_no_stop(self):
        r,c,e=self.serve_pair(gid=0)
        self.assertEqual(r,b"");self.assertFalse(c);self.assertTrue(e)
    def test_foreign_cgroup_denied(self):
        r,c,e=self.serve_pair(member=False)
        self.assertEqual(r,b"");self.assertFalse(c);self.assertTrue(e)
    def test_bogus_command_denied(self):
        r,c,e=self.serve_pair(cmd=b"STOP_ANY_UNIT\n")
        self.assertEqual(r,b"");self.assertFalse(c);self.assertTrue(e)
    def test_partial_stream_command_is_accepted(self):
        # A stream socket may split a single logical message across recv calls.
        server,client=socket.socketpair(socket.AF_UNIX,socket.SOCK_STREAM)
        result=[]
        def worker():
            try:
                result.append(b.serve_one(server,
                    peer_reader=lambda _:(1234,9999,9999),
                    pid_reader=lambda:1234,
                    membership_checker=lambda _:True,
                    stop_broker=lambda:b.ACK[0]))
            finally:
                server.close()
        th=threading.Thread(target=worker,daemon=True);th.start()
        try:
            client.sendall(b.COMMAND[:6])
            threading.Event().wait(0.02)
            client.sendall(b.COMMAND[6:])
            client.shutdown(socket.SHUT_WR)
            self.assertEqual(client.recv(64),b.ACK[0])
        finally:
            client.close();th.join(timeout=2)
        self.assertEqual(result,[b.ACK[0]])
    def test_padded_command_denied(self):
        r,c,e=self.serve_pair(cmd=b.COMMAND+b"x")
        self.assertEqual(r,b"");self.assertFalse(c);self.assertTrue(e)
    def test_stop_readback_denied(self):
        r,c,e=self.serve_pair(ack=b"NO")
        self.assertEqual(r,b"");self.assertEqual(c,[b.BROKER]);self.assertTrue(e)
    def test_wire_command_is_precisely_pre_relock_stop_not_relock_receipt(self):
        self.assertEqual(b.COMMAND,b"CST_GATEA_BEFORE_RELOCK_STOP_V1\n")
        self.assertNotIn(b"COMPLETE",b.COMMAND)
    def test_fixed_target_no_arbitrary_arguments(self):
        self.assertEqual(b.BROKER,"cst-onejob-gatea-preapproval-broker.service")
        self.assertNotIn("service",b.COMMAND.decode().lower())
    def test_real_kernel_peer_creds_available(self):
        server,client=socket.socketpair()
        try:
            pid,uid,gid=b._peercred(server)
            self.assertEqual(pid,os.getpid())
            self.assertEqual(uid,os.geteuid())
            self.assertEqual(gid,os.getegid())
        finally:
            server.close();client.close()
    def test_notify_noncanonical_socket_denied(self):
        with self.assertRaisesRegex(b.StopBridgeDenied,"NONCANONICAL_SOCKET"):
            b.notify_stage_stop("/tmp/untrusted.sock")
    def test_notify_fails_closed_when_socket_absent(self):
        # Never touch any real systemd socket, even after future installation.
        with tempfile.TemporaryDirectory(prefix="gatea-absent-sock-") as folder:
            unused=os.path.join(folder,"does-not-exist.sock")
            with patch.object(b,"SOCKET_PATH",unused):
                with self.assertRaisesRegex(b.StopBridgeDenied,"BRIDGE_NO_ACK"):
                    b.notify_stage_stop(unused)
    def test_exact_stop_if_broker_missing(self):
        with patch.object(b,"_unit_property",return_value="not-found") as check:
            self.assertEqual(b.stop_exact_stage_broker(),b.ACK[1])
        check.assert_called_once_with(b.BROKER,"LoadState")
    def test_source_contains_exact_broker_socket_guard(self):
        self.assertEqual(b.BROKER_SOCKET,"/run/cst-onejob-stage-db/pg-pooler.sock")
    def test_stale_broker_socket_rejects_clean_ack(self):
        with patch.object(b,"_unit_property",return_value="not-found"), \
             patch.object(b.os.path,"lexists",return_value=True):
            with self.assertRaisesRegex(b.StopBridgeDenied,"BROKER_SOCKET_STILL_PRESENT"):
                b.stop_exact_stage_broker()
    def test_stop_active_exact_unit_readback(self):
        def state(unit,prop):
            self.assertEqual(unit,b.BROKER)
            return {"LoadState":"loaded","ActiveState":"active"}[prop] if count[0]==0 else {"LoadState":"loaded","ActiveState":"inactive"}[prop]
        count=[0]
        def command(*args):
            self.assertEqual(args,("/usr/bin/systemctl","stop",b.BROKER))
            count[0]+=1
            class Result:returncode=0
            return Result()
        with patch.object(b,"_unit_property",side_effect=state),patch.object(b,"_execute",side_effect=command):
            self.assertEqual(b.stop_exact_stage_broker(),b.ACK[0])
        self.assertEqual(count[0],1)
    def test_loaded_but_unstoppable_broker_is_denied(self):
        with patch.object(b,"_unit_property",side_effect=lambda unit,prop: "loaded" if prop=="LoadState" else "active"):
            class Fail:returncode=1
            with patch.object(b,"_execute",return_value=Fail()):
                with self.assertRaisesRegex(b.StopBridgeDenied,"BROKER_STOP_FAILED"):
                    b.stop_exact_stage_broker()
    def test_real_notify_and_serve_on_temp_path_via_pinned_client_override(self):
        # In tests only: emulate the canonical address with a temporary socket;
        # production notify_stage_stop accepts ONLY the pinned /run path.
        with tempfile.TemporaryDirectory(prefix="cst-gatea-relay-qa-") as directory:
            sockpath=os.path.join(directory,"test.sock")
            listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
            listener.bind(sockpath);listener.listen(1)
            result=[]
            def server():
                try:
                    conn,_=listener.accept()
                    with conn:
                        result.append(b.serve_one(conn,
                            peer_reader=lambda _:(1234,9999,9999),
                            pid_reader=lambda:1234,
                            membership_checker=lambda _:True,
                            stop_broker=lambda:b.ACK[0]))
                finally:listener.close()
            t=threading.Thread(target=server,daemon=True);t.start()
            try:
                with patch.object(b,"SOCKET_PATH",sockpath):
                    self.assertEqual(b.notify_stage_stop(sockpath),
                         {"service":b.BROKER,"active":False,"socketPresent":False})
            finally:t.join(timeout=3)
            self.assertEqual(result,[b.ACK[0]])
            self.assertFalse(t.is_alive())
if __name__=="__main__":
    unittest.main(verbosity=2)
