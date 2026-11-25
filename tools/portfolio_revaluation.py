"""Сверка трёх способов оценки одних и тех же коллекций на временной копии SQLite."""
import argparse
from contextlib import closing
import math
from pathlib import Path
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def legacy_price(row, unique, econ, demand, ratios, burns):
    """Модель 2.104 с текущим тиражом и последними сохранёнными для неё коэффициентами."""
    gid = row["gift"]
    ref = server.gift_price(gid, econ, demand)
    if unique:
        fee = server.gift_up_base(gid, econ, row["up_base"])
        ref += max(fee, math.floor(fee * server.SELL_UNIQ[unique["rar"]["k"]]))
    ratio = ratios.get(server.market_key(gid, unique), ratios.get("*" + server.market_tier(gid, unique), 1))
    burn = burns.get((gid, bool(unique)), 0)
    estimate = min(server.MARKET_CAP * ref, max(1, round(ref * ratio * (1 + 0.2 * burn))))
    return estimate, max(ref, estimate)


def compare(db):
    econ = server.thermo_now(db) or {"idx": 1}
    demand = server.gift_demand(db)
    values = server.market_vals(db)
    ratios = {r["mkey"]: r["ratio"] for r in db.q("""SELECT h.mkey,h.ratio FROM market_hist h
              JOIN (SELECT mkey, MAX(day) day FROM market_hist GROUP BY mkey) last USING(mkey,day)""")}
    burns = {}
    for r in db.q("""SELECT gift, COUNT(*) total, SUM(sold IS NOT NULL) burned, COUNT(uniq) upgraded,
                     SUM(uniq IS NOT NULL AND sold IS NOT NULL) burned_unique FROM gifts GROUP BY gift"""):
        gid = r["gift"]
        if r["upgraded"]:
            burns[gid, True] = r["burned_unique"] / r["upgraded"]
        if gid in server.LIMITED_BY or gid in server.HW_BY:
            burns[gid, False] = r["burned"] / r["total"]
    portfolios = {r["id"]: [0, 0, 0, 0] for r in db.q("""SELECT id FROM students
                  WHERE COALESCE(is_teacher,0)=0 AND name_key NOT LIKE 'demo:%' ORDER BY id""")}
    for r in db.q("SELECT student_id,gift,uniq,up_base,appraisal_base FROM gifts WHERE sold IS NULL"):
        sid, gid = r["student_id"], r["gift"]
        if sid not in portfolios or gid not in server.GIFT_BY:
            continue
        unique = server.uniq_pub(r["uniq"]) if r["uniq"] else None
        legacy, legacy_ref = legacy_price(r, unique, econ, demand, ratios, burns)
        previous = server.market_est(gid, unique, econ, demand, r["up_base"], values)
        current = server.portfolio_estimate(gid, unique, r["appraisal_base"], values)
        ref = server.market_base(gid, unique, econ, demand, r["up_base"], values)
        rate = server.market_fee(econ, r)
        totals = portfolios[sid]
        totals[0] += 1
        for i, (value, base) in enumerate(((legacy, legacy_ref), (previous, ref), (current, ref)), 1):
            totals[i] += value - server.market_fee_amt(value, rate, base)
    return portfolios


def check_snapshot(path):
    with tempfile.TemporaryDirectory(prefix="egeshka-portfolio-") as directory:
        copy = Path(directory) / "snapshot.db"
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as src:
            if not src.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gifts'").fetchone():
                raise ValueError("В файле отсутствует таблица подарков Egeshka")
            with closing(sqlite3.connect(copy)) as dest:
                src.backup(dest)
        db = server.DB(copy)
        try:
            return compare(db)
        finally:
            db.conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path, help="Путь к server_data/trainer.db или к резервной копии")
    args = parser.parse_args()
    try:
        rows = check_snapshot(args.database)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f"Ошибка чтения базы: {error}\n")
    print("Оценка подарков после комиссии, ₿. Состав во всех столбцах одинаков. Кошельки исключены.")
    print("2.104* — реконструкция по тиражу в этой базе и последним сохранённым коэффициентам старой модели.")
    print("ID ученика | Подарков | 2.104* | 2.106 | 2.107 | Изменение 2.107 к 2.106")
    sums = [0, 0, 0, 0]
    for sid, vals in rows.items():
        if not vals[0]:
            continue
        sums = [a + b for a, b in zip(sums, vals)]
        print(sid, *vals, f"{vals[3] - vals[2]:+d}", sep=" | ")
    print("Итого", *sums, f"{sums[3] - sums[2]:+d}", sep=" | ")
    print(f"Учеников: {len(rows)}. С подарками: {sum(v[0] > 0 for v in rows.values())}.")
    print("Снижение вдвое или больше при переходе 2.104* → 2.106:",
          sum(old > 0 and prev * 2 <= old for _, old, prev, _ in rows.values()))
    print("Снижение вдвое или больше при переходе 2.106 → 2.107:",
          sum(prev > 0 and new * 2 <= prev for _, _, prev, new in rows.values()))


if __name__ == "__main__":
    main()
