#!/usr/bin/env python3
"""Interactive server-only password update. Never pass passwords as arguments."""
import argparse
import getpass
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from learning_access import set_learning_passwords


def main():
    parser = argparse.ArgumentParser(description='Пароли курса, программирования и лабораторий')
    parser.add_argument('--db', required=True, type=Path, help='Существующая рабочая база SQLite')
    args = parser.parse_args()
    if not args.db.is_file():
        parser.error('Рабочая база не найдена; новая база не создаётся')
    try:
        password = getpass.getpass('Новый общий пароль трёх разделов: ')
        if password != getpass.getpass('Повторите пароль: '):
            raise ValueError('Пароли не совпали; ничего не изменено')
        # mode=rw prevents accidental creation of an empty database.
        with sqlite3.connect(args.db.resolve().as_uri() + '?mode=rw', uri=True, timeout=30) as conn:
            set_learning_passwords(conn, password)
    except (ValueError, sqlite3.Error) as exc:
        parser.exit(1, f'Не удалось изменить пароли: {exc}\n')
    print('Пароли трёх разделов изменены. Входы, приглашения и ранее открытые курсы сохранены.')


if __name__ == '__main__':
    main()
