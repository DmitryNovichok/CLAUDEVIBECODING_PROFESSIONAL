"""Типы заданий внутри номера (clusters.py): ученик выбирает тип по ним, поэтому формулировки должны
попадать в свой тип, а не в соседний."""
import unittest

import clusters


def kind(n, text):
    return clusters.classify({"n": n, "html": f"<p>{text}</p>"})


class TaskTypesTest(unittest.TestCase):
    def test_23_trajectory_conditions(self):
        tail = " траектория вычислений программы — это последовательность результатов выполнения всех команд программы."
        base = "сколько существует программ, для которых при исходном числе 2 результатом является число 20"
        self.assertEqual(kind(23, base + "?" + tail), "programs")
        self.assertEqual(kind(23, base + ", и при этом траектория вычислений содержит число 16?" + tail), "must")
        self.assertEqual(kind(23, base + ", и при этом траектория вычислений не содержит числа 13?" + tail), "avoid")
        self.assertEqual(kind(23, base + ", при этом траектория вычислений содержит число 16 и не содержит 12?" + tail), "both")
        self.assertEqual(kind(23, base + ", при этом траектория вычислений не содержит числа 8 и содержит 14?" + tail), "both")

    def test_9_spreadsheet_conditions(self):
        head = "откройте файл электронной таблицы, содержащей в каждой строке пять натуральных чисел. определите количество строк, "
        self.assertEqual(kind(9, head + "в которых одно число повторяется дважды, остальные различны"), "repeat")
        self.assertEqual(kind(9, head + "в которых можно выбрать две различные пары одинаковых значений"), "repeat")
        self.assertEqual(kind(9, head + "в которых все числа различны и сумма чётных больше нечётных"), "distinct")
        self.assertEqual(kind(9, head + "в которых четыре числа можно разбить на две пары с равными суммами"), "pairs")
        self.assertEqual(kind(9, head + "из которых можно составить треугольник"), "geo")
        self.assertEqual(kind(9, head + "в которых медиана больше 50"), "mean")
        self.assertEqual(kind(9, head + "в которых сумма наибольшего и наименьшего больше 100"), "stat")

    def test_every_type_key_is_unique_within_number(self):
        for n, rules in clusters.RULES.items():
            keys = [k for k, _, _ in rules] + [clusters.OTHER[0]]
            self.assertEqual(len(keys), len(set(keys)), f"№{n}: повторяется ключ типа")


if __name__ == "__main__":
    unittest.main()
