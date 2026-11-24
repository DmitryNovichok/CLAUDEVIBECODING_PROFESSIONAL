  const playgroundLanguages = {
    cpp: { name: 'C++', file: 'main.cpp', worker: 'cpp-worker.js', example:
      '#include <iostream>\n\nint main() {\n    int a, b;\n    std::cin >> a >> b;\n    std::cout << a + b << "\\n";\n}\n' },
    python: { name: 'Python', file: 'solution.py', worker: 'py-worker.js', example:
      'a, b = map(int, input().split())\nprint(a + b)\n' },
  };
  let closeCodePlayground = null;

  const playgroundCppKeywords = new Set((
    'alignas alignof and and_eq asm auto bitand bitor bool break case catch char char16_t char32_t class compl const '
    + 'constexpr const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false '
    + 'float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private '
    + 'protected public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch '
    + 'template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq'
  ).split(' '));
  const playgroundCppLibrary = new Set('std string vector array pair map set cin cout cerr endl ifstream ofstream size_t'.split(' '));
  // Directives start on a line boundary. Unfinished block comments and raw strings extend to the end of the document.
  const playgroundCppTokens = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|(?![\s\S])))|(?<directive>^[ \t]*#[ \t]*[a-zA-Z_]\w*)(?<header>[ \t]*<[^>\n]*>)?|(?<string>(?:u8|[uUL])?R"(?<delim>[^\s()\\]{0,16})\([\s\S]*?(?:\)\k<delim>"|(?![\s\S]))|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?)|(?<number>\b(?:0[xX][\da-fA-F']+|0[bB][01']+|\d[\d']*(?:\.[\d']*)?(?:[eE][+-]?\d+)?)[uUlLfF]*\b)|(?<call>[a-zA-Z_]\w*)(?=[ \t]*\()|[a-zA-Z_]\w*/gm;
  function highlightPlaygroundCpp(code) {
    const color = (kind, value) => '<span class="hl-' + kind + '">' + esc(value) + '</span>';
    let html = '', end = 0;
    for (const match of code.matchAll(playgroundCppTokens)) {
      const token = match[0], g = match.groups;
      html += esc(code.slice(end, match.index));
      end = match.index + token.length;
      if (g.directive) {
        html += color('dec', g.directive) + (g.header ? color('str', g.header) : '');
      } else {
        let kind;
        if (g.comment) kind = 'com';
        else if (g.string) kind = 'str';
        else if (g.number) kind = 'num';
        else if (playgroundCppKeywords.has(token)) kind = 'kw';
        else if (playgroundCppLibrary.has(token)) kind = 'bi';
        else if (g.call) kind = 'def';
        html += kind ? color(kind, token) : esc(token);
      }
    }
    return html + esc(code.slice(end));
  }

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
    trainerEl.innerHTML = `<section class="code-playground" aria-live="off" aria-labelledby="playground-title">
      <header class="pg-heading"><button type="button" data-pg-back>Главная</button><span aria-hidden="true">/</span>
        <h1 id="playground-title" tabindex="-1">Редактор кода</h1></header>
      <div class="pg-workbench">
        <div class="pg-toolbar">
          <div class="pg-docs" role="tablist" aria-label="Файлы программы">
            ${Object.entries(playgroundLanguages).map(([key, lang]) => `<button type="button" role="tab" id="pg-tab-${key}" data-pg-lang="${key}"
              aria-label="${lang.file} (${lang.name})" aria-controls="pg-editor" aria-selected="false" tabindex="-1">
              <span class="pg-file-mark" aria-hidden="true">${lang.name}</span>${lang.file}</button>`).join('')}
          </div>
          <div class="pg-actions"><kbd class="pg-shortcut" aria-hidden="true"></kbd>
            <button type="button" class="pg-run" data-pg-run aria-keyshortcuts="Control+Enter Meta+Enter">Запустить</button>
            <button type="button" class="pg-run" data-pg-stop hidden>Стоп</button></div>
        </div>
        <div class="pg-edit" id="pg-editor" role="tabpanel" aria-labelledby="pg-tab-cpp">
          <div class="pg-active-line" aria-hidden="true"></div>
          <div class="pg-gutter" aria-hidden="true"><pre class="pg-lines"></pre></div>
          <div class="pg-text"><div class="pg-paint" aria-hidden="true"><pre class="pg-highlight"></pre></div>
            <textarea id="pg-source" class="pg-code" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="120000"></textarea></div>
        </div>
        <div class="pg-dock-bar">
          <div class="pg-dock-tabs" role="tablist" aria-label="Консоль программы">
            <button type="button" role="tab" data-pg-pane="input" id="pg-input-tab" aria-controls="pg-input" aria-selected="true">Ввод</button>
            <button type="button" role="tab" data-pg-pane="output" id="pg-output-tab" aria-controls="pg-result" aria-selected="false" tabindex="-1">Вывод</button>
          </div>
          <div class="pg-files"><label class="pg-choose"><span class="pg-file-name">Добавить файл</span><input type="file" aria-label="Добавить файл"></label>
            <button type="button" data-pg-remove aria-label="Убрать файл" title="Убрать файл" hidden>×</button></div>
          <button type="button" class="pg-fold" data-pg-fold aria-controls="pg-dock-content" aria-expanded="true" aria-label="Свернуть консоль" title="Свернуть консоль"></button>
        </div>
        <div id="pg-dock-content" class="pg-dock-content">
          <div id="pg-input" role="tabpanel" aria-labelledby="pg-input-tab"><textarea id="pg-stdin" rows="3" spellcheck="false" maxlength="120000" aria-label="Входные данные" placeholder="Введите входные данные"></textarea></div>
          <div id="pg-result" role="tabpanel" aria-labelledby="pg-output-tab" hidden><pre class="pg-output" tabindex="0" aria-label="Вывод программы"></pre></div>
        </div>
        <footer class="pg-statusbar"><span class="pg-status" role="status" aria-live="polite"></span><span class="pg-position"></span><span class="pg-mode"></span></footer>
      </div></section>`;

    const root = trainerEl.querySelector('.code-playground');
    const find = selector => root.querySelector(selector);
    const code = find('#pg-source'), stdin = find('#pg-stdin'), output = find('.pg-output');
    const status = find('.pg-status'), chooseFile = find('input[type=file]');
    const runButton = find('[data-pg-run]'), stopButton = find('[data-pg-stop]');
    const editor = find('#pg-editor'), lines = find('.pg-lines'), paint = find('.pg-highlight');
    const position = find('.pg-position'), mode = find('.pg-mode'), fold = find('[data-pg-fold]');
    const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ Enter' : 'Ctrl + Enter';
    find('.pg-shortcut').textContent = shortcut; runButton.title = 'Запустить (' + shortcut + ')';
    const owner = codeKey('playground'), savedLanguage = readJSON(owner + '.language');
    let language = savedLanguage === 'python' ? 'python' : 'cpp';
    let worker = null, ready = false, busy = false, timer = 0, file = null, generation = 0;
    const draftKey = () => owner + '.' + language;
    let pane = 'input';
    const editorViews = new Map();
    function selectTab(tab) {
      for (const item of tab.parentElement.querySelectorAll('[role=tab]')) {
        item.setAttribute('aria-selected', String(item === tab));
        item.tabIndex = item === tab ? 0 : -1;
      }
    }
    function showPane(which, expanded = true) {
      pane = which;
      selectTab(find('[data-pg-pane="' + which + '"]'));
      find('#pg-input').hidden = which !== 'input';
      find('#pg-result').hidden = which !== 'output';
      find('.pg-files').hidden = !expanded || which !== 'input';
      find('#pg-dock-content').hidden = !expanded;
      fold.setAttribute('aria-expanded', String(expanded));
      fold.title = expanded ? 'Свернуть консоль' : 'Развернуть консоль';
      fold.setAttribute('aria-label', fold.title);
      root.classList.toggle('pg-folded', !expanded);
    }
    function syncEditorScroll() {
      lines.style.transform = 'translateY(' + -code.scrollTop + 'px)';
      paint.style.transform = 'translate(' + -code.scrollLeft + 'px,' + -code.scrollTop + 'px)';
      editor.style.setProperty('--pg-scroll-y', code.scrollTop + 'px');
    }
    function updatePosition() {
      const caret = code.selectionDirection === 'backward' ? code.selectionStart : code.selectionEnd;
      const before = code.value.slice(0, caret).split('\n');
      let column = 0;
      for (const ch of before[before.length - 1]) column += ch === '\t' ? 4 - column % 4 : 1;
      position.textContent = 'Стр ' + before.length + ', стлб ' + (column + 1);
      editor.style.setProperty('--pg-line-index', String(before.length - 1));
    }
    function paintCode() {
      const count = code.value.split('\n').length;
      if (lines.dataset.count !== String(count)) {
        lines.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
        lines.dataset.count = String(count);
      }
      paint.innerHTML = (language === 'cpp' ? highlightPlaygroundCpp(code.value) : highlightPy(code.value)) + '\n';
      syncEditorScroll(); updatePosition();
    }
    function saveDraft() { writeJSON(draftKey(), { code: code.value, stdin: stdin.value }); }
    function setStatus(message, state = 'idle') {
      status.textContent = message;
      status.dataset.state = state;
    }
    function controls(running) {
      const focused = document.activeElement;
      busy = running; runButton.hidden = running; stopButton.hidden = !running;
      if (running && focused === runButton) stopButton.focus({preventScroll:true});
      if (!running && focused === stopButton) runButton.focus({preventScroll:true});
      output.setAttribute('aria-busy', String(running));
    }
    function stop(message = '') {
      ++generation;
      clearTimeout(timer);
      worker?.terminate(); worker = null; ready = false;
      controls(false);
      if (message) setStatus(message);
    }
    function loadDraft() {
      const def = playgroundLanguages[language], draft = readJSON(draftKey());
      code.value = typeof draft?.code === 'string' ? draft.code : def.example;
      stdin.value = typeof draft?.stdin === 'string' ? draft.stdin : '3 5';
      const tab = find('[data-pg-lang="' + language + '"]');
      selectTab(tab); editor.setAttribute('aria-labelledby', tab.id);
      mode.textContent = language === 'cpp' ? 'C++17' : def.name;
      code.setAttribute('aria-label', 'Исходный код ' + def.name);
      const view = editorViews.get(language);
      code.setSelectionRange(view?.start || 0, view?.end || 0, view?.direction || 'none');
      code.scrollTop = view?.top || 0; code.scrollLeft = view?.left || 0;
      paintCode();
      output.textContent = ''; output.dataset.hint = 'Здесь появится вывод программы.';
      setStatus('Готов к запуску'); showPane('input');
    }
    function displayFile(selected) {
      stop(); file = selected;
      find('.pg-file-name').textContent = selected?.name || 'Добавить файл';
      find('.pg-choose').title = selected ? 'Заменить ' + selected.name : 'Добавить файл';
      find('[data-pg-remove]').hidden = !selected;
      if (!selected) chooseFile.value = '';
      setStatus('Готов к запуску');
    }
    function deadline(ms, message) {
      clearTimeout(timer);
      timer = setTimeout(() => stop(message), ms);
    }
    function executing() {
      setStatus('Программа выполняется…', 'busy');
      deadline(20000, 'Программа остановлена через 20 секунд.');
    }
    async function run() {
      if (busy) return;
      if (!code.value.trim()) { setStatus('Введите программу.'); code.focus(); return; }
      const ticket = ++generation, selected = file;
      const command = { type: 'run', code: code.value, stdin: stdin.value };
      saveDraft(); output.textContent = ''; output.dataset.hint = ''; showPane('output'); controls(true);
      const name = playgroundLanguages[language].name;
      setStatus(language === 'cpp' ? 'Подготовка C++…' : 'Подготовка Python…', 'busy');
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
          else if (data.type === 'status') setStatus(data.text, 'busy');
          else if (data.type === 'out' || data.type === 'err') {
            const room = 120000 - output.textContent.length;
            const follow = output.scrollTop + output.clientHeight >= output.scrollHeight - 2;
            output.append(document.createTextNode(data.text.slice(0, room)));
            if (follow) output.scrollTop = output.scrollHeight;
            if (data.text.length > room) stop('Достигнут предел вывода. Программа остановлена.');
          } else if (data.type === 'done') {
            clearTimeout(timer); controls(false);
            setStatus(data.ok ? (output.textContent ? 'Программа завершена.' : 'Программа завершена без вывода.') : 'Ошибка. Подробности в окне вывода.', data.ok ? 'ok' : 'error');
            if (data.fatal) stop();
          }
        };
        if (language === 'python' && ready) executing();
        worker.postMessage(command);
      } catch (err) {
        if (generation === ticket) stop(err.message || 'Не удалось запустить программу.');
      }
    }
    code.addEventListener('input', () => { paintCode(); saveDraft(); });
    code.addEventListener('scroll', syncEditorScroll);
    const onSelection = () => { if (document.activeElement === code) updatePosition(); };
    document.addEventListener('selectionchange', onSelection);
    stdin.addEventListener('input', saveDraft);
    root.addEventListener('click', e => {
      const lang = e.target.closest('[data-pg-lang]')?.dataset.pgLang;
      const paneTab = e.target.closest('[data-pg-pane]');
      if (lang && lang !== language) {
        editorViews.set(language, {start:code.selectionStart, end:code.selectionEnd, direction:code.selectionDirection, top:code.scrollTop, left:code.scrollLeft});
        saveDraft(); stop(); language = lang; writeJSON(owner + '.language', lang); loadDraft();
      } else if (paneTab) showPane(paneTab.dataset.pgPane);
      else if (e.target.closest('[data-pg-fold]')) showPane(pane, fold.getAttribute('aria-expanded') !== 'true');
      else if (e.target.closest('[data-pg-run]')) run();
      else if (e.target.closest('[data-pg-stop]')) { stop('Выполнение остановлено.'); runButton.focus(); }
      else if (e.target.closest('[data-pg-remove]')) displayFile(null);
      else if (e.target.closest('[data-pg-back]')) {
        openHub();
        trainerEl.querySelector('[data-open-playground]')?.focus();
      }
    });
    root.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); return; }
      const tab = e.target.closest('[role=tab]');
      if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const tabs = [...tab.parentElement.querySelectorAll('[role=tab]')];
      let next = tabs.indexOf(tab) + (e.key === 'ArrowLeft' ? -1 : 1);
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = tabs.length - 1;
      const target = tabs[(next + tabs.length) % tabs.length];
      target.click(); target.focus();
    });
    chooseFile.addEventListener('change', () => {
      const chosen = chooseFile.files[0];
      if (!chosen) return;
      if (chosen.size > 16 * 1024 * 1024 || chosen.name.length > 240 || /[/\\\x00-\x1f]/.test(chosen.name) || ['.', '..'].includes(chosen.name)) {
        chooseFile.value = '';
        setStatus('Выберите файл размером до 16 МБ с обычным именем.', 'error'); return;
      }
      displayFile(chosen);
    });
    function onHide() { stop(busy ? 'Выполнение остановлено.' : ''); }
    function dispose() {
      stop(); observer.disconnect();
      document.removeEventListener('selectionchange', onSelection);
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
