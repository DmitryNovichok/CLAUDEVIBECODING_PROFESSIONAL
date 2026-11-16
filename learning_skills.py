"""Evidence inventory by task type; reference checks are not pedagogical certification.

Only headings, format/count metadata and limitations leave this module. Conditions,
answers, code, attachment names/URLs and pupil progress never enter the public report.
"""
from collections import Counter
from functools import lru_cache
import json
from pathlib import Path
from urllib.parse import urlsplit, unquote

import clusters
from learning_catalog import TOPICS, LAB_MODELS

MAP_PATH = Path(__file__).with_name('learning-skill-map.json')
CLASSIFIER_KEYS = {n: {key for key, _, _ in rules} for n, rules in clusters.RULES.items()}


@lru_cache(maxsize=192)
def _read_version(path, mtime, size):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def read_metadata(path):
    """Invalidate content caches when a source file is replaced, including atomically."""
    path = Path(path)
    try:
        stamp = path.stat()
    except OSError:
        return None
    return _read_version(str(path), stamp.st_mtime_ns, stamp.st_size)


def _file_checks(root, value):
    """Count local lesson inputs without exposing protected paths or their contents."""
    refs = []
    def visit(node):
        if isinstance(node, dict):
            files = node.get('files', [])
            if isinstance(files, list):
                refs.extend(f if isinstance(f, dict) else {} for f in files)
            elif 'files' in node:
                refs.append({})
            for key, child in node.items():
                if key != 'files':
                    visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)
    visit(value)
    found = invalid = missing = 0
    for ref in refs:
        try:
            parsed = urlsplit(str(ref.get('url', '')))
        except ValueError:
            invalid += 1
            continue
        path = unquote(parsed.path).lstrip('/')
        prefix = next((p for p in ('course-data/', 'pyc-data/') if path.startswith(p)), None)
        if parsed.scheme or parsed.netloc or not prefix:
            invalid += 1
            continue
        base = (root / ('course/data' if prefix == 'course-data/' else 'pycourse/data')).resolve()
        candidate = (base / path[len(prefix):]).resolve()
        if not candidate.is_relative_to(base):
            invalid += 1
        elif candidate.is_file():
            found += 1
        else:
            missing += 1
    return {'referenced': len(refs), 'present': found, 'missing': missing, 'invalid': invalid}


def _evidence(root, mapping):
    evidence, issues = [], []
    lesson = mapping.get('lesson') or {}
    if lesson.get('slides'):
        deck = read_metadata(root / 'course' / f"{lesson['n']}.json")
        slides = deck.get('slides', []) if isinstance(deck, dict) else []
        slides = slides if isinstance(slides, list) else []
        for expected in lesson['slides']:
            i = expected['index']
            slide = slides[i] if 0 <= i < len(slides) else None
            if not isinstance(slide, dict) or slide.get('h') != expected['title'] or slide.get('t') != expected['kind']:
                issues.append({'kind': 'lesson', 'n': lesson['n'], 'slide': i + 1, 'reason': 'reference_changed_or_missing'})
                continue
            files = _file_checks(root, slide)
            evidence.append({'kind': 'lesson', 'n': lesson['n'], 'slide': i + 1,
                             'title': slide['h'], 'format': slide['t'], 'inputs': files})
            if files['missing'] or files['invalid']:
                issues.append({'kind': 'lesson', 'n': lesson['n'], 'slide': i + 1, 'reason': 'input_unavailable'})
    for expected in mapping.get('python', []):
        mid, i = expected['id'], expected['level']
        module = read_metadata(root / 'pycourse' / f'{mid}.json')
        levels = module.get('levels', []) if isinstance(module, dict) else []
        levels = levels if isinstance(levels, list) else []
        level = levels[i] if 0 <= i < len(levels) else None
        if not isinstance(level, dict) or level.get('title') != expected['title']:
            issues.append({'kind': 'python', 'module': mid, 'level': i + 1, 'reason': 'reference_changed_or_missing'})
            continue
        selected = expected.get('tasks', [])
        actual_tasks = level.get('tasks', [])
        actual = {t.get('id'): t for t in actual_tasks if isinstance(t, dict)} if isinstance(actual_tasks, list) else {}
        matched = [actual[t['id']] for t in selected if t['id'] in actual and actual[t['id']].get('h') == t['title']]
        if len(matched) != len(selected):
            issues.append({'kind': 'python', 'module': mid, 'level': i + 1, 'reason': 'task_reference_changed_or_missing'})
        # A broad level is evidence of nearby material, not proof that every task teaches this skill.
        slide_refs = []
        level_slides = level.get('slides', [])
        level_slides = level_slides if isinstance(level_slides, list) else []
        for wanted in expected.get('slides', []):
            si = wanted['index']
            slide = level_slides[si] if 0 <= si < len(level_slides) else None
            if not isinstance(slide, dict) or slide.get('h') != wanted['title'] or slide.get('t') != wanted['kind']:
                issues.append({'kind': 'python', 'module': mid, 'level': i + 1, 'reason': 'slide_reference_changed_or_missing'})
            else:
                slide_refs.append({'slide': si + 1, 'title': slide['h']})
        files = _file_checks(root, matched + [level_slides[s['slide'] - 1] for s in slide_refs])
        evidence.append({'kind': 'python', 'module': mid, 'level': i + 1, 'title': level['title'],
                         'linked_tasks': len(matched), 'tasks_scope': expected.get('tasks_scope', 'level_inventory'),
                         'slides': slide_refs, 'inputs': files})
        if files['missing'] or files['invalid']:
            issues.append({'kind': 'python', 'module': mid, 'level': i + 1, 'reason': 'input_unavailable'})
    for model in mapping.get('labs', []):
        base = model.split(':')[0]
        if model in {'image', 'net', 'logic:bit', 'logic:div', 'logic:seg', 'game', 'graph'}:
            title = {'logic:bit': 'Логика: поразрядное И', 'logic:div': 'Логика: делимость',
                     'logic:seg': 'Логика: отрезки'}.get(model, LAB_MODELS[base])
            evidence.append({'kind': 'lab', 'model': model, 'title': title, 'scope': 'limited_model'})
        else:
            issues.append({'kind': 'lab', 'reason': 'unknown_model'})
    return evidence, issues


