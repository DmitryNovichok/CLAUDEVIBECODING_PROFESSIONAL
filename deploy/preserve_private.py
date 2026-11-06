#!/usr/bin/env python3
"""Run locally on the server BEFORE replacing old source. Does not import/start it."""
import ast
import json
import os
import sys
from fractions import Fraction
from pathlib import Path


def preserve(source, destination):
    source, destination = Path(source), Path(destination)
    existing = json.loads(destination.read_text()) if destination.exists() else {}
    tree = ast.parse(source.read_text(encoding='utf-8'))
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        name = node.targets[0].id
        if name not in ('TASK_BTC', 'DEFAULT_INVITE', 'DEV_CODE') or name in existing:
            continue
        # Only known legacy declarations: no attribute access, imports, file or network operations.
        allowed = (ast.Expression, ast.Dict, ast.DictComp, ast.comprehension, ast.Name, ast.Load, ast.Store,
                   ast.Constant, ast.Call, ast.BinOp, ast.Div, ast.Mult, ast.Add, ast.Sub, ast.Pow,
                   ast.UnaryOp, ast.USub, ast.List, ast.Tuple)
        expr = ast.Expression(node.value)
        if any(not isinstance(n, allowed) for n in ast.walk(expr)):
            raise SystemExit('Unsupported private declaration; preserve it manually in private_config.json')
        if any(isinstance(n, ast.Call) and (not isinstance(n.func, ast.Name) or n.func.id not in ('range','Fraction')) for n in ast.walk(expr)):
            raise SystemExit('Unsupported private declaration')
        value = eval(compile(expr, str(source), 'eval'), {'__builtins__': {}, 'Fraction': Fraction, 'range': range})
        existing[name] = {str(k): str(v) for k,v in value.items()} if isinstance(value, dict) else value
    if not existing.get('TASK_BTC'):
        raise SystemExit('No private policy found; source was already replaced? Restore old server.py from your backup.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_suffix('.json.tmp')
    fd = os.open(tmp, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(existing,f); f.flush(); os.fsync(f.fileno())
    os.replace(tmp,destination)
    os.chmod(destination,0o600)
    print('Private policy preserved (values not displayed)')

if __name__ == '__main__':
    preserve(sys.argv[1],sys.argv[2])
