"""Trusted image entrypoint. Check real isolation before opening pupil code.

This file belongs ONLY inside the runner image. It is not imported by server.py.
Failure exits before execve; no relaxed profile or host execution fallback exists.
"""
import os
from pathlib import Path
import resource
import sys

MARKER = b'EGE_PYTHON_ISOLATED_V1\n'
MEMORY = 256 * 1024 * 1024


def require(value):
    if not value:
        raise RuntimeError('isolation unavailable')


def check():
    require(os.getuid() == 65534 and os.getgid() == 65534 and os.getpid() == 1)
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    require(int(status['CapEff'].strip(), 16) == 0 and int(status['CapBnd'].strip(), 16) == 0)
    require(status['NoNewPrivs'].strip() == '1' and status['Seccomp'].strip() == '2')
    require(set(os.listdir('/sys/class/net')) == {'lo'})
    cgroup = Path('/sys/fs/cgroup')
    require((cgroup / 'cgroup.controllers').is_file())
    require(0 < int((cgroup / 'memory.max').read_text()) <= MEMORY)
    require(int((cgroup / 'memory.swap.max').read_text()) == 0)
    require(0 < int((cgroup / 'pids.max').read_text()) <= 32)
    quota, period = map(int, (cgroup / 'cpu.max').read_text().split())
    require(0 < quota <= period)
    mounts = [line.split() for line in Path('/proc/self/mountinfo').read_text().splitlines()]
    require(any(m[4] == '/' and 'ro' in m[5].split(',') for m in mounts))
    require(any(m[4] == '/sandbox/main.py' and 'ro' in m[5].split(',') for m in mounts))
    for key, ceiling in ((resource.RLIMIT_CPU, 3), (resource.RLIMIT_NOFILE, 32),
                         (resource.RLIMIT_FSIZE, 1048576), (resource.RLIMIT_CORE, 0)):
        soft, hard = resource.getrlimit(key)
        require(soft <= ceiling and 0 <= hard <= ceiling)


def main():
    try:
        check()
    except Exception:
        sys.stderr.write('EGE_PYTHON_ISOLATION_FAILED\n')
        return 125
    os.write(2, MARKER)
    # No broker environment or request metadata reaches the pupil interpreter.
    os.execve('/usr/local/bin/python3', ['python3', '-I', '-S', '-B', '/sandbox/main.py'],
              {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'PYTHONHASHSEED': '0'})
    return 125


if __name__ == '__main__':
    raise SystemExit(main())
