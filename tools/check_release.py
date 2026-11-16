#!/usr/bin/env python3
"""Validate shipped browser assets without Node/esbuild on the production host."""
import ast
import hashlib
import json
import sys
from pathlib import Path
try:
    from .build_changelog_loader import validate as validate_changelog
except ImportError:
    from build_changelog_loader import validate as validate_changelog

ROOT = Path(__file__).resolve().parent.parent


def runtime_files(root=ROOT):
    """Check local import closure without importing code or touching its database."""
    standard = getattr(sys, 'stdlib_module_names', None)
    if standard is None:
        raise ValueError('Для проверки релиза нужен Python 3.10 или новее')
    optional = {'xlrd'}  # server.py has an explicit built-in .xls fallback.
    pending, seen = ['server.py'], set()
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        path = root / name
        if not path.is_file():
            raise ValueError('Нет модуля сервера: ' + name)
        tree = ast.parse(path.read_bytes(), filename=name)
        seen.add(name)
        for node in ast.walk(tree):
            modules = ([alias.name for alias in node.names] if isinstance(node, ast.Import) else
                       [node.module] if isinstance(node, ast.ImportFrom) and node.module else [])
            for module in modules:
                top = module.split('.')[0]
                if top in standard or top in optional:
                    continue
                relative = module.replace('.', '/') + '.py'
                package = root / module.replace('.', '/')
                if (root / relative).is_file():
                    pending.append(relative)
                elif package.is_dir():
                    if (package / '__init__.py').is_file():
                        pending.append((package / '__init__.py').relative_to(root).as_posix())
                    if isinstance(node, ast.ImportFrom):
                        for alias in node.names:
                            child = package / (alias.name + '.py')
                            if child.is_file():
                                pending.append(child.relative_to(root).as_posix())
                else:
                    raise ValueError('Нет зависимости сервера: ' + relative + ' (из ' + name + ')')
    return sorted(seen)


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
    runtime_files(root)
    validate_changelog(root)
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
