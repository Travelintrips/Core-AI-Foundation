"""Synthetic tests of the supported launcher; no units or secrets are accessed."""
import base64
import configparser
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import hashlib
import io
import os
from pathlib import Path
import stat
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import gpt02_reader_custodian_start as launcher


def configuration():
    values = {
        'APP_ENV': 'development', 'NODE_ENV': 'development',
        launcher.PREPARATION_FLAG: 'true',
        'SUPABASE_URL_DEV': 'https://xssrfshdrtdfupgqwfdw.supabase.co',
    }
    for name, byte in (('ATTESTOR', 1), ('ISSUER', 2)):
        der = bytes.fromhex('302a300506032b6570032100') + bytes([byte]) * 32
        prefix = 'GPT02_DEV_CUSTODY_' + name + '_PUBLIC_KEY_SPKI'
        values[prefix + '_B64'] = base64.b64encode(der).decode()
        values[prefix + '_SHA256'] = hashlib.sha256(der).hexdigest()
    return values


def encoded(values):
    return ('\n'.join(key + '=' + value for key, value in values.items()) + '\n').encode()


def metadata(directory=False, **changes):
    value = dict(
        st_mode=(stat.S_IFDIR | 0o755) if directory else (stat.S_IFREG | 0o600),
        st_uid=0, st_gid=0, st_nlink=1, st_size=1,
        st_dev=1, st_ino=2, st_mtime_ns=3, st_ctime_ns=4,
    )
    value.update(changes)
    return SimpleNamespace(**value)


@contextmanager
def public_config_descriptor(payload, file_changes=None, after_changes=None):
    descriptors = {}
    state = {'position': 0, 'file_stats': 0}
    changes = {'st_size': len(payload), **(file_changes or {})}

    def opened(path, flags, **kwargs):
        descriptor = 10 + len(descriptors)
        descriptors[descriptor] = path == launcher.CONFIG_FILE.name
        return descriptor

    def inspected(descriptor):
        if not descriptors[descriptor]:
            return metadata(directory=True)
        state['file_stats'] += 1
        extra = (after_changes or {}) if state['file_stats'] > 1 else {}
        return metadata(**{**changes, **extra})

    def read(descriptor, limit):
        start = state['position']
        result = payload[start:start + limit]
        state['position'] += len(result)
        return result

    with patch.object(launcher.os, 'open', side_effect=opened) as op, \
         patch.object(launcher.os, 'fstat', side_effect=inspected), \
         patch.object(launcher.os, 'read', side_effect=read) as rd, \
         patch.object(launcher.os, 'close') as close:
        yield op, rd, close, state


class PublicConfigurationTests(unittest.TestCase):
    def test_reads_only_fixed_protected_public_config_and_closes_descriptors(self):
        values = configuration()
        with public_config_descriptor(encoded(values)) as (op, rd, close, state):
            self.assertEqual(launcher._read_configuration(), values)
            self.assertTrue(rd.called)
            self.assertEqual(close.call_count, op.call_count)
            for call in op.call_args_list:
                self.assertTrue(call.args[1] & os.O_NOFOLLOW)
            self.assertEqual(op.call_args_list[-1].args[0], 'reader-custodian.env')

    def test_rejects_unsafe_file_before_reading(self):
        for change in ({'st_uid': 1}, {'st_gid': 1}, {'st_nlink': 2},
                       {'st_mode': stat.S_IFREG | 0o644}, {'st_mode': stat.S_IFLNK | 0o600},
                       {'st_size': 0}, {'st_size': 8193}):
            with self.subTest(change=change), public_config_descriptor(encoded(configuration()), change) as (_, rd, _, _):
                with self.assertRaisesRegex(launcher.LauncherDenied, 'CONFIG_INVALID'):
                    launcher._read_configuration()
                rd.assert_not_called()

    def test_rejects_growth_or_metadata_change(self):
        payload = encoded(configuration())
        with public_config_descriptor(payload + b'x' * 9000, {'st_size': len(payload)}) as (_, rd, _, state):
            with self.assertRaisesRegex(launcher.LauncherDenied, 'CONFIG_INVALID'):
                launcher._read_configuration()
            self.assertLessEqual(state['position'], 8193)
        with public_config_descriptor(payload, after_changes={'st_ctime_ns': 99}):
            with self.assertRaisesRegex(launcher.LauncherDenied, 'CONFIG_INVALID'):
                launcher._read_configuration()

    def test_rejects_unknown_duplicate_shell_quoted_or_invalid_utf8_configuration(self):
        payload = encoded(configuration())
        for extra in (b'PASSWORD=synthetic\n', b'APP_ENV=development\n', b'NODE_OPTIONS=--require=x\n',
                      b' EXTRA=value\n', b'APP_ENV="development"\n', b'APP_ENV=development\\\n', b'\xff'):
            with self.subTest(extra=extra), public_config_descriptor(payload + extra):
                with self.assertRaisesRegex(launcher.LauncherDenied, 'CONFIG_INVALID'):
                    launcher._read_configuration()


