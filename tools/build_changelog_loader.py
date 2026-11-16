#!/usr/bin/env python3
"""Build the small current-release payload; full history loads on demand.

The first row of each changelog is a JSON array. We decode those literal rows
without evaluating JavaScript, so release checks need only Python.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def build(root=ROOT):
    source = (root / 'changelog.js').read_bytes()
    text = source.decode('utf-8')
    current = {}
    for kind in ('student', 'teacher'):
        match = re.search(r'\b' + kind + r'\s*:\s*\[\s*(\[)', text)
        if not match:
            raise ValueError('Нет раздела истории: ' + kind)
        row, _ = json.JSONDecoder().raw_decode(text[match.start(1):])
        if len(row) != 4 or not all(isinstance(x, str) for x in row[:2]) or not all(isinstance(x, list) for x in row[2:]):
            raise ValueError('Неверный формат текущей версии: ' + kind)
        current[kind] = [row]
    digest = hashlib.sha256(source).hexdigest()
    template = (root / 'tools' / 'changelog-loader.template.js').read_text(encoding='utf-8')
    return template.replace('__SOURCE_HASH__', digest).replace('__LATEST_JSON__', json.dumps(current, ensure_ascii=False, separators=(',', ':')))


def validate(root=ROOT):
    if (root / 'changelog-loader.js').read_text(encoding='utf-8') != build(root):
        raise ValueError('changelog-loader.js устарел: python3 tools/build_changelog_loader.py')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        validate()
        print('Текущая версия соответствует полной истории')
    else:
        output = ROOT / 'changelog-loader.js'
        output.write_text(build(), encoding='utf-8')
        print('Собран changelog-loader.js')
