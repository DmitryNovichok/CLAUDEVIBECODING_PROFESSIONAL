"""Dedicated Unix-socket broker: pupil code runs only in rootless Podman.

Install separately from /opt/trainer, under its own unprivileged service account.
No credentials, answer keys, account IDs or writable application mounts are used.
"""
import argparse
import json
import os
from pathlib import Path
import pwd
import re
import selectors
import signal
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import uuid

import python_runner_protocol as wire

MARKER = b'EGE_PYTHON_ISOLATED_V1\n'
WALL_SECONDS = 6
JOB_SECONDS = 80
MAX_ACTIVE = 2
IMAGE_ID = re.compile(r'^sha256:[0-9a-f]{64}$')


class RuntimeUnavailable(RuntimeError):
    pass


def environment():
    # Rootless Podman needs its own user manager/storage. Never forward web-server
    # secrets, proxy credentials, CONTAINER_HOST, arbitrary runtime flags, etc.
    allowed = ('HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS')
    return {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8',
            **{key: os.environ[key] for key in allowed if key in os.environ}}


def bounded_process(argv, data, timeout, stdout_limit, stderr_limit):
    """Bounded, nonblocking pipes; a program that never reads stdin cannot hang us."""
    process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env=environment(), start_new_session=True, close_fds=True)
    out, err = bytearray(), bytearray()
    status, offset, deadline = 'ok', 0, time.monotonic() + timeout
    with selectors.DefaultSelector() as selector:
        for stream, events, kind in ((process.stdin, selectors.EVENT_WRITE, 'in'),
                                     (process.stdout, selectors.EVENT_READ, 'out'), (process.stderr, selectors.EVENT_READ, 'err')):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, events, kind)
        try:
            while selector.get_map():
                left = deadline - time.monotonic()
                if left <= 0:
                    status = 'timeout'
                    break
                for key, _ in selector.select(min(left, 0.1)):
                    stream, kind = key.fileobj, key.data
                    if kind == 'in':
                        try:
                            if offset < len(data):
                                offset += os.write(stream.fileno(), data[offset:offset + 4096])
                            if offset == len(data):
                                selector.unregister(stream); stream.close()
                        except BrokenPipeError:
                            selector.unregister(stream); stream.close()
                        continue
                    chunk = os.read(stream.fileno(), 4096)
                    if not chunk:
                        selector.unregister(stream); stream.close()
                        continue
                    target, limit = (out, stdout_limit) if kind == 'out' else (err, stderr_limit)
                    if len(target) + len(chunk) > limit:
                        target.extend(chunk[:max(0, limit - len(target))])
                        status = 'output_limit'
                        break
                    target.extend(chunk)
                if status != 'ok':
                    break
            if status == 'ok':
                try:
                    process.wait(timeout=max(.01, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    status = 'timeout'
        finally:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                if not stream.closed:
                    stream.close()
    return process.returncode, bytes(out), bytes(err), status


class PodmanExecutor:
    def __init__(self, image, jobs, podman='/usr/bin/podman'):
        if not IMAGE_ID.fullmatch(image):
            raise RuntimeUnavailable('Runner image must be an immutable local sha256 image ID')
        self.image, self.jobs, self.podman = image, Path(jobs), podman
        self.failed = False

    def command(self, source, name):
        return [self.podman, '--remote=false', 'run', '--pull=never', '--rm', '--interactive',
                '--name=' + name, '--label=io.egeshka.verifier=1', '--timeout=8',
                '--network=none', '--ipc=none', '--pid=private', '--uts=private',
                # Rootless nomap creates the UID/GID mapping from subuid/subgid
                # while excluding the broker's own host identity. Bare private
                # has no mapping on Podman 4.9 and cannot start a container.
                '--userns=nomap', '--cgroupns=private', '--cgroups=enabled', '--user=65534:65534', '--privileged=false',
                '--cap-drop=all', '--security-opt=no-new-privileges', '--read-only', '--read-only-tmpfs=false',
                '--pids-limit=32', '--memory=256m', '--memory-swap=256m', '--cpus=1',
                '--ulimit=cpu=2:3', '--ulimit=nofile=32:32', '--ulimit=fsize=1048576:1048576', '--ulimit=core=0:0',
                '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777', '--log-driver=none',
                '--http-proxy=false', '--unsetenv-all', '--no-hosts', '--init=false',
                '--volume=' + str(source) + ':/sandbox/main.py:ro,Z',
                '--entrypoint=/usr/local/bin/python3', self.image,
                '-I', '-S', '-B', '/opt/ege-runner/entrypoint.py']

    def preflight(self):
        if os.geteuid() == 0:
            raise RuntimeUnavailable('Run the broker under its dedicated non-root account')
        try:
            rc, out, _, status = bounded_process([self.podman, '--remote=false', 'info', '--format=json'], b'', 10, 65536, 8192)
            info = json.loads(out)
            host = info['host']
            if (rc or status != 'ok' or host.get('cgroupVersion') != 'v2'
                    or host.get('security', {}).get('rootless') is not True
                    or host.get('security', {}).get('seccompEnabled') is not True):
                raise RuntimeUnavailable('Rootless Podman, seccomp and cgroup v2 are required')
            self.jobs.mkdir(parents=True, exist_ok=True, mode=0o700)
            if self.jobs.stat().st_uid != os.geteuid() or self.jobs.stat().st_mode & 0o077:
                raise RuntimeUnavailable('Runner jobs directory must be private to the broker')
            result = self.run_one("print('ege-verifier-ready')\n", '', diagnose=True)
            if result['status'] != 'ok' or result['out'] != 'ege-verifier-ready\n':
                raise RuntimeUnavailable('Runner attestation failed')
        except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
            raise RuntimeUnavailable('Isolated runtime unavailable') from exc

    def run_one(self, code, stdin, *, diagnose=False):
        name = 'ege-verify-' + uuid.uuid4().hex
        with tempfile.TemporaryDirectory(prefix='job-', dir=self.jobs) as job:
            source = Path(job) / 'main.py'
            source.write_text(code, encoding='utf-8')
            source.chmod(0o444)
            try:
                rc, out, err, status = bounded_process(self.command(source, name), stdin.encode('utf-8'),
                                                      WALL_SECONDS, wire.MAX_STDOUT, wire.MAX_STDERR + len(MARKER))
            except (OSError, subprocess.SubprocessError) as exc:
                raise RuntimeUnavailable('Container execution unavailable') from exc
            finally:
                # Killing the CLI alone does not stop an already-created container.
                # Remove the exact generated name, including on timeout/output limit.
                try:
                    clean_rc, _, _, clean_status = bounded_process(
                        [self.podman, '--remote=false', 'rm', '--force', '--ignore', '--time=0', name], b'', 5, 4096, 4096)
                    if clean_rc or clean_status != 'ok':
                        self.failed = True
                        raise RuntimeUnavailable('Container cleanup failed; no verdict is safe')
                except (OSError, subprocess.SubprocessError) as exc:
                    self.failed = True
                    raise RuntimeUnavailable('Container cleanup unavailable') from exc
        if not err.startswith(MARKER) or rc == 125:
            if diagnose:
                # Only preflight's fixed trusted program enables diagnostics.
                # Ordinary submissions never log code, input or output here.
                print('Independent Python runner preflight: ' + json.dumps({
                    'exit_code': rc, 'status': status,
                    'stderr': err.decode('utf-8', 'replace'),
                }, ensure_ascii=True), file=sys.stderr)
            raise RuntimeUnavailable('Container did not attest enforced isolation')
        err = err[len(MARKER):]
        if status == 'ok' and (rc or err):
            status = 'error'
        messages = {'timeout': 'Превышено время выполнения', 'output_limit': 'Слишком большой вывод программы'}
        return {'status': status, 'out': out.decode('utf-8', 'replace'),
                'err': messages.get(status, err.decode('utf-8', 'replace')),
                'exit_code': max(-255, min(255, rc))}

    def execute(self, code, inputs):
        if self.failed:
            raise RuntimeUnavailable('Runner cleanup failed; operator intervention is required')
        wire.program(code, inputs)
        runs = []
        deadline = time.monotonic() + JOB_SECONDS
        for value in inputs:
            if time.monotonic() + WALL_SECONDS + 5 > deadline or (runs and runs[-1]['status'] in ('timeout', 'output_limit', 'skipped')):
                runs.append({'status': 'skipped', 'out': '', 'err': 'Остальные тесты остановлены после ограничения', 'exit_code': 1})
            else:
                runs.append(self.run_one(code, value))
        return runs


def request_value(value):
    if (set(value) != {'v', 'nonce', 'digest', 'code', 'inputs'} or value['v'] != wire.VERSION
            or not isinstance(value['nonce'], str) or not re.fullmatch('[0-9a-f]{32}', value['nonce'])):
        raise wire.ProtocolError('Неверный запрос')
    code, inputs = wire.program(value['code'], value['inputs'])
    if value['digest'] != wire.digest(code, inputs):
        raise wire.ProtocolError('Неверная контрольная сумма')
    return code, inputs


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            if wire.peer_uid(self.request) not in self.server.allowed_uids:
                raise wire.ProtocolError('Нет доступа')
            value = wire.recv_frame(self.request, wire.MAX_REQUEST, 5)
            code, inputs = request_value(value)
            runs = self.server.executor.execute(code, inputs)
            reply = {'v': wire.VERSION, 'status': 'complete', 'runtime': wire.RUNTIME,
                     'nonce': value['nonce'], 'digest': value['digest'], 'runs': runs}
        except (wire.ProtocolError, UnicodeError):
            reply = {'v': wire.VERSION, 'status': 'invalid_request'}
        except Exception:
            # Do not log submitted code, inputs, outputs or internal filesystem paths.
            reply = {'v': wire.VERSION, 'status': 'runtime_unavailable'}
        try:
            wire.send_frame(self.request, reply, wire.MAX_RESPONSE)
        except (OSError, wire.ProtocolError):
            pass


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    request_queue_size = 4

    def __init__(self, address, executor, allowed_uids):
        self.executor, self.allowed_uids = executor, set(allowed_uids)
        self.slots = threading.BoundedSemaphore(MAX_ACTIVE)
        super().__init__(address, Handler)
        os.chown(address, -1, Path(address).parent.stat().st_gid)
        os.chmod(address, 0o660)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            try:
                # Drain one bounded frame so closing the busy connection does not
                # reset a client still writing its request. Never execute it.
                wire.recv_frame(request, wire.MAX_REQUEST, 1)
                wire.send_frame(request, {'v': wire.VERSION, 'status': 'busy'}, wire.MAX_RESPONSE, 1)
            except (OSError, wire.ProtocolError):
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--socket', default=wire.SOCKET_PATH)
    parser.add_argument('--state', default='/var/lib/ege-python/jobs')
    parser.add_argument('--image-file', default='/etc/ege-python-verifier/image')
    parser.add_argument('--allow-user', default='trainer')
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()
    executor = PodmanExecutor(Path(args.image_file).read_text().strip(), args.state)
    executor.preflight()
    if args.probe:
        print('Independent Python runner: enforced isolation ready')
        return
    path = Path(args.socket)
    if path.exists():
        if not path.is_socket() or path.stat().st_uid != os.geteuid():
            raise RuntimeUnavailable('Unsafe socket path')
        path.unlink()
    allowed = {pwd.getpwnam(args.allow_user).pw_uid, os.geteuid()}
    with Server(str(path), executor, allowed) as server:
        try:
            server.serve_forever(poll_interval=.25)
        finally:
            path.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
