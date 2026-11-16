"""No pupil program executes on the host. Container tests are separately opt-in."""
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import pwd
import socket
import struct
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import buglab
import buglab_verifier as client
import python_runner_protocol as wire


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'deploy/python-runner' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


broker = module('ege_test_executor', 'python_executor.py')
entry = module('ege_test_entrypoint', 'entrypoint.py')
IMAGE = 'sha256:' + '1' * 64


class ProtocolTest(unittest.TestCase):
    def receive(self, data):
        a, b = socket.socketpair()
        try:
            a.sendall(data); a.shutdown(socket.SHUT_WR)
            return wire.recv_frame(b, 1000, 1)
        finally:
            a.close(); b.close()

    def test_rejects_oversized_truncated_duplicate_and_nonfinite_messages(self):
        for data in (struct.pack('!I', 1001), struct.pack('!I', 5) + b'{}',
                     struct.pack('!I', 13) + b'{"v":1,"v":1}', struct.pack('!I', 9) + b'{"a":NaN}'):
            with self.subTest(data=data), self.assertRaises(wire.ProtocolError):
                self.receive(data)

    def test_request_cannot_set_runtime_flags_paths_or_expected_answers(self):
        code, inputs = 'print(42)', ['']
        value = {'v': 1, 'nonce': 'a' * 32, 'digest': wire.digest(code, inputs), 'code': code, 'inputs': inputs}
        self.assertEqual(broker.request_value(value), (code, inputs))
        for key in ('image', 'command', 'mount', 'expected', 'runs', 'verified'):
            with self.subTest(key=key), self.assertRaises(wire.ProtocolError):
                broker.request_value(dict(value, **{key: 'attacker'}))
        with self.assertRaises(wire.ProtocolError):
            broker.request_value(dict(value, digest='bad'))

    def test_code_and_input_limits_reject_instead_of_truncating(self):
        for code, inputs in (('', ['']), ('x' * (wire.MAX_CODE + 1), ['']), ('print(1)', []),
                             ('print(1)', [''] * 13), ('print(1)', ['x' * (wire.MAX_INPUT + 1)])):
            with self.subTest(code=len(code), inputs=len(inputs)), self.assertRaises(wire.ProtocolError):
                wire.program(code, inputs)


class SocketClientTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / 'runner.sock')
        self.calls = []
        owner = self

        class FakeExecutor:
            def execute(self, code, inputs):
                owner.calls.append((code, inputs))
                if code == 'UNAVAILABLE':
                    raise broker.RuntimeUnavailable('offline')
                return [{'status': 'ok', 'out': '42\n', 'err': '', 'exit_code': 0} for _ in inputs]

        try:
            self.server = broker.Server(self.path, FakeExecutor(), {os.geteuid()})
        except PermissionError:
            self.tmp.cleanup()
            if os.environ.get('CI'):
                raise
            self.skipTest('This workspace prohibits AF_UNIX listeners; run the real socket tests in CI')
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()
        self.client = client.Client(self.path, pwd.getpwuid(os.geteuid()).pw_name, timeout=2)

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=2)
        self.tmp.cleanup()

    def test_real_unix_protocol_is_bound_to_code_and_server_inputs(self):
        result = self.client.execute('print(42)', ['server-test'])
        self.assertEqual(result[0]['out'], '42\n')
        self.assertEqual(self.calls, [('print(42)', ['server-test'])])

    def test_unavailable_runtime_and_missing_socket_fail_closed(self):
        with self.assertRaises(client.VerifierUnavailable):
            self.client.execute('UNAVAILABLE', [''])
        with self.assertRaises(client.VerifierUnavailable):
            client.Client(self.path + '-missing', self.client.user).execute('print(42)', [''])

    def test_busy_queue_never_accepts_another_job(self):
        self.server.slots.acquire(); self.server.slots.acquire()
        try:
            with self.assertRaises(client.VerifierBusy):
                self.client.execute('print(42)', [''])
            self.assertEqual(self.calls, [])
        finally:
            self.server.slots.release(); self.server.slots.release()

    def test_wrong_peer_and_world_accessible_socket_are_rejected(self):
        with patch.object(wire, 'peer_uid', return_value=os.geteuid() + 1), self.assertRaises(client.VerifierUnavailable):
            self.client.execute('print(42)', [''])
        os.chmod(self.path, 0o666)
        with self.assertRaises(client.VerifierUnavailable):
            self.client.execute('print(42)', [''])

    def test_mismatched_or_partial_reply_never_verifies(self):
        for reply in ({'v': 1, 'status': 'complete', 'runs': []}, {'status': 'self_check', 'verified': True}):
            with patch.object(wire, 'recv_frame', return_value=reply), self.assertRaises(client.VerifierUnavailable):
                self.client.execute('print(42)', [''])


