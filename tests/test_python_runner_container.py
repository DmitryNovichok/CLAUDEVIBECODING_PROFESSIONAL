"""Acceptance tests for an INSTALLED isolated runtime, never a host fallback.

Run as the dedicated non-root ege-python account with EGE_RUNNER_IMAGE set to
the immutable local image ID. Direct execution ALWAYS requires the runtime and
all four tests without skips. Ordinary unit-test discovery may omit the runtime.
These programs execute only through the enforced Podman boundary.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import buglab_verifier

spec = importlib.util.spec_from_file_location('ege_container_executor', ROOT / 'deploy/python-runner/python_executor.py')
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)


REQUIRED = __name__ == '__main__' or os.environ.get('EGE_RUNNER_REQUIRED') == '1'


@unittest.skipUnless(os.environ.get('EGE_RUNNER_IMAGE') or REQUIRED,
                     'Requires explicitly provisioned rootless runner; no host execution fallback')
class RealContainerTest(unittest.TestCase):
    isolation = {}

    @classmethod
    def setUpClass(cls):
        image = os.environ.get('EGE_RUNNER_IMAGE')
        if not image:
            raise RuntimeError('EGE_RUNNER_IMAGE must identify the installed immutable runner image')
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.executor = broker.PodmanExecutor(image, cls.tmp.name)
        cls.executor.preflight()  # Failure here is a FAILED deployment, not a skip.
        # CI/operator acceptance also exercises the installed broker protocol.
        # Tests needing precise resource outcomes use the same container executor.
        path = os.environ.get('EGE_RUNNER_SOCKET')
        cls.client = buglab_verifier.Client(path=path) if path else cls.executor

    def test_reference_program_passes_independently_and_broken_program_fails(self):
        # Synthetic fixture only: do not install the application's answer bank
        # under the executor account just to accept a deployment.
        inputs = ['1 2 3 4', '8', '-2 -1 0 1 2', '']
        expected = ['6\n', '8\n', '0\n', '0\n']
        correct = 'import sys\nprint(sum(n for n in map(int, sys.stdin.read().split()) if n % 2 == 0))'
        broken = 'import sys\nprint(sum(n for n in map(int, sys.stdin.read().split()) if n % 2 != 0))'
        good = self.client.execute(correct, inputs)
        bad = self.client.execute(broken, inputs)
        self.assertTrue(all(item['status'] == 'ok' for item in good + bad))
        self.assertEqual([item['out'] for item in good], expected)
        self.assertNotEqual([item['out'] for item in bad], expected)

    def test_no_host_files_secrets_network_or_root_writes(self):
        secret = Path(self.tmp.name) / 'host-secret'
        secret.write_text('not-mounted')
        listener = socket.socket()
        self.addCleanup(listener.close)
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        listener.setblocking(False)
        port = listener.getsockname()[1]
        code = f'''import json, os, socket
from pathlib import Path
cgroup = Path('/sys/fs/cgroup')
print(json.dumps({{'uid': os.getuid(),
 'network_interfaces': sorted(os.listdir('/sys/class/net')),
 'memory_max': int((cgroup / 'memory.max').read_text()),
 'memory_swap_max': int((cgroup / 'memory.swap.max').read_text()),
 'pids_max': int((cgroup / 'pids.max').read_text()),
 'cpu_max': (cgroup / 'cpu.max').read_text().strip()}}))
print(os.path.exists({str(secret)!r}))
print(os.path.exists('/opt/trainer/server_data'))
print('EGE_SECRET' in os.environ)
try:
 open('/root/escape', 'w').write('bad')
 print('root-write')
except OSError:
 print('readonly')
try:
 socket.create_connection(('127.0.0.1', {port}), timeout=.2)
 print('network')
except OSError:
 print('no-network')
'''
        with mock.patch.dict(os.environ, {'EGE_SECRET': 'synthetic-host-secret-must-not-cross'}):
            result = self.executor.run_one(code, '')
        self.assertEqual(result['status'], 'ok')
        proof, remainder = result['out'].split('\n', 1)
        observed = json.loads(proof)
        self.assertEqual(observed['uid'], 65534)
        self.assertEqual(observed['network_interfaces'], ['lo'])
        self.assertEqual(observed['memory_max'], 256 * 1024 * 1024)
        self.assertEqual(observed['memory_swap_max'], 0)
        self.assertEqual(observed['pids_max'], 32)
        quota, period = map(int, observed['cpu_max'].split())
        self.assertTrue(0 < quota <= period)
        type(self).isolation = observed
        self.assertEqual(remainder, 'False\nFalse\nFalse\nreadonly\nno-network\n')
        with self.assertRaises(BlockingIOError):
            connection, _ = listener.accept()
            connection.close()

    def test_timeout_output_flood_and_memory_limit_never_become_success(self):
        timeout = self.executor.run_one('while True: pass', '')
        self.assertNotEqual(timeout['status'], 'ok')
        flood = self.executor.run_one("while True: print('x' * 4000)", '')
        self.assertEqual(flood['status'], 'output_limit')
        memory = self.executor.run_one("x = bytearray(512 * 1024 * 1024)\nprint('unlimited')", '')
        self.assertNotEqual(memory['status'], 'ok')
        self.assertNotIn('unlimited', memory['out'])

    def test_fresh_container_for_each_test(self):
        first = self.executor.run_one("open('/tmp/private', 'w').write('previous input')\nprint('saved')", '')
        second = self.executor.run_one("import os\nprint(os.path.exists('/tmp/private'))", '')
        self.assertEqual(first['status'], 'ok')
        self.assertEqual(second['out'], 'False\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Required acceptance of the installed isolated Python runner')
    parser.add_argument('--report', type=Path, help='Write machine-readable evidence, including failures')
    parser.add_argument('--source-revision', help='Revision being accepted, recorded without executing Git')
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RealContainerTest)
    test_ids = [test.id() for test in suite]
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = result.wasSuccessful() and result.testsRun == 4 and not result.skipped
    report = {
        'schema': 'egeshka.python-runner-acceptance.v1',
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'image': os.environ.get('EGE_RUNNER_IMAGE'),
        'source_revision': args.source_revision,
        'service_socket': os.environ.get('EGE_RUNNER_SOCKET'),
        'tests_run': result.testsRun, 'tests_failed': len(result.failures) + len(result.errors),
        'tests_skipped': len(result.skipped), 'test_ids': test_ids,
        'passed': passed, 'isolation': RealContainerTest.isolation,
        'failed_test_ids': [test.id() for test, _ in result.failures + result.errors],
    }
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not passed:
        print('Acceptance FAILED: all four real-container tests must pass without skips.', file=sys.stderr)
    raise SystemExit(0 if passed else 1)
