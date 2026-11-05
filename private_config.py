"""Private server policy. Never ship production reward tables or shared codes in Git."""
import json
import os
from fractions import Fraction
from pathlib import Path


def read_private():
    path = Path(os.environ.get('EGE_PRIVATE_CONFIG') or Path(__file__).resolve().parent/'server_data'/'private_config.json')
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


def private_rewards(config):
    return {int(k): Fraction(v) for k, v in config.get('TASK_BTC', {}).items()}


def require_private(config):
    rewards = private_rewards(config)
    if set(rewards) != set(range(1, 28)) or any(v < 0 for v in rewards.values()):
        raise SystemExit('Private reward policy missing/invalid. Run deploy/preserve_private.py on the OLD server.py before updating; see deploy/DEPLOY.md.')
