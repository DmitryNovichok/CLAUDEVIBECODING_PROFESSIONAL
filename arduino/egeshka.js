/* Связка лаборатории Arduino (MicroLab) с сайтом Egeshka — вход, проверка доступа и запуск приложения.
   1) Лаборатория — раздел для вошедших учеников с доступом к лабораториям: без входа — на сайт, без доступа — к окну с паролем.
   2) Кнопка «← Egeshka» возвращает на главную сайта.
   На сайте приложение запускается после проверки доступа, с отдельными сохранениями каждого ученика. */
(function () {
  var remote = /^https?:$/.test(location.protocol), started = false, checking = false;
  window.EGE_ARDUINO_REQUIRE_AUTH = remote;
  // Приложение читает проекты только после проверки ученика; ошибка сети не снимает замок.
  var launch = function (sid) {
    if (started) return;
    started = true; window.EGE_ARDUINO_SID = sid;
    var script = document.createElement('script');
    script.type = 'module'; script.src = document.getElementById('egeArduinoApp').getAttribute('data-src');
    script.onload = function () { document.getElementById('egeGate').hidden = true; document.getElementById('appShell').hidden = false; };
    script.onerror = function () { showError('Не удалось загрузить лабораторию. Обнови страницу.'); };
    document.body.appendChild(script);
  };
  var showError = function (text) {
    document.getElementById('egeGateText').textContent = text;
    document.getElementById('egeGateRetry').hidden = false;
  };
  var check = async function () {
    if (checking) return;
    checking = true;
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 10000);
    document.getElementById('egeGateRetry').hidden = true;
    document.getElementById('egeGateText').textContent = 'Проверяем доступ к лаборатории…';
    try {
      // Cookie принадлежит текущему входу; старый токен другого ученика из localStorage не используем.
      var r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (r.status === 401) { location.replace('/'); return; }
      if (!r.ok) throw Error('network');
      var me = await r.json();
      if (!Number.isSafeInteger(me.sid) || me.sid <= 0) throw Error('identity');
      if (!me.lab) { location.replace('/#lab-arduino'); return; }
      if (started && me.sid !== window.EGE_ARDUINO_SID) { location.reload(); return; }
      if (started) {
        document.getElementById('egeGate').hidden = true;
        document.getElementById('appShell').hidden = false;
      } else launch(me.sid);
    } catch (e) { showError('Не удалось проверить доступ. Проверь соединение и повтори.'); }
    finally { checking = false; clearTimeout(timer); }
  };
  var recheck = function () {
    if (!remote || !started || document.visibilityState === 'hidden') return;
    document.getElementById('appShell').hidden = true;
    document.getElementById('egeGate').hidden = false;
    check();
  };
  document.addEventListener('visibilitychange', recheck);
  window.addEventListener('pageshow', function (e) { if (e.persisted) recheck(); });
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('egeGateRetry').onclick = function () { if (started) location.reload(); else check(); };
    if (remote) check(); else launch(null);
  });
  document.addEventListener('DOMContentLoaded', function () {
    var a = document.createElement('a');
    a.id = 'egeBack'; a.href = '/'; a.title = 'Вернуться на главную Egeshka';
    a.innerHTML = '<svg viewBox="0 0 64 64" width="34" height="34" aria-hidden="true"><rect x="4" y="9" width="56" height="51" rx="16" fill="#58a700"/><rect x="4" y="4" width="56" height="51" rx="16" fill="#58cc02"/><rect x="20" y="15" width="9" height="29" rx="4" fill="#fff"/><rect x="20" y="15" width="24" height="8.5" rx="4.25" fill="#fff"/><rect x="20" y="25.5" width="19" height="8" rx="4" fill="#fff"/><rect x="20" y="35.5" width="24" height="8.5" rx="4.25" fill="#fff"/><circle cx="48.5" cy="43" r="5" fill="#1cb0f6" stroke="#fff" stroke-width="2.5"/></svg><span>Egeshka</span>';
    var st = document.createElement('style');
    /* значок Egeshka внизу узкой левой полоски: не закрывает уроки; на телефоне — в левом нижнем углу */
    st.textContent = '#egeBack{position:fixed;left:11px;bottom:12px;z-index:50;display:flex;flex-direction:column;align-items:center;gap:2px;text-decoration:none;color:#777;font:800 9px/1 system-ui,sans-serif;transition:transform .15s}#egeBack:hover{transform:translateY(-2px);color:#3c3c3c}#egeBack svg{display:block}@media(max-width:760px){#egeBack{left:8px;bottom:8px}#egeBack span{display:none}#egeBack svg{width:30px;height:30px}}';
    document.head.appendChild(st); document.body.appendChild(a);
  });
})();
