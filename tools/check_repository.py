"""Fail CI if runtime data or private credentials are tracked. Never print contents."""
import subprocess
from pathlib import PurePosixPath

paths = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
bad = []
for name in filter(None, paths):
    p = PurePosixPath(name)
    if (name.startswith('server_data/') or p.suffix in ('.csv', '.db', '.sqlite', '.sqlite3', '.bak', '.pem', '.key')
            or p.name == 'private_config.json' or '.db-' in p.name or p.name == '.env' or p.name.startswith('.env.')
            or any('backup' in part.lower() for part in p.parts[:-1])):
        bad.append(name)
if bad:
    raise SystemExit('Forbidden tracked paths:\n' + '\n'.join(bad))
print('Repository contains no tracked runtime data paths')

# Prevent reintroducing the private production reward table as a literal.
import ast
from pathlib import Path
for node in ast.parse(Path('server.py').read_text()).body:
    if isinstance(node, ast.Assign) and any(isinstance(t,ast.Name) and t.id == 'TASK_BTC' for t in node.targets):
        if not (isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id == 'private_rewards'):
            raise SystemExit('Production reward policy must come from private_config.json')
