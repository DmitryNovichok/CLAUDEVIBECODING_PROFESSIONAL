  // Python runs inside the existing disposable browser worker. Only match ranges reach the course grader.
  const PYC_REGEX_RUN = `import json, re
data = json.loads(input())
try:
    regex = re.compile(data['pattern'])
    rows = []
    for text in data['texts']:
        if data['mode'] == 'fullmatch':
            m = regex.fullmatch(text)
            spans = [m.span()] if m else []
        elif data['mode'] == 'overlap':
            if not regex.groups:
                raise ValueError('Помести фрагмент в первую захватывающую группу (…).')
            spans = [m.span(1) for m in regex.finditer(text)]
            if any(start < 0 for start, end in spans):
                raise ValueError('Первая группа должна захватывать фрагмент в каждом совпадении.')
        else:
            spans = [m.span() for m in regex.finditer(text)]
        rows.append(spans)
    print(json.dumps({'rows': rows}))
except re.error as exc:
    hints = {
        'unterminated character set': 'Закрой класс символов квадратной скобкой ].',
        'missing ), unterminated subpattern': 'Проверь, где заканчивается группа, и добавь закрывающую скобку ).',
        'unbalanced parenthesis': 'Для закрывающей скобки нужна парная открывающая. Для поиска самой скобки поставь перед ней обратную косую черту.',
        'nothing to repeat': 'Поставь перед знаком повтора символ, класс или группу, которую нужно повторить.',
        'min repeat greater than max repeat': 'В {m,n} сначала укажи меньшее число, затем большее.'
    }
    print(json.dumps({'error': hints.get(exc.msg, exc.msg), 'position': exc.pos}))
except (ValueError, OverflowError, RecursionError) as exc:
    print(json.dumps({'error': str(exc)}))`;

  function pycRegexRanges(text, spans) {
    const chars = [...text]; // Python indexes Unicode code points.
    const cuts = [...new Set([0, chars.length, ...spans.flat()])].sort((a, b) => a - b);
    const marked = cuts.slice(1).map((end, i) => {
      const start = cuts[i], part = esc(chars.slice(start, end).join(''));
      return spans.some(([a, b]) => a <= start && end <= b) ? `<mark>${part}</mark>` : part;
    }).join('');
    const parts = spans.slice(0, 16).map(([a, b]) =>
      `<code>[${a}:${b}] ${a === b ? 'пустое совпадение' : esc(chars.slice(a, b).join(''))}</code>`);
    if (spans.length > parts.length) parts.push(`… ещё ${spans.length - parts.length}`);
    return `<samp class="pyc-re-text">${marked || 'Пустая строка'}</samp>
      <div class="pyc-re-spans">${parts.join(' ') || 'Совпадений нет'}</div>`;
  }

  function pycRegexHtml(t) {
    const spec = t.regex, example = spec.samples[0];
    const method = {finditer: 're.finditer · m.span()', overlap: 're.finditer · m.span(1)', fullmatch: 're.fullmatch'}[spec.mode];
    return `<form class="pyc-re" data-pyc-regex="${esc(t.id)}" autocomplete="off">
      <div class="pyc-re-example"><b>Ожидаемые совпадения</b>${pycRegexRanges(example, spec.example_spans)}</div>
      <fieldset><label>Шаблон Python re <small>${method}</small>
        <input class="inp" data-re-pattern maxlength="240" spellcheck="false" autocapitalize="off" required
          aria-describedby="re-pattern-help-${esc(t.id)}" value="${esc(readCode('pyc-re:' + t.id) || '')}"></label>
        <small id="re-pattern-help-${esc(t.id)}">Введи содержимое строки <code>r'…'</code> без кавычек.</small>
        <div class="pyc-re-actions"><button type="submit" class="btn primary">Проверить шаблон</button>
          <button class="btn" type="button" data-re-stop hidden>Остановить</button></div>
        <details class="pyc-more"><summary>Попробовать на своей строке</summary>
          <label>Текст для поиска<textarea class="inp" data-re-text rows="2" maxlength="160" spellcheck="false" autocapitalize="off">${esc(example)}</textarea></label>
          <button class="btn" type="button" data-re-preview>Показать совпадения</button></details>
      </fieldset>
      <div class="pyc-msg" aria-live="polite">${t.ok ? 'Задача зачтена. Можно попробовать другой шаблон.' : ''}</div>
    </form>`;
  }

  function pycRegexMismatch(t, actual, mismatch) {
    const index = mismatch.index, text = t.regex.samples[index];
    return `<b>Проверь строку ${index + 1} из ${t.regex.samples.length}</b>
      <div>Твой шаблон</div>${pycRegexRanges(text, actual[index])}
      <div>Ожидалось</div>${pycRegexRanges(text, mismatch.expected)}`;
  }

  function pycRunRegex(form, preview) {
    const id = form.dataset.pycRegex, t = pycTask(id);
    if (!t?.regex || !form.reportValidity()) return;
    if (PYC_TEST) { toast('Дождись завершения текущей проверки.', 2500); return; }
    const msg = form.querySelector('.pyc-msg'), pattern = form.querySelector('[data-re-pattern]').value;
    const texts = preview ? [form.querySelector('[data-re-text]').value] : t.regex.samples;
    const submit = form.querySelector('[type=submit]'), custom = form.querySelector('[data-re-preview]'), stop = form.querySelector('[data-re-stop]');
    let worker;
    try { worker = new EgePythonWorker('py-worker.js' + (RULES.py_local ? '?local=1' : '')); }
    catch { msg.textContent = 'Не удалось открыть Python в браузере. Повтори проверку.'; return; }
    submit.disabled = custom.disabled = true;
    stop.hidden = false;
    msg.className = 'pyc-msg'; msg.textContent = 'Загружаю Python…';
    const current = learningSessionGuard();
    let output = '', error = '', finished = false;
    let timer = setTimeout(() => finish('Не удалось загрузить Python. Повтори попытку.'), 90000);
    function finish(message) {
      if (finished) return;
      finished = true; clearTimeout(timer); worker.terminate(); PYC_TEST = null;
      submit.disabled = custom.disabled = false; stop.hidden = true;
      if (message) msg.textContent = message;
    }
    PYC_TEST = { button: submit, cancel: () => finish('Проверка остановлена.') };
    worker.onerror = () => finish('Не удалось запустить Python. Повтори попытку.');
    worker.onmessage = e => {
      if (finished) return;
      if (!form.isConnected || !current()) { finish(); return; }
      const m = e.data;
      if (m.type === 'ready') {
        clearTimeout(timer);
        timer = setTimeout(() => finish('Поиск остановлен по времени. Упрости вложенные повторы и попробуй снова.'), 5000);
        msg.textContent = 'Проверяю совпадения…';
        worker.postMessage({type: 'run', code: PYC_REGEX_RUN, stdin: JSON.stringify({pattern, mode: t.regex.mode, texts})});
      } else if (m.type === 'out') output += m.text;
      else if (m.type === 'err') error += m.text;
      else if (m.type === 'done') {
        finish();
        if (!m.ok || error) { msg.textContent = error.trim().slice(0, 400) || 'Не удалось выполнить поиск.'; return; }
        let r;
        try { r = JSON.parse(output); } catch { msg.textContent = 'Python вернул неполный результат. Повтори проверку.'; return; }
        if (r.error) {
          const where = Number.isInteger(r.position) ? ' (позиция ' + r.position + ', считая с 0)' : '';
          msg.textContent = 'Ошибка шаблона' + where + ': ' + r.error;
          return;
        }
        if (preview) {
          const spans = r.rows[0], longest = Math.max(0, ...spans.map(([a, b]) => b - a));
          msg.innerHTML = `<b>Совпадений: ${spans.length}. Максимальная длина: ${longest}.</b>${pycRegexRanges(texts[0], spans)}`;
        } else {
          const fields = form.querySelector('fieldset');
          fields.disabled = true;
          msg.textContent = 'Сохраняю результат…';
          pycSubmit(id, form, { matches: r.rows, code: 'import re\npattern = re.compile(' + JSON.stringify(pattern) + ')' })
            .finally(() => { fields.disabled = false; });
        }
      }
    };
  }

  trainerEl.addEventListener('submit', e => {
    if (!e.target.matches('[data-pyc-regex]')) return;
    e.preventDefault(); pycRunRegex(e.target, false);
  });
  trainerEl.addEventListener('click', e => {
    const form = e.target.closest('[data-pyc-regex]');
    if (!form) return;
    if (e.target.closest('[data-re-stop]')) pycStopTests();
    if (e.target.closest('[data-re-preview]')) pycRunRegex(form, true);
  });
  trainerEl.addEventListener('input', e => {
    const form = e.target.closest('[data-pyc-regex]');
    if (!form) return;
    if (form.contains(PYC_TEST?.button || null)) pycStopTests();
    form.querySelector('.pyc-msg').textContent = '';
    if (e.target.matches('[data-re-pattern]')) writeCode('pyc-re:' + form.dataset.pycRegex, e.target.value);
  });