def skill_coverage(root, tasks=None, mapping=None):
    """Audit-linked references plus heuristic bank counts; never a 'fully covered' badge."""
    root = Path(root)
    mapping = (read_metadata(MAP_PATH) or {}).get('rows', []) if mapping is None else mapping
    by_key = {m['key']: m for m in mapping}
    counts = Counter()
    if tasks is not None:
        for task in tasks.values():
            n = task.get('n')
            if n not in clusters.RULES:
                continue
            key = task.get('c') or clusters.classify(task)
            if key not in CLASSIFIER_KEYS[n]:
                key = 'misc'
            for part in task.get('parts') or [task]:
                counts[(part.get('n', n), key)] += 1
    rows = []
    for topic in TOPICS:
        n = topic['n']
        labels = [(key, title) for key, title, _ in clusters.RULES.get(n, [])]
        labels += [(m['key'].split('.', 1)[1], m['title']) for m in mapping
                   if m.get('subskill') and m['key'].startswith(str(n) + '.')]
        if n in clusters.RULES:
            labels += [('misc', 'Другие формулировки / тип не определён')]
        for key, title in labels:
            ref = by_key.get(f'{n}.{key}', {})
            evidence, issues = _evidence(root, ref)
            state = ('partial' if issues else 'material_found') if evidence else ('missing_reference' if issues else 'not_mapped')
            parent, bank_n = ref.get('bank_type', key), ref.get('bank_n', n)
            count = (sum(v for (num, _), v in counts.items() if num == bank_n) if parent is None else counts[(bank_n, parent)]) if tasks is not None else None
            rows.append({'id': f'{n}.{key}', 'n': n, 'exam_nums': [19, 20, 21] if n == 19 else [n],
                         'topic': topic['title'], 'title': title, 'archive': topic['archive'],
                         'kind': 'subskill' if ref.get('subskill') else 'unclassified' if key == 'misc' else 'task_type',
                         'material_status': state, 'evidence': evidence, 'reference_issues': issues,
                         'review_status': 'not_reviewed', 'semantic_verified': False,
                         'practice': {'count': count, 'scope': 'topic' if parent is None else 'parent_type' if ref.get('subskill') else 'task_type',
                                      'classified_by': 'heuristic', 'answers_verified': False},
                         'limitation': ref.get('note', '')})
    defined = [r for r in rows if r['kind'] != 'unclassified']
    return {'schema': 1, 'rows': rows,
            'summary': {'defined_types_and_skills': len(defined),
                        'with_material_references': sum(bool(r['evidence']) for r in defined),
                        'without_material_references': sum(not r['evidence'] for r in defined),
                        'with_reference_issues': sum(bool(r['reference_issues']) for r in defined),
                        'semantically_verified': 0},
            'method': 'explicit_source_references',
            'note': 'Наличие слайда, уровня или модели не подтверждает полноту навыка. Содержательная проверка покрытия и независимая проверка ответов банка не выполнены. Типы банка определяются автоматически; их количество приблизительно. Части общего задания №19–21 считаются у своих номеров; общий материал не становится тремя независимыми уроками.'}