class LauncherOrderingTests(unittest.TestCase):
    def test_non_root_denied_before_even_public_config_io(self):
        for uid, gid in ((1, 0), (0, 1)):
            with self.subTest(uid=uid, gid=gid), \
                 patch.object(launcher.os, 'geteuid', return_value=uid), \
                 patch.object(launcher.os, 'getegid', return_value=gid), \
                 patch.object(launcher, '_read_configuration') as read, \
                 patch.object(launcher.subprocess, 'run') as run:
                with self.assertRaisesRegex(launcher.LauncherDenied, 'ROOT_REQUIRED'):
                    launcher.prepare_custodian()
                read.assert_not_called(); run.assert_not_called()

    def test_disabled_malformed_or_wrong_environment_starts_no_unit_and_inspects_no_input(self):
        changes = [
            {launcher.PREPARATION_FLAG: flag} for flag in ('false', '"true"', ' true', 'TRUE')
        ] + [{'APP_ENV': 'production'}, {'NODE_ENV': 'production'}, {'SUPABASE_URL_DEV': 'https://wrong.supabase.co'}]
        for change in changes:
            with self.subTest(change=change), \
                 patch.object(launcher.os, 'geteuid', return_value=0), \
                 patch.object(launcher.os, 'getegid', return_value=0), \
                 patch.object(launcher, '_read_configuration', return_value={**configuration(), **change}), \
                 patch.object(launcher, '_validate_public_inputs') as inputs, \
                 patch.object(launcher.subprocess, 'run') as run:
                with self.assertRaises(launcher.LauncherDenied):
                    launcher.prepare_custodian()
                inputs.assert_not_called(); run.assert_not_called()

    def test_invalid_or_reused_public_pins_stop_before_input_inspection(self):
        values = configuration()
        variants = [{**values, 'GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256': '0' * 64}]
        same = dict(values)
        for suffix in ('B64', 'SHA256'):
            same['GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_' + suffix] = values['GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_' + suffix]
        variants.append(same)
        for candidate in variants:
            with self.subTest(candidate=candidate), patch.object(launcher.os, 'geteuid', return_value=0), \
                 patch.object(launcher.os, 'getegid', return_value=0), \
                 patch.object(launcher, '_read_configuration', return_value=candidate), \
                 patch.object(launcher, '_validate_public_inputs') as inputs, \
                 patch.object(launcher.subprocess, 'run') as run:
                with self.assertRaisesRegex(launcher.LauncherDenied, 'TRUST_INVALID'):
                    launcher.prepare_custodian()
                inputs.assert_not_called(); run.assert_not_called()

    def test_supported_callsite_only_starts_exact_reader_then_custodian_after_validation(self):
        with patch.object(launcher.os, 'geteuid', return_value=0), \
             patch.object(launcher.os, 'getegid', return_value=0), \
             patch.object(launcher, '_read_configuration', return_value=configuration()), \
             patch.object(launcher, '_validate_public_inputs') as inputs, \
             patch.object(launcher.subprocess, 'run') as run:
            launcher.prepare_custodian()
            self.assertEqual(inputs.call_count, 2)
            self.assertEqual([c.args[0] for c in run.call_args_list], [
                ['systemctl', 'start', 'gpt02-owner-ledger-credential-loader.service'],
                ['systemctl', 'start', 'gpt02-reader-custodian.service'],
            ])
            for call in run.call_args_list:
                self.assertTrue(call.kwargs['check'])
                self.assertEqual(call.kwargs['stdout'], subprocess.DEVNULL)
                self.assertEqual(call.kwargs['stderr'], subprocess.DEVNULL)
                self.assertNotIn('shell', call.kwargs)

    def test_withdrawn_opt_in_or_changed_valid_pin_during_reader_wait_stops_second_unit(self):
        original = configuration()
        changed_pin = dict(original)
        der = bytes.fromhex('302a300506032b6570032100') + bytes([3]) * 32
        changed_pin['GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64'] = base64.b64encode(der).decode()
        changed_pin['GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256'] = hashlib.sha256(der).hexdigest()
        cases = [({**original, launcher.PREPARATION_FLAG: 'false'}, 'DISABLED'),
                 (changed_pin, 'CONFIG_CHANGED')]
        for changed, code in cases:
            with self.subTest(code=code), patch.object(launcher.os, 'geteuid', return_value=0), \
                 patch.object(launcher.os, 'getegid', return_value=0), \
                 patch.object(launcher, '_read_configuration', side_effect=[original, changed]), \
                 patch.object(launcher, '_validate_public_inputs') as inputs, \
                 patch.object(launcher.subprocess, 'run') as run:
                with self.assertRaisesRegex(launcher.LauncherDenied, code):
                    launcher.prepare_custodian()
                run.assert_called_once()
                self.assertEqual(run.call_args.args[0], ['systemctl', 'start', launcher.READER_LOADER_UNIT])
                inputs.assert_called_once()

    def test_first_unit_failure_prevents_custodian_and_timeout_is_not_retried(self):
        for error in (subprocess.CalledProcessError(1, 'synthetic'), subprocess.TimeoutExpired('synthetic', 30)):
            with self.subTest(error=type(error)), patch.object(launcher.os, 'geteuid', return_value=0), \
                 patch.object(launcher.os, 'getegid', return_value=0), \
                 patch.object(launcher, '_read_configuration', return_value=configuration()), \
                 patch.object(launcher, '_validate_public_inputs'), \
                 patch.object(launcher.subprocess, 'run', side_effect=error) as run:
                with self.assertRaisesRegex(launcher.LauncherDenied, 'START_FAILED'):
                    launcher.prepare_custodian()
                run.assert_called_once()

    def test_public_preflight_needs_worker_and_ca_but_not_dba_proof_or_reader_contents(self):
        with patch.object(Path, 'lstat', return_value=metadata(directory=True, st_mode=stat.S_IFDIR | 0o700)), \
             patch.object(launcher, '_regular_root_file', return_value=True) as regular:
            launcher._validate_public_inputs()
            self.assertEqual([c.args[0] for c in regular.call_args_list], [launcher.WORKER_PROOF, launcher.TRUST_CA])
        for outcomes, code in (([False], 'PROOF_UNAVAILABLE'), ([True, False], 'CA_UNAVAILABLE')):
            with self.subTest(code=code), patch.object(Path, 'lstat', return_value=metadata(directory=True, st_mode=stat.S_IFDIR | 0o700)), \
                 patch.object(launcher, '_regular_root_file', side_effect=outcomes):
                with self.assertRaisesRegex(launcher.LauncherDenied, code):
                    launcher._validate_public_inputs()

    def test_cli_rejects_arguments_and_redacts_unknown_exceptions(self):
        marker = 'SYNTHETIC_PRIVATE_DIAGNOSTIC'
        for args, error in ((['--config', marker], None), ([], RuntimeError(marker))):
            out, err = io.StringIO(), io.StringIO()
            with patch.object(launcher, 'prepare_custodian', side_effect=error) as prepare, redirect_stdout(out), redirect_stderr(err):
                self.assertEqual(launcher.main(args), 1)
                self.assertEqual(out.getvalue(), '')
                self.assertNotIn(marker, err.getvalue())
                self.assertTrue(err.getvalue().startswith('GPT02_DBA_PREPARATION=BLOCKED code='))
                if args:
                    prepare.assert_not_called()

    def test_unit_is_static_without_early_dependencies_or_shared_directory_cleanup(self):
        root = Path(__file__).resolve().parents[2]
        cfg = configparser.ConfigParser(interpolation=None, strict=False)
        cfg.read(root / 'deploy/ai-coding-standalone-dev/gpt02-reader-custodian.service')
        self.assertNotIn('Install', cfg)
        self.assertNotIn('Requires', cfg['Unit'])
        self.assertNotIn('RuntimeDirectory', cfg['Service'])
        self.assertEqual(cfg['Service']['Type'], 'oneshot')
        self.assertIn(cfg['Service'].get('RemainAfterExit'), (None, 'no', 'false'))
        self.assertEqual(cfg['Service']['ExecStart'], '/usr/bin/node /usr/local/libexec/cst-dev/gpt02-reader-custodian-runtime.cjs')
        self.assertEqual(cfg['Service']['LoadCredentialEncrypted'], 'private-key.pkcs8:/etc/credstore.encrypted/gpt02-reader-custody-dba-issuer.pkcs8')
        example = root / 'deploy/ai-coding-standalone-dev/gpt02-reader-custodian.env.example'
        self.assertIn(launcher.PREPARATION_FLAG + '=false', example.read_text())


if __name__ == '__main__':
    unittest.main()
