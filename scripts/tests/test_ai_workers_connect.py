"""Offline regression tests. No real Docker, cloud credentials or LLM requests."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'connect-ai-workers-to-aicore.sh'


class WorkerVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        scripts = self.root / 'scripts'
        scripts.mkdir()
        self.script = scripts / SOURCE.name
        shutil.copyfile(SOURCE, self.script)
        (scripts / 'ai-workers-healthcheck.sh').write_text(
            '#!/usr/bin/env bash\necho host-health-check\nexit "${FAKE_HEALTH_EXIT:-0}"\n'
        )
        self.envfile = self.root / 'worker.env'
        self.original = b'AI_CORE_SCOPED_AGENT_TOKEN=ci-only-not-a-real-token\n'
        self.envfile.write_bytes(self.original)
        self.log = self.root / 'docker-calls.jsonl'
        bindir = self.root / 'bin'
        bindir.mkdir()
        docker = bindir / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
with pathlib.Path(os.environ['FAKE_DOCKER_LOG']).open('a') as log:
    log.write(json.dumps(args) + '\\n')
if args[-2:] == ['config', 'validate']:
    sys.exit(int(os.environ.get('FAKE_CONFIG_EXIT', '0')))
if 'agent' in args:
    print('FAKE_INTERNAL_PROVIDER_DIAGNOSTIC_MUST_NOT_LEAK')
    sys.exit(int(os.environ.get('FAKE_AGENT_EXIT', '0')))
print('Unexpected Docker action', file=sys.stderr)
sys.exit(98)
''')
        docker.chmod(0o755)
        for name, body in {
            'curl': '#!/usr/bin/env bash\necho unexpected-network >&2\nexit 97\n',
            'openssl': '#!/usr/bin/env bash\necho 00112233\n',
        }.items():
            target = bindir / name
            target.write_text(body)
            target.chmod(0o755)
        self.env = {
            **os.environ,
            'PATH': str(bindir) + os.pathsep + os.environ['PATH'],
            'AI_WORKERS_ENV_FILE': str(self.envfile),
            'FAKE_DOCKER_LOG': str(self.log),
            'AI_WORKERS_SMOKE_TIMEOUT_SECONDS': '60',
            'FAKE_HEALTH_EXIT': '0',
            'FAKE_CONFIG_EXIT': '0',
            'FAKE_AGENT_EXIT': '0',
        }

    def run_verify(self, mode='verify', **overrides):
        command = ['bash', str(self.script)]
        if mode is not None:
            command.append(mode)
        result = subprocess.run(
            command, env={**self.env, **overrides}, text=True,
            capture_output=True, timeout=10, check=False,
        )
        self.assertEqual(self.envfile.read_bytes(), self.original)
        self.assertNotIn('ci-only-not-a-real-token', result.stdout + result.stderr)
        self.assertNotIn('FAKE_INTERNAL_PROVIDER_DIAGNOSTIC_MUST_NOT_LEAK',
                         result.stdout + result.stderr)
        return result

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_success_uses_running_gateway_without_reconfiguration(self):
        result = self.run_verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('openclaw-gateway-model=PASS', result.stdout)
        self.assertEqual(len(self.calls()), 2)
        for call in self.calls():
            self.assertIn('exec', call)
            self.assertNotIn('up', call)
            self.assertNotIn('run', call)
            self.assertNotIn('set', call)
        agent = self.calls()[1]
        self.assertNotIn('--local', agent)
        self.assertNotIn('--deliver', agent)
        self.assertIn('--json', agent)
        self.assertEqual(agent[agent.index('--timeout') + 1], '60')
        self.assertTrue(agent[agent.index('--session-id') + 1].startswith('aicore-verify-'))

    def test_default_mode_does_not_apply(self):
        result = self.run_verify(mode=None)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.calls()), 2)

    def test_host_health_pass_gateway_401_is_failure(self):
        result = self.run_verify(FAKE_AGENT_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('host-health-check', result.stdout)
        self.assertIn('gateway model smoke failed', result.stderr)
        self.assertNotIn('openclaw-gateway-model=PASS', result.stdout)

    def test_health_failure_skips_gateway(self):
        result = self.run_verify(FAKE_HEALTH_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_invalid_config_skips_model_request(self):
        result = self.run_verify(FAKE_CONFIG_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.calls()), 1)

    def test_invalid_timeouts_fail_before_requests(self):
        for value in ['0', '4', '121', '999', '9999999999', '-1', 'NaN', '10;false', '']:
            with self.subTest(value=value):
                result = self.run_verify(AI_WORKERS_SMOKE_TIMEOUT_SECONDS=value)
                if value == '':
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.log.unlink()
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(self.calls(), [])

    def test_valid_timeout_bounds_and_leading_zero(self):
        for value, expected in [('5', '5'), ('120', '120'), ('060', '60')]:
            with self.subTest(value=value):
                result = self.run_verify(AI_WORKERS_SMOKE_TIMEOUT_SECONDS=value)
                self.assertEqual(result.returncode, 0, result.stderr)
                agent = self.calls()[-1]
                self.assertEqual(agent[agent.index('--timeout') + 1], expected)

    def test_never_claims_unexecuted_workflows_or_coding_pass(self):
        result = self.run_verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        for component in ['openhands', 'n8n', 'temporal']:
            self.assertIn(component + '=HEALTH_ONLY', result.stdout)
        self.assertIn('commit/deploy automation not verified', result.stdout)


if __name__ == '__main__':
    unittest.main()
