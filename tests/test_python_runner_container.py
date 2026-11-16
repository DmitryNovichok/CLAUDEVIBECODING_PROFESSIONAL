"""Acceptance tests for an INSTALLED isolated runtime, never a host fallback.

Run as the dedicated non-root ege-python account with EGE_RUNNER_IMAGE set to
the immutable local image ID. Missing opt-in skips; an opted-in broken runtime
FAILS. These programs execute only through the enforced Podman boundary.
"""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import buglab
import buglab_verifier

spec = importlib.util.spec_from_file_location('ege_container_executor', ROOT / 'deploy/python-runner/python_executor.py')
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)


@unittest.skipUnless(os.environ.get('EGE_RUNNER_IMAGE'), 'Requires explicitly provisioned rootless runner; no host execution fallback')
class RealContainerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.executor = broker.PodmanExecutor(os.environ['EGE_RUNNER_IMAGE'], cls.tmp.name)
        cls.executor.preflight()  # Failure here is a FAILED deployment, not a skip.

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_reference_program_passes_independently_and_broken_program_fails(self):
        case = buglab.BY_ID['even-sum']
        self.assertTrue(buglab_verifier.verify(case, case['ref'], self.executor)['ok'])
        self.assertFalse(buglab_verifier.verify(case, case['code'], self.executor)['ok'])

    def test_no_host_files_secrets_network_or_root_writes(self):
        secret = Path(self.tmp.name) / 'host-secret'
        secret.write_text('not-mounted')
        code = f'''import os, socket
print(os.getuid())
print(os.path.exists({str(secret)!r}))
print(os.path.exists('/opt/trainer/server_data'))
print('EGE_SECRET' in os.environ)
try:
 open('/root/escape', 'w').write('bad')
 print('root-write')
except OSError:
 print('readonly')
try:
 socket.create_connection(('192.0.2.1', 80), timeout=.2)
 print('network')
except OSError:
 print('no-network')
'''
        result = self.executor.run_one(code, '')
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['out'], '65534\nFalse\nFalse\nFalse\nreadonly\nno-network\n')

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
    unittest.main()
