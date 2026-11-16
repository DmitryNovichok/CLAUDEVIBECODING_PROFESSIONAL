#!/bin/bash
# Dedicated, disposable GitHub VM only. The production installer remains separate.
set -euo pipefail
if [[ ${GITHUB_ACTIONS:-} != true || $(id -u) != 0 || $# != 2 ]]; then
  echo 'Run in the disposable GitHub job: sudo --preserve-env=GITHUB_ACTIONS bash ci-acceptance.sh ARTIFACT_DIR REVISION' >&2
  exit 2
fi
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
artifacts=$1
revision=$2
install -d -m 0755 "$artifacts"
runner_uid=
runner() {
  runuser -u ege-python -- env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 \
    HOME=/var/lib/ege-python USER=ege-python LOGNAME=ege-python "XDG_RUNTIME_DIR=/run/user/$runner_uid" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$runner_uid/bus" "$@"
}
diagnostics() {
  status=$?
  trap - EXIT
  set +e
  uname -a > "$artifacts/kernel.txt"
  dpkg-query -W podman crun conmon uidmap systemd > "$artifacts/packages.txt" 2>&1
  if [[ -n $runner_uid ]]; then
    runner podman info --format=json > "$artifacts/podman-info.json" 2>&1
    runner podman ps -a --filter label=io.egeshka.verifier=1 --format=json > "$artifacts/remaining-containers.json" 2>&1
    systemctl show "user@$runner_uid.service" -p Delegate -p DelegateControllers > "$artifacts/delegation.txt" 2>&1
    systemctl --machine ege-python@ --user status ege-python-verifier.service --no-pager > "$artifacts/service.txt" 2>&1
    journalctl --no-pager "_UID=$runner_uid" -n 200 > "$artifacts/runner-journal.txt" 2>&1
  fi
  if [[ -f /etc/ege-python-verifier/image ]]; then
    cp /etc/ege-python-verifier/image "$artifacts/image-id.txt"
  fi
  # Test success alone is not job success: cleanup/service postconditions can fail.
  /usr/bin/python3 - "$artifacts" "$status" <<'PY'
import json
from pathlib import Path
import sys
root, exit_code = Path(sys.argv[1]), int(sys.argv[2])
tests = json.loads((root / 'runner-report.json').read_text()) if (root / 'runner-report.json').exists() else {}
(root / 'ci-status.json').write_text(json.dumps({
    'schema': 'egeshka.python-runner-ci.v1', 'passed': exit_code == 0,
    'exit_code': exit_code, 'tests_passed': tests.get('passed'),
    'required_postconditions': ['all_four_container_tests', 'no_remaining_containers', 'service_active'],
}, indent=2) + '\n')
PY
  chmod -R a+rX "$artifacts"
  exit "$status"
}
trap diagnostics EXIT

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends podman uidmap dbus-user-session fuse-overlayfs
# Synthetic service accounts, no production configuration or credentials.
useradd --system --no-create-home --shell /usr/sbin/nologin trainer
useradd --create-home --home-dir /var/lib/ege-python --shell /usr/sbin/nologin ege-python
runner_uid=$(id -u ege-python)
# Delegate controllers to this user manager; container limits remain mandatory.
# No global sysctl, privileged container or disabled LSM/seccomp workaround.
install -d -m 0755 "/etc/systemd/system/user@$runner_uid.service.d"
cat > "/etc/systemd/system/user@$runner_uid.service.d/50-verifier-controllers.conf" <<'EOF'
[Service]
Delegate=cpu cpuset io memory pids
EOF
systemctl daemon-reload
base_image=$(cat "$source_dir/base-image.txt")
cp "$source_dir/base-image.txt" "$artifacts/base-image.txt"
bash "$source_dir/install.sh" "$base_image" 2>&1 | tee "$artifacts/install.log"
systemctl --machine ege-python@ --user is-active --quiet ege-python-verifier.service
# Type=simple starts before the service's own preflight finishes. Require its
# socket within a bounded startup window, without treating a failed start as skip.
for attempt in {1..20}; do
  if [[ -S /run/ege-python-verifier/runner.sock ]]; then break; fi
  systemctl --machine ege-python@ --user is-active --quiet ege-python-verifier.service
  sleep 1
done
test -S /run/ege-python-verifier/runner.sock
acceptance=/opt/ege-python-verifier/acceptance
install -d -o ege-python -g ege-python -m 0700 /var/lib/ege-python/acceptance-results
image=$(cat /etc/ege-python-verifier/image)
set +e
runner env "EGE_RUNNER_IMAGE=$image" "EGE_RUNNER_SOCKET=/run/ege-python-verifier/runner.sock" \
  /usr/bin/python3 "$acceptance/tests/test_python_runner_container.py" \
  --report /var/lib/ege-python/acceptance-results/runner-report.json --source-revision "$revision" \
  2>&1 | tee "$artifacts/acceptance.log"
test_status=${PIPESTATUS[0]}
set -e
if [[ -f /var/lib/ege-python/acceptance-results/runner-report.json ]]; then
  cp /var/lib/ege-python/acceptance-results/runner-report.json "$artifacts/runner-report.json"
fi
if [[ $test_status != 0 ]]; then exit "$test_status"; fi
# A passing test cannot leave a timed-out/flooding container behind.
remaining=$(runner podman ps -aq --filter label=io.egeshka.verifier=1)
if [[ -n $remaining ]]; then
  echo 'Acceptance FAILED: verifier containers remain after tests.' >&2
  exit 1
fi
systemctl --machine ege-python@ --user is-active --quiet ege-python-verifier.service
