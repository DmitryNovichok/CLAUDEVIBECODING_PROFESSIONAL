// Обфускация одного уже сжатого скрипта: node run.cjs <вход> <выход> [<карта>]
// Карта соответствия (третий аргумент) нужна только вкладке «Ошибки» на сервере: в отданном коде ссылки на неё нет.
// Строки собраны в зашифрованный массив, имена заменены на шестнадцатеричные, код привязан к домену egeshka.online
// (на чужом домене не запускается и отправляет на egeshka.online). Seed фиксирован — результат одинаковый при каждой сборке.
'use strict';
const fs = require('fs');
const Obfuscator = require('javascript-obfuscator');
const [, , input, output, mapOut] = process.argv;
const code = fs.readFileSync(input, 'utf8');
const result = Obfuscator.obfuscate(code, {
  compact: true, seed: 20261113, target: 'browser',
  identifierNamesGenerator: 'hexadecimal', renameGlobals: false,
  stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.75,
  stringArrayRotate: true, stringArrayShuffle: true, stringArrayWrappersCount: 1, stringArrayWrappersType: 'variable',
  // тяжёлые приёмы (запутывание переходов, мёртвый код, «самозащита») заметно тормозят сайт на слабых телефонах — выключены
  controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false, debugProtection: false,
  splitStrings: false, numbersToExpressions: false, transformObjectKeys: false, unicodeEscapeSequence: false,
  disableConsoleOutput: false, simplify: true,
  domainLock: ['egeshka.online', '.egeshka.online', 'localhost', '127.0.0.1'],
  domainLockRedirectUrl: 'https://egeshka.online/',
  sourceMap: !!mapOut, sourceMapMode: 'separate', sourceMapSourcesMode: 'sources', inputFileName: 'input.js',
});
// ссылку на карту из кода убираем: карта посетителю не отдаётся
const out = result.getObfuscatedCode().replace(/\n?\/\/# sourceMappingURL=\S*\s*$/, '');
fs.writeFileSync(output, out);
if (mapOut) fs.writeFileSync(mapOut, result.getSourceMap());