class VerificationTest(unittest.TestCase):
    def test_server_answers_compare_independent_outputs_only(self):
        case = buglab.BY_ID['even-sum']

        class FakeIndependentService:
            def execute(_, code, inputs):
                self.assertEqual(inputs, case['inputs'])
                return [{'out': expected if code == case['ref'] else 'wrong'} for expected in case['expected']]

        verdict = client.verify(case, case['ref'], FakeIndependentService())
        self.assertTrue(verdict['ok']); self.assertTrue(verdict['verified'])
        self.assertEqual(verdict['provenance'], 'server_python')
        self.assertFalse(client.verify(case, case['code'], FakeIndependentService())['ok'])
        self.assertNotIn('exp', verdict['tests'][-1])

    def test_forged_good_stdout_with_error_status_is_not_a_success(self):
        for status in ('error', 'timeout', 'output_limit', 'skipped'):
            result = client._result({'status': status, 'out': '42', 'err': '', 'exit_code': 0})
            self.assertTrue(result['err'])
        with self.assertRaises(wire.ProtocolError):
            client._result({'status': 'ok', 'out': '42', 'err': '', 'exit_code': 1})


class ExecutorTest(unittest.TestCase):
    def test_execution_has_fixed_limits_and_no_user_supplied_shell_or_mount(self):
        executor = broker.PodmanExecutor(IMAGE, '/private/jobs')
        command = executor.command(Path('/private/jobs/fixed.py'), 'ege-verify-' + 'a' * 32)
        for flag in ('--network=none', '--read-only', '--cap-drop=all', '--security-opt=no-new-privileges',
                     '--user=65534:65534', '--pids-limit=32', '--memory=256m', '--memory-swap=256m',
                     '--cpus=1', '--pull=never', '--timeout=8', '--unsetenv-all'):
            self.assertIn(flag, command)
        self.assertNotIn('--privileged', command)
        self.assertNotIn('--dns=none', command)  # incompatible with --network=none
        self.assertEqual(sum(x.startswith('--volume=') for x in command), 1)
        self.assertTrue(next(x for x in command if x.startswith('--volume=')).endswith(':/sandbox/main.py:ro,Z'))
        with self.assertRaises(broker.RuntimeUnavailable):
            broker.PodmanExecutor('python:latest', '/private/jobs')

    def test_correct_output_without_isolation_attestation_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            executor = broker.PodmanExecutor(IMAGE, directory)
            with patch.object(broker, 'bounded_process', side_effect=[(0, b'42\n', b'', 'ok'), (0, b'', b'', 'ok')]), self.assertRaises(broker.RuntimeUnavailable):
                executor.run_one('print(42)', '')

    def test_cleanup_failure_stops_further_submissions(self):
        with tempfile.TemporaryDirectory() as directory:
            executor = broker.PodmanExecutor(IMAGE, directory)
            with patch.object(broker, 'bounded_process', side_effect=[(0, b'42\n', broker.MARKER, 'ok'), (1, b'', b'', 'ok')]), self.assertRaises(broker.RuntimeUnavailable):
                executor.run_one('print(42)', '')
            with self.assertRaises(broker.RuntimeUnavailable):
                executor.execute('print(42)', [''])

    def test_supervisor_bounds_output_stdin_and_wall_time(self):
        # These are fixed trusted OS utilities, not submitted Python programs.
        rc, out, _, status = broker.bounded_process(['/bin/cat'], b'fixed input', 1, 100, 100)
        self.assertEqual((rc, out, status), (0, b'fixed input', 'ok'))
        _, out, _, status = broker.bounded_process(['/usr/bin/head', '-c', '100000', '/dev/zero'], b'', 1, 50, 100)
        self.assertEqual((len(out), status), (50, 'output_limit'))
        _, _, _, status = broker.bounded_process(['/bin/sleep', '2'], b'x' * 16000, .05, 100, 100)
        self.assertEqual(status, 'timeout')

    def test_preflight_rejects_root_and_absent_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            executor = broker.PodmanExecutor(IMAGE, directory)
            with patch.object(os, 'geteuid', return_value=0), self.assertRaises(broker.RuntimeUnavailable):
                executor.preflight()
            with patch.object(os, 'geteuid', return_value=1234), patch.object(broker, 'bounded_process', side_effect=FileNotFoundError), self.assertRaises(broker.RuntimeUnavailable):
                executor.preflight()


