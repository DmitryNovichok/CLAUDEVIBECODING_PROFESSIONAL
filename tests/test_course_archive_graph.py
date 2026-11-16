"""Independent boundary cases for the archive graph lesson's checking advice."""
import ast
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent


def lesson_function(title, name, source):
    deck = json.loads((ROOT / 'course/28.json').read_text(encoding='utf-8'))
    slide = next(s for s in deck['slides'] if s['h'] == title)
    tree = ast.parse(slide['code'])
    # Load the actual displayed function without running its example-specific print.
    final = tree.body[-1]
    assert isinstance(final, ast.Expr) and isinstance(final.value, ast.Call)
    assert isinstance(final.value.func, ast.Name) and final.value.func.id == 'print'
    tree.body.pop()
    namespace = {}
    with patch('builtins.open', side_effect=lambda *args, **kwargs: io.StringIO(source)):
        exec(compile(tree, '<archive lesson>', 'exec'), namespace)
    return namespace[name]


class ArchiveGraphAdviceTest(unittest.TestCase):
    def test_one_edge_has_known_count_distance_and_hops(self):
        # This graph has exactly one possible route; the oracle needs no graph algorithm.
        source = '301 126 7.5\n'
        for title, name, wanted in (
            ('Сколько путей из одной вершины в другую', 'ways', 1),
            ('Кратчайший путь', 'short', 7.5),
            ('Самый длинный путь', 'long', 7.5),
            ('Наибольшее количество рёбер', 'hops', 1),
        ):
            with self.subTest(function=name):
                f = lesson_function(title, name, source)
                self.assertEqual(f(301, 126), wanted)
                self.assertEqual(f(301, 301), 1 if name == 'ways' else 0)

    def test_neighboring_vertices_need_not_use_the_direct_edge(self):
        rows = [line.split() for line in (ROOT / 'course/data/28/23.txt').read_text().splitlines()]
        edges = {(int(a), int(b)): w for a, b, w in rows}
        self.assertEqual([edges[p] for p in ((574, 578), (574, 558), (558, 578))],
                         ['56.8', '28.8', '7.9'])
        source = '\n'.join(f'{a} {b} {edges[a, b]}' for a, b in ((574, 578), (574, 558), (558, 578)))
        shortest = lesson_function('Кратчайший путь', 'short', source)
        count = lesson_function('Сколько путей из одной вершины в другую', 'ways', source)
        self.assertAlmostEqual(shortest(574, 578), 36.7)  # 28.8 + 7.9 < 56.8
        self.assertEqual(count(574, 578), 2)

    def test_advice_uses_a_separate_one_edge_graph(self):
        deck = json.loads((ROOT / 'course/28.json').read_text(encoding='utf-8'))
        advice = next(s['html'] for s in deck['slides'] if s['h'] == 'Восемь ошибок, которые стоят балла')
        self.assertIn('отдельном графе с единственным ребром 301 → 126 веса 7.5', advice)
        self.assertIn('между соседними вершинами могут быть другие пути', advice)
        self.assertNotIn('ответ должен совпасть с тем, что видно в файле', advice)


if __name__ == '__main__':
    unittest.main()
