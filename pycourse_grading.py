"""Compare course answers against the results of build-time reference programs."""
import json


def public_practice(practice):
    if not practice.get('graded'):
        return practice
    # The worked example is visible. The other reference outputs stay with the grader.
    return {**practice, 'cases': [case if i == 0 else {'input': case['input']}
                                  for i, case in enumerate(practice['cases'])]}


def grade(task, data, normalize):
    if 'worksheet' in task:
        expected = [line.split() for line in task['ans'].splitlines()]
        rows = data.get('rows')
        if not isinstance(rows, list) or not 1 <= len(rows) <= len(expected):
            raise ValueError('Заполни очередной шаг таблицы.')
        for i, row in enumerate(rows):
            if (not isinstance(row, list) or len(row) != len(expected[i]) or
                    any(not isinstance(v, str) or not v.strip() or len(v) > 80 for v in row)):
                raise ValueError('Заполни все поля шага.')
            for j, value in enumerate(row):
                if normalize(value.replace(',', '.')) != normalize(expected[i][j]):
                    return False, {'cell': {'row': i, 'column': j}}
        if len(rows) < len(expected):
            return False, {'verified_rows': len(rows)}
        return True, {}

    if task.get('practice', {}).get('graded'):
        cases = task['practice']['cases']
        outputs = data.get('outputs')
        if (not isinstance(outputs, list) or len(outputs) != len(cases) or
                any(not isinstance(v, str) or len(v) > 8000 for v in outputs)):
            raise ValueError('Выполни программу на всех наборах данных.')
        for i, (got, case) in enumerate(zip(outputs, cases)):
            if got.split() != case['output'].split():
                return False, {'case_error': {'index': i, 'expected': case['output']}}
        return True, {}

    if 'regex' in task:
        expected = json.loads(task['ans'])
        matches = data.get('matches')
        if not isinstance(matches, list) or len(matches) != len(expected):
            raise ValueError('Проверьте шаблон на всех строках упражнения')
        for i, row in enumerate(expected):
            if matches[i] != row:
                return False, {'mismatch': {'index': i, 'expected': row}}
        return True, {}

    answer = str(data.get('answer') or '').strip()[:300]
    if not answer:
        raise ValueError('Введите ответ')
    return normalize(answer) == normalize(task['ans']), {}
