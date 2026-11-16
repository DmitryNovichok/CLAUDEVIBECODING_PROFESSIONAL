#!/usr/bin/env python3
"""Read-only reference/input audit. A clean run does not certify answer correctness."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from learning_skills import skill_coverage  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT, help='source/content checkout; no user database is opened')
    args = parser.parse_args()
    report = skill_coverage(args.root)
    issues = [{'skill': r['id'], 'issues': r['reference_issues']} for r in report['rows'] if r['reference_issues']]
    print(json.dumps({'summary': report['summary'], 'reference_issues': issues,
                      'unmapped': [{'skill': r['id'], 'limitation': r['limitation']} for r in report['rows']
                                   if r['kind'] != 'unclassified' and not r['evidence']],
                      'semantic_verification': 'not_performed', 'bank_answer_verification': 'not_performed',
                      'note': 'Exit 0 means mapped references and their input files are present, not that every skill is covered.'},
                     ensure_ascii=False, indent=2))
    return 1 if issues else 0


if __name__ == '__main__':
    raise SystemExit(main())
