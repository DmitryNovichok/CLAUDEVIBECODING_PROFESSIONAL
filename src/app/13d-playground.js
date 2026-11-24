  const playgroundLanguages = {
    cpp: { name: 'C++', file: 'main.cpp', worker: 'cpp-worker.js', example:
      '#include <iostream>\n\nint main() {\n    int a, b;\n    std::cin >> a >> b;\n    std::cout << a + b << "\\n";\n}\n' },
    python: { name: 'Python', file: 'solution.py', worker: 'py-worker.js', example:
      'a, b = map(int, input().split())\nprint(a + b)\n' },
  };
  let closeCodePlayground = null;

  function openCodePlayground() {
    if (courseShown && pageKind === 'playground' && closeCodePlayground) return;
    if (!leaveExam()) return;
    if (pyOpen()) togglePy(false);
    if (bdOpen()) toggleBoard(false);
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    leaveCourse();
    courseShown = true; pageKind = 'playground'; cur = null;
    navPush({ v: 'playground' });
    renderSidebar();
    $('#scopeInfo').textContent = ''; $('#sessionInfo').textContent = '';
    trainerEl.innerHTML = `<section class="code-playground" aria-labelledby="playground-title">
      <header class="pg-heading"><button type="button" class="link-btn" data-pg-back>← На главную</button>
        <h1 id="playground-title" tabindex="-1">Редактор кода</h1></header>
      <div class="pg-layout">
        <section class="pg-source" aria-label="Исходный код">
          <div class="pg-toolbar"><div class="pg-languages" role="group" aria-label="Язык программы">
            <button type="button" data-pg-lang="cpp" aria-pressed="false">C++</button>
            <button type="button" data-pg-lang="python" aria-pressed="false">Python</button></div>
            <button class="btn primary pg-run" type="button" data-pg-run title="Ctrl+Enter или ⌘+Enter">Запустить</button>
            <button class="btn pg-run" type="button" data-pg-stop hidden>Стоп</button></div>
          <label class="pg-filename" for="pg-source"></label>
          <div class="pg-edit"><pre class="pg-lines" aria-hidden="true"></pre><textarea id="pg-source" class="pg-code" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="120000"></textarea></div>
        </section>
        <div class="pg-io"><section class="pg-input"><label for="pg-stdin">Входные данные</label>
          <textarea id="pg-stdin" rows="3" spellcheck="false" maxlength="120000" aria-label="Входные данные"></textarea>
          <div class="pg-files"><label class="pg-choose"><span>Добавить файл</span><input type="file" aria-label="Добавить файл"></label>
            <span class="pg-file-name"></span><button class="link-btn" type="button" data-pg-remove hidden>Убрать</button></div>
        </section>
        <section class="pg-result" aria-labelledby="pg-output-title"><h2 id="pg-output-title">Вывод</h2>
          <pre class="pg-output" tabindex="0" aria-labelledby="pg-output-title"></pre></section></div>
      </div><p class="pg-status" role="status"></p></section>`;

    const root = trainerEl.querySelector('.code-playground');
    const find = selector => root.querySelector(selector);
    const code = find('#pg-source'), stdin = find('#pg-stdin'), output = find('.pg-output');
    const status = find('.pg-status'), chooseFile = find('input[type=file]');
    const runButton = find('[data-pg-run]'), stopButton = find('[data-pg-stop]');
    const owner = codeKey('playground'), savedLanguage = readJSON(owner + '.language');
    let language = savedLanguage === 'python' ? 'python' : 'cpp';
    let worker = null, ready = false, busy = false, timer = 0, file = null, generation = 0;
    const draftKey = () => owner + '.' + language;
    const lines = find('.pg-lines');
    function lineNumbers() {
      const count = code.value.split('\n').length;
      if (lines.dataset.count !== String(count)) {
        lines.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
        lines.dataset.count = String(count);
      }
      lines.scrollTop = code.scrollTop;
    }
    function saveDraft() { writeJSON(draftKey(), { code: code.value, stdin: stdin.value }); }
    function controls(running) {
      busy = running; runButton.hidden = running; stopButton.hidden = !running;
      output.setAttribute('aria-busy', String(running));
    }
    function stop(message = '') {
      ++generation;
      clearTimeout(timer);
      worker?.terminate(); worker = null; ready = false;
      controls(false);
      if (message) status.textContent = message;
    }
    function loadDraft() {
      const def = playgroundLanguages[language], draft = readJSON(draftKey());
      code.value = typeof draft?.code === 'string' ? draft.code : def.example;
      stdin.value = typeof draft?.stdin === 'string' ? draft.stdin : '3 5';
      find('.pg-filename').textContent = def.file;
      code.setAttribute('aria-label', 'Исходный код ' + def.name);
      root.querySelectorAll('[data-pg-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pgLang === language)));
      code.scrollTop = 0; code.scrollLeft = 0; lineNumbers();
      output.textContent = ''; status.textContent = '';
    }
    function displayFile(selected) {
      stop(); file = selected;
      find('.pg-file-name').textContent = selected?.name || '';
      find('[data-pg-remove]').hidden = !selected;
      if (!selected) chooseFile.value = '';
      status.textContent = '';
    }
    function deadline(ms, message) {
      clearTimeout(timer);
      timer = setTimeout(() => stop(message), ms);
    }
    function executing() {
      status.textContent = 'Программа выполняется…';
      deadline(20000, 'Программа остановлена через 20 секунд.');
    }
    async function run() {
      if (busy) return;
      if (!code.value.trim()) { status.textContent = 'Введите программу.'; code.focus(); return; }
      const ticket = ++generation, selected = file;
      const command = { type: 'run', code: code.value, stdin: stdin.value };
      saveDraft(); output.textContent = ''; controls(true);
      const name = playgroundLanguages[language].name;
      status.textContent = language === 'cpp' ? 'Подготовка C++…' : 'Подготовка Python…';
      deadline(150000, 'Среда не успела запуститься. Повторите запуск.');
      try {
        if (selected) command.localFile = { name: selected.name, data: await selected.arrayBuffer() };
        if (generation !== ticket) return;
        if (!worker) worker = new window.EgeCodeWorker(playgroundLanguages[language].worker + (language === 'python' && RULES.py_local ? '?local=1' : ''));
        worker.onerror = () => {
          if (generation === ticket) stop(name + ' не удалось загрузить. Повторите запуск.');
        };
        worker.onmessage = ({ data }) => {
          if (generation !== ticket || !busy) return;
          if (data.type === 'ready') { ready = true; executing(); }
          else if (data.type === 'running') executing();
          else if (data.type === 'status') status.textContent = data.text;
          else if (data.type === 'out' || data.type === 'err') {
            const room = 120000 - output.textContent.length;
            output.append(document.createTextNode(data.text.slice(0, room)));
            if (data.text.length > room) stop('Достигнут предел вывода. Программа остановлена.');
          } else if (data.type === 'done') {
            clearTimeout(timer); controls(false);
            status.textContent = data.ok ? (output.textContent ? 'Программа завершена.' : 'Программа завершена без вывода.') : 'Ошибка. Подробности в окне вывода.';
            if (data.fatal) stop();
          }
        };
        if (language === 'python' && ready) executing();
        worker.postMessage(command);
      } catch (err) {
        if (generation === ticket) stop(err.message || 'Не удалось запустить программу.');
      }
    }
    code.addEventListener('input', () => { lineNumbers(); saveDraft(); });
    code.addEventListener('scroll', () => { lines.scrollTop = code.scrollTop; });
    stdin.addEventListener('input', saveDraft);
    root.addEventListener('click', e => {
      const lang = e.target.closest('[data-pg-lang]')?.dataset.pgLang;
      if (lang && lang !== language) {
        saveDraft(); stop(); language = lang; writeJSON(owner + '.language', lang); loadDraft();
      } else if (e.target.closest('[data-pg-run]')) run();
      else if (e.target.closest('[data-pg-stop]')) { stop('Выполнение остановлено.'); runButton.focus(); }
      else if (e.target.closest('[data-pg-remove]')) displayFile(null);
      else if (e.target.closest('[data-pg-back]')) {
        openHub();
        trainerEl.querySelector('[data-open-playground]')?.focus();
      }
    });
    root.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    });
    chooseFile.addEventListener('change', () => {
      const chosen = chooseFile.files[0];
      if (!chosen) return;
      if (chosen.size > 16 * 1024 * 1024 || chosen.name.length > 240 || /[/\\\x00-\x1f]/.test(chosen.name) || ['.', '..'].includes(chosen.name)) {
        chooseFile.value = '';
        status.textContent = 'Выберите файл размером до 16 МБ с обычным именем.'; return;
      }
      displayFile(chosen);
    });
    function onHide() { stop(busy ? 'Выполнение остановлено.' : ''); }
    function dispose() {
      stop(); observer.disconnect();
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('egeshka:session-ended', dispose);
      code.value = ''; stdin.value = ''; output.textContent = ''; file = null; chooseFile.value = '';
      root.remove(); closeCodePlayground = null;
    }
    const observer = new MutationObserver(() => { if (!root.isConnected) dispose(); });
    observer.observe(trainerEl, { childList: true });
    closeCodePlayground = dispose;
    window.addEventListener('pagehide', onHide);
    window.addEventListener('egeshka:session-ended', dispose);
    loadDraft();
    window.scrollTo(0, 0); find('#playground-title').focus({ preventScroll: true });
  }
