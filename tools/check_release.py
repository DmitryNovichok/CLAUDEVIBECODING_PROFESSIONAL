#!/usr/bin/env python3
"""Validate shipped browser assets without Node/esbuild on the production host."""
import ast
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def asset_names(root=ROOT):
    for node in ast.parse((root / 'server.py').read_text(encoding='utf-8')).body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') == 'MIN_FILES' for t in node.targets):
            return list(ast.literal_eval(node.value))
    raise ValueError('server.py: MIN_FILES отсутствует')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def records(root=ROOT, output=None):
    output = output or root / 'min'
    return {name: {'source': digest(root / name), 'min': digest(output / name)}
            for name in asset_names(root)}


def write_manifest(root=ROOT, output=None):
    output = output or root / 'min'
    data = {'version': 1, 'files': records(root, output)}
    (output / 'manifest.json').write_text(json.dumps(data, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def validate(root=ROOT):
    data = json.loads((root / 'min' / 'manifest.json').read_text(encoding='utf-8'))
    if data.get('version') != 1 or data.get('files') != records(root):
        raise ValueError('min/ не соответствует исходникам: выполните python3 tools/minify.py')
    if not (root / 'admin-login.js').is_file():
        raise ValueError('нет admin-login.js: вход учителя не будет работать')
    if 'teacher-gate.js' in asset_names(root) and not (root / 'teacher-gate.html').is_file():
        raise ValueError('нет teacher-gate.html: страница проверки учителя не будет работать')


if __name__ == '__main__':
    try:
        validate()
    except (OSError, ValueError, SyntaxError) as exc:
        sys.exit('Обновление отменено: неполная или устаревшая сборка ресурсов. ' + str(exc))
    print('Сжатые ресурсы полны и соответствуют исходникам')
