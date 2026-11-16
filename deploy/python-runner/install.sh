#!/bin/sh
# Run as root on a supported Linux host; never run from a web request.
# The argument must be an operator-reviewed immutable official Python image.
set -eu
base_image=${1:-}
case "$base_image" in
  docker.io/library/python@sha256:*) ;;
  *) echo 'Usage: sudo sh deploy/python-runner/install.sh docker.io/library/python@sha256:<64 hex digits>' >&2; exit 2 ;;
esac
image_digest=${base_image##*@sha256:}
if [ "${#image_digest}" -ne 64 ] || printf '%s' "$image_digest" | LC_ALL=C grep -q '[^0-9a-f]'; then
  echo 'An immutable sha256 digest is required.' >&2; exit 2
fi
if [ "$(id -u)" -ne 0 ]; then echo 'Run this installation as root.' >&2; exit 2; fi
for command in podman newuidmap newgidmap loginctl systemctl runuser; do
  command -v "$command" >/dev/null || { echo "Install required command: $command" >&2; exit 2; }
done
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$source_dir/../.." && pwd)
getent group ege-verifier >/dev/null || groupadd --system ege-verifier
id ege-python >/dev/null 2>&1 || useradd --create-home --home-dir /var/lib/ege-python --shell /usr/sbin/nologin ege-python
usermod -aG ege-verifier ege-python
usermod -aG ege-verifier trainer
# Do not guess or overwrite subordinate-ID ranges. Rootless setup must already
# provide non-overlapping ranges (normal useradd usually allocates these).
if ! grep -q '^ege-python:' /etc/subuid || ! grep -q '^ege-python:' /etc/subgid; then
  echo 'Configure non-overlapping subordinate UID/GID ranges for ege-python, then rerun.' >&2; exit 2
fi
chmod 0700 /var/lib/ege-python
install -d -o root -g root -m 0755 /opt/ege-python-verifier /opt/ege-python-verifier/image /etc/ege-python-verifier
install -m 0644 "$repo_dir/python_runner_protocol.py" "$source_dir/python_executor.py" /opt/ege-python-verifier/
install -m 0644 "$source_dir/entrypoint.py" "$source_dir/Containerfile" /opt/ege-python-verifier/image/
install -m 0644 "$source_dir/ege-python-verifier.tmpfiles" /etc/tmpfiles.d/ege-python-verifier.conf
systemd-tmpfiles --create /etc/tmpfiles.d/ege-python-verifier.conf
install -m 0644 "$source_dir/ege-python-verifier.service" /etc/systemd/user/ege-python-verifier.service
# Keep acceptance tied to these installed sources and readable by ege-python,
# without granting that account access to the application checkout/data.
acceptance=/opt/ege-python-verifier/acceptance
install -d -m 0755 "$acceptance/tests" "$acceptance/deploy/python-runner"
install -m 0644 "$repo_dir/buglab_verifier.py" "$repo_dir/python_runner_protocol.py" "$acceptance/"
install -m 0644 "$repo_dir/tests/test_python_runner_container.py" "$acceptance/tests/"
install -m 0644 "$source_dir/python_executor.py" "$acceptance/deploy/python-runner/"
runner_uid=$(id -u ege-python)
runner() {
  # runuser preserves XDG_CONFIG_HOME/CONTAINERS_* from the invoking account.
  # Use only the dedicated account's context, never its caller's Podman config.
  runuser -u ege-python -- env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 \
    HOME=/var/lib/ege-python USER=ege-python LOGNAME=ege-python "XDG_RUNTIME_DIR=/run/user/$runner_uid" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$runner_uid/bus" "$@"
}
loginctl enable-linger ege-python
systemctl start "user@$runner_uid.service"
runner podman pull "$base_image"
runner podman build --pull=never --network=none \
  --build-arg "PYTHON_BASE=$base_image" --iidfile /var/lib/ege-python/runner-image.id \
  -t localhost/ege-python-verifier /opt/ege-python-verifier/image
install -m 0644 /var/lib/ege-python/runner-image.id /etc/ege-python-verifier/image
runner /usr/bin/python3 /opt/ege-python-verifier/python_executor.py --probe
systemctl --machine ege-python@ --user daemon-reload
systemctl --machine ege-python@ --user enable ege-python-verifier.service
systemctl --machine ege-python@ --user restart ege-python-verifier.service
echo 'Runner installed. Run its container acceptance tests before enabling verified credit.'
echo 'Restart ege-trainer after checking the runner; trainer needs its new socket group.'
