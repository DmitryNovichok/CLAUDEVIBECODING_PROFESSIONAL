/* Связка лаборатории Arduino (MicroLab) с сайтом Egeshka — этот файл добавлен при встраивании, остальное приложение не менялось.
   1) Лаборатория — раздел для вошедших учеников с доступом к лабораториям: без входа — на сайт, без доступа — к окну с паролем.
   2) Кнопка «← Egeshka» возвращает на главную сайта.
   Открыли index.html с диска (без сервера) — работает как есть, без проверки. */
(function () {
  if (!/^https?:$/.test(location.protocol)) return;
  var root = document.documentElement, token = '';
  try { token = (JSON.parse(localStorage.getItem('egeTrainer.student.v1') || 'null') || {}).token || ''; } catch (e) { /* нет доступа к хранилищу */ }
  root.style.visibility = 'hidden';                       // пока идёт проверка, страница не мелькает
  var show = function () { root.style.visibility = ''; };
  var headers = token ? { 'X-Token': token } : {};
  fetch('/api/me', { headers: headers, credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) { location.replace('/'); return null; }
    return r.ok ? r.json() : {};
  }).then(function (me) {
    if (me === null) return;
    if (me && me.name !== undefined && !me.lab) { location.replace('/#lab'); return; }
    show();
  }).catch(show);                                         // сервер недоступен — не запираем уже открытую лабораторию
  setTimeout(show, 4000);
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
