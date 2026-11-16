#!/usr/bin/env python3
"""Validate/evaluate a private CSV of frozen forecasts and actual mock-exam scores."""
import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from forecast_calibration import DatasetError, FIELDS, evaluate, markdown, read_csv


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=('template','validate','evaluate'))
    parser.add_argument('--input',type=Path)
    parser.add_argument('--output',type=Path,help='New private output file; never overwrites an existing file')
    parser.add_argument('--format',choices=('json','markdown'),default='json')
    args=parser.parse_args()
    try:
        if args.command=='template':
            if not args.output: parser.error('template requires --output')
            with args.output.open('x',encoding='utf-8',newline='') as stream: csv.writer(stream).writerow(FIELDS)
            print('Создан пустой шаблон. Примеров с вымышленными результатами в нём нет.')
            return
        if not args.input: parser.error('--input is required')
        rows=read_csv(args.input)
        if args.command=='validate':
            print(json.dumps({'valid':True,'observations':len(rows),'students':len({r.student for r in rows}),
                              'model_version':rows[0].model_version},ensure_ascii=False))
            return
        report=evaluate(rows)
        result=markdown(report) if args.format=='markdown' else json.dumps(report,ensure_ascii=False,indent=2)+'\n'
        if args.output:
            with args.output.open('x',encoding='utf-8') as stream: stream.write(result)
            print('Агрегированный отчёт сохранён. Модель сайта не изменена.')
        else: print(result,end='')
    except (DatasetError,OSError,csv.Error) as exc:
        parser.exit(2,f'Ошибка: {exc}\n')


if __name__=='__main__': main()
