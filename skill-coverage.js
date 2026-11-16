/* Public reference inventory: no lesson answers, code or personal progress. */
(function () {
  'use strict';
  const root = document.getElementById('skillCoverage');
  if (!root) return;
  const topic = document.getElementById('skillTopic'), search = document.getElementById('skillSearch');
  const state = document.getElementById('skillState'), status = document.getElementById('skillStatus');
  const results = document.getElementById('skillRows'), retry = document.getElementById('skillRetry');
  const esc = text => String(text ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  let report = null, loading = false;
  const label = row => row.archive ? 'Архив ' + (row.archive_label || '23_old') : '№' + row.exam_nums.join('–');
  function evidence(item) {
    if (item.kind === 'lesson') return `${esc(item.label || 'Урок №' + item.n)} · слайд ${item.slide}: ${esc(item.title)}`;
    if (item.kind === 'lab') return `Лаборатория «${esc(item.title)}»: отдельная учебная модель`;
    const count = item.tasks_scope === 'selected_examples' ? `подобрано примеров: ${item.linked_tasks}` : `задач в связанном уровне: ${item.linked_tasks}; это не счётчик навыка`;
    return `Python · уровень ${item.level} «${esc(item.title)}» (${count})${item.slides?.length ? '<br>' + item.slides.map(s => `Слайд ${s.slide}: ${esc(s.title)}`).join('; ') : ''}`;
  }
  function render() {
    if (!report) return;
    const query = search.value.trim().toLocaleLowerCase('ru');
    const rows = report.rows.filter(row => (!topic.value || row.exam_nums.includes(Number(topic.value))) &&
      (state.value !== 'missing' || !row.evidence.length) && (state.value !== 'issues' || row.reference_issues.length) &&
      (!query || [row.title, row.topic, row.limitation, ...row.evidence.map(e => e.title)].join(' ').toLocaleLowerCase('ru').includes(query)));
    const summary = report.summary;
    status.textContent = `Показано: ${rows.length}. В карте с архивом — ${summary.defined_types_and_skills} типов и навыков; ссылки на материалы найдены для ${summary.with_material_references}. Содержательная полнота не подтверждена.`;
    results.innerHTML = rows.map(row => {
      const found = row.evidence.length > 0;
      const material = row.reference_issues.length ? 'Ссылки или входные файлы требуют проверки' : found ? 'Материалы найдены' : 'Явный материал в карте не найден';
      const p = row.practice;
      const bank = p.count == null ? 'Счётчик банка недоступен.' : p.scope === 'task_type' ? `Банк: ${p.count} заданий по автоматической классификации.` : `Отдельного счётчика навыка нет. В ${p.scope === 'topic' ? 'общем разделе' : 'родительском типе'} — ${p.count} заданий; они не подтверждают покрытие этого навыка.`;
      return `<article class="sk-card" data-skill-id="${esc(row.id)}"><h3>${esc(label(row))} · ${esc(row.title)}</h3><p class="sk-material">${material}</p>${row.limitation ? `<p>${esc(row.limitation)}</p>` : ''}<p class="sk-bank">${bank}</p>${found ? `<details><summary>Где найден материал (${row.evidence.length})</summary><ul>${row.evidence.map(e => `<li>${evidence(e)}${e.inputs?.missing || e.inputs?.invalid ? '<strong> Входной файл недоступен или ссылка некорректна.</strong>' : ''}</li>`).join('')}</ul></details>` : ''}</article>`;
    }).join('') || '<p>По этим фильтрам записей нет. Попробуйте другой номер или запрос.</p>';
  }
  async function load() {
    if (loading || report) return;
    loading = true; retry.hidden = true; status.textContent = 'Проверяем ссылки на материалы…';
    try {
      const response = await fetch('api/course/coverage?skills=1', {cache:'no-store'});
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json(), candidate = data.skill_coverage;
      if (candidate?.schema !== 1 || !Array.isArray(candidate.rows) || !candidate.summary || !Array.isArray(data.topics)) throw new Error('invalid');
      report = candidate;
      topic.innerHTML = '<option value="">Все номера и архив</option>' + data.topics.map(t => `<option value="${Number(t.n)}">${t.archive ? 'Архив 23_old' : '№' + t.n} · ${esc(t.title)}</option>`).join('');
      render();
    } catch (_) { report = null; status.textContent = 'Карта навыков временно недоступна. Это не означает отсутствие материалов.'; retry.hidden = false; }
    finally { loading = false; }
  }
  root.addEventListener('toggle', () => { if (root.open) load(); });
  retry.addEventListener('click', load);
  for (const input of [topic, search, state]) input.addEventListener('input', render);
  if (root.open) load();
})();