class AttestationTest(unittest.TestCase):
    def check_fixture(self, overrides=None, network=None):
        values = {'/proc/self/status': 'CapEff:\t00000000\nCapBnd:\t00000000\nNoNewPrivs:\t1\nSeccomp:\t2\n',
                  '/sys/fs/cgroup/memory.max': str(256 * 1024 * 1024), '/sys/fs/cgroup/memory.swap.max': '0',
                  '/sys/fs/cgroup/pids.max': '32', '/sys/fs/cgroup/cpu.max': '100000 100000',
                  '/proc/self/mountinfo': '1 0 0:1 / / ro - overlay overlay ro\n2 1 0:2 / /sandbox/main.py ro - ext4 /dev/vda ro\n'}
        values.update(overrides or {})
        limits = {entry.resource.RLIMIT_CPU: (2, 3), entry.resource.RLIMIT_NOFILE: (32, 32),
                  entry.resource.RLIMIT_FSIZE: (1048576, 1048576), entry.resource.RLIMIT_CORE: (0, 0)}
        with patch.object(entry.os, 'getuid', return_value=65534), patch.object(entry.os, 'getgid', return_value=65534), \
                patch.object(entry.os, 'getpid', return_value=1), patch.object(entry.os, 'listdir', return_value=network or ['lo']), \
                patch.object(entry.Path, 'read_text', autospec=True, side_effect=lambda p: values[str(p)]), \
                patch.object(entry.Path, 'is_file', return_value=True), patch.object(entry.resource, 'getrlimit', side_effect=lambda key: limits[key]):
            entry.check()

    def test_attestation_rejects_unlimited_or_missing_actual_constraints(self):
        self.check_fixture()
        for path, content in (('/sys/fs/cgroup/memory.max', 'max'), ('/sys/fs/cgroup/memory.swap.max', '100'),
                              ('/sys/fs/cgroup/pids.max', 'max'), ('/sys/fs/cgroup/cpu.max', 'max 100000'),
                              ('/sys/fs/cgroup/cpu.max', '200000 100000'),
                              ('/proc/self/mountinfo', '1 0 0:1 / / rw - overlay overlay rw\n'),
                              ('/proc/self/status', 'CapEff:\t1\nCapBnd:\t1\nNoNewPrivs:\t0\nSeccomp:\t0\n')):
            with self.subTest(path=path), self.assertRaises((RuntimeError, ValueError)):
                self.check_fixture({path: content})
        with self.assertRaises(RuntimeError):
            self.check_fixture(network=['lo', 'eth0'])

    def test_failed_real_limits_never_reach_execve(self):
        with patch.object(entry, 'check', side_effect=RuntimeError('missing cgroup')), patch.object(entry.os, 'execve') as execute, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(entry.main(), 125)
            execute.assert_not_called()

    def test_entrypoint_clears_environment_before_interpreter(self):
        with patch.object(entry, 'check'), patch.object(entry.os, 'write'), patch.object(entry.os, 'execve') as execute:
            entry.main()
            path, args, env = execute.call_args.args
            self.assertEqual(path, '/usr/local/bin/python3')
            self.assertEqual(args[-1], '/sandbox/main.py')
            self.assertEqual(set(env), {'PATH', 'LANG', 'PYTHONHASHSEED'})


if __name__ == '__main__':
    unittest.main()
