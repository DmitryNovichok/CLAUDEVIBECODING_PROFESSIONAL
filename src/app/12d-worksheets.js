  function pycSheetKey(t) { return codeKey('pyc-steps:' + t.id); }

  function pycSheetBody(t, rows, draft = []) {
    const sheet = t.worksheet, step = rows.length, done = step === sheet.rows.length;
    const cells = values => values.map(value => `<td>${esc(value)}</td>`).join('');
    const table = `<div class="pyc-sheet-table" tabindex="0" role="region" aria-label="Данные и ответы по шагам"><table>
      <thead><tr>${[...sheet.headings, ...sheet.fields.map(f => f.label)].map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${sheet.rows.map((given, i) => `<tr ${i < step ? 'data-checked' : i === step ? 'aria-current="step"' : ''}>
        ${cells(given)}${sheet.fields.map((_, j) => `<td data-answer>${esc(rows[i]?.[j] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const used = sheet.meter && Number(String(rows[step - 1]?.[sheet.meter.field] || 0).replace(',', '.'));
    const meter = sheet.meter ? `<label class="pyc-meter">Память после подтверждённых шагов · ${used} из ${sheet.meter.capacity} Кбайт
      <meter min="0" max="${sheet.meter.capacity}" value="${used}"></meter></label>` : '';
    const axis = sheet.axis ? `<ol class="pyc-energy" aria-label="Шкала энергий">${sheet.axis.map((e, i) =>
      `<li data-group="${esc(rows[i]?.[0] || '')}"><b>${esc(e)}</b><small>${rows[i] ? 'Гр. ' + esc(rows[i][0]) : '—'}</small></li>`).join('')}</ol>` : '';
    return axis + table + meter + (done ? '<b>Все шаги зачтены.</b>' : `<fieldset><legend>Шаг ${step + 1} из ${sheet.rows.length}</legend>
      <p>${sheet.headings.map((h, j) => `${esc(h)} — <b>${esc(sheet.rows[step][j])}</b>`).join(' · ')}</p>
      <div class="pyc-sheet-fields">${sheet.fields.map((f, j) => `<label>${esc(f.label)}
        ${f.choices.length ? `<select class="inp" data-cell required><option value="">Выбери</option>${f.choices.map(v =>
          `<option${v === draft[j] ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>` :
          `<input class="inp" data-cell inputmode="decimal" maxlength="80" required value="${esc(draft[j] || '')}">`}</label>`).join('')}
        <button class="btn primary" type="submit">${step + 1 === sheet.rows.length ? 'Завершить задачу' : 'Проверить шаг'}</button></div></fieldset>`);
  }

  function pycSheetHtml(t) {
    const saved = readJSON(pycSheetKey(t)) || {};
    const rows = t.ok ? t.ans.trim().split('\n').map(s => s.trim().split(/\s+/)) :
      (Array.isArray(saved.rows) && saved.rows.every(row => Array.isArray(row) && row.length === t.worksheet.fields.length)
        ? saved.rows.slice(0, t.worksheet.rows.length - 1) : []);
    return `<form class="pyc-sheet" data-pyc-sheet="${esc(t.id)}" autocomplete="off">${pycSheetBody(t, rows, Array.isArray(saved.draft) ? saved.draft : [])}</form>
      <div class="pyc-msg" aria-live="polite"></div>`;
  }
  function pycSheetValues(form) {
    return {rows: [...form.querySelectorAll('[data-checked]')].map(tr => [...tr.querySelectorAll('[data-answer]')].map(c => c.textContent)),
      draft: [...form.querySelectorAll('[data-cell]')].map(c => c.value.trim())};
  }
  function pycSheetResult(t, form, rows, cell) {
    const count = cell ? cell.row : rows.length, saved = {rows: rows.slice(0, count), draft: cell ? rows[count] : []};
    writeJSON(pycSheetKey(t), saved);
    form.innerHTML = pycSheetBody(t, saved.rows, saved.draft);
    const input = form.querySelectorAll('[data-cell]')[cell ? cell.column : 0];
    if (cell) input.setAttribute('aria-invalid', 'true');
    input.focus({preventScroll: true});
  }
  trainerEl.addEventListener('input', e => {
    const form = e.target.closest('[data-pyc-sheet]');
    if (!form) return;
    e.target.removeAttribute('aria-invalid');
    writeJSON(pycSheetKey(pycTask(form.dataset.pycSheet)), pycSheetValues(form));
  });
  trainerEl.addEventListener('submit', e => {
    const form = e.target.closest('[data-pyc-sheet]');
    if (!form) return;
    e.preventDefault();
    const fields = form.querySelector('fieldset');
    if (!fields || fields.disabled) return;
    const {rows, draft} = pycSheetValues(form);
    fields.disabled = true;
    pycSubmit(form.dataset.pycSheet, form, {rows: [...rows, draft]}).finally(() => { fields.disabled = false; });
  });
