import {accountLocalStorage as localStorage, accountStorageKeys} from './account-storage.js';
const clean = (v,max=6000) => typeof v==='string'?v.slice(0,max):'';
export function validatePacket(p, lessons, validateProject) {
  if(!p || typeof p!=='object' || p.version!==1)throw Error('Нужен учебный файл MicroLab версии 1');
  const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
  if(!id(p.id))throw Error('Некорректный номер документа');
  if(p.type==='classroom-backup'){
    for(const field of ['groups','assignments','submissions','reviews'])if(!Array.isArray(p[field])||p[field].length>300)throw Error('Некорректный журнал');
    const groups=p.groups.map(g=>{if(!id(g.id)||!Array.isArray(g.roster)||g.roster.length>100)throw Error('Некорректный класс');return {id:g.id,name:clean(g.name,60),roster:g.roster.map(x=>clean(x,60))};});
    const records=(field,type)=>p[field].map(x=>{if(x.type!==type)throw Error('Неверный раздел журнала');return validatePacket(x,lessons,validateProject)});
    return {version:1,type:p.type,id:p.id,groups,assignments:records('assignments','assignment'),submissions:records('submissions','submission'),reviews:records('reviews','review')};
  }
  if(p.type==='assignment'){
    if(!Array.isArray(p.lessonIds)||!p.lessonIds.length||p.lessonIds.some(x=>!lessons.some(l=>l.id===x)))throw Error('Неизвестные уроки в задании');
    return {version:1,type:p.type,id:p.id,title:clean(p.title,100),group:clean(p.group,60),instructions:clean(p.instructions),due:clean(p.due,10),lessonIds:[...new Set(p.lessonIds)]};
  }
  if(p.type==='submission'){
    if(!lessons.some(l=>l.id===p.lessonId))throw Error('Урок не найден');
    const project=validateProject(p.project);project.lessonId=p.lessonId;
    return {version:1,type:p.type,id:p.id,assignmentId:clean(p.assignmentId,100),lessonId:p.lessonId,student:clean(p.student,60),group:clean(p.group,60),homework:clean(p.homework),notes:clean(p.notes),project,submittedAt:clean(p.submittedAt,40)};
  }
  if(p.type==='review'){
    if(!id(p.submissionId)||!lessons.some(l=>l.id===p.lessonId)||!['reviewed','needs_revision'].includes(p.status))throw Error('Некорректный отзыв');
    return {version:1,type:p.type,id:p.id,submissionId:p.submissionId,lessonId:p.lessonId,status:p.status,comment:clean(p.comment),at:clean(p.at,40)};
  }
  throw Error('Этот тип учебного файла не поддерживается');
}
export const packetId = () => { const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''); };
export function downloadPacket(p,name='microlab-work.json') {
  const u=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
}
export function createExchange({api,lessons,store,onProgress}) {
  const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(k))??fallback}catch{return fallback}};
  const put=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  const list=prefix=>accountStorageKeys().filter(k=>k.startsWith(prefix)).map(k=>read(k,null)).filter(Boolean);
  let mode='student',message='';
  const title=id=>lessons.find(l=>l.id===id)?.title||id;
  function render(){
    const assignments=list('microlab.assignment.'),submissions=list('microlab.submission.'),groups=list('microlab.group.');
    $('#pageView').innerHTML=`<div class="page exchange-page"><div class="eyebrow">УЧИМСЯ БЕЗ РЕГИСТРАЦИИ</div><h1>Работа с учителем</h1><p>Начинайте сразу. Задания, работы и отзывы можно передавать файлами через привычный школьный канал.</p><div class="exchange-tabs"><button class="btn ${mode==='student'?'solid':'outline'}" data-mode="student">Я ученик</button><button class="btn ${mode==='teacher'?'solid':'outline'}" data-mode="teacher">Я учитель</button></div><p class="exchange-notice">${esc(message||'Данные хранятся в этом браузере. Файлы скачиваются на компьютер; автоматической отправки учителю нет.')}</p><div class="exchange-toolbar"><button id="importPacket" class="btn outline">Открыть учебный файл</button><input id="packetFile" type="file" accept=".json" hidden></div>
    ${mode==='student'?`<section class="theory-card"><h2>Имя для сдачи работы</h2><p>Можно использовать имя или псевдоним, согласованный с учителем. Почта и пароль не нужны.</p><form id="studentNameForm"><label for="studentName">Как подписывать работу</label><input id="studentName" maxlength="60" value="${esc(read('microlab.studentName',''))}" placeholder="Например, Дима М."><button class="btn solid">Сохранить имя</button></form></section>`:`<div class="exchange-grid"><section class="theory-card"><h2>Мои классы</h2><form id="groupForm"><label for="groupName">Название класса</label><input id="groupName" required maxlength="60" placeholder="7А"><label for="groupRoster">Ученики, по одному в строке</label><textarea id="groupRoster" maxlength="6000" rows="3" placeholder="Имена или псевдонимы"></textarea><button class="btn outline">Добавить класс</button></form>${groups.map(g=>`<details><summary>${esc(g.name)} · ${g.roster.length} учеников</summary><p>${g.roster.map(esc).join(', ')}</p></details>`).join('')}</section><section class="theory-card"><h2>Назначить урок</h2><form id="assignmentForm"><label for="assignmentGroup">Класс</label><select id="assignmentGroup" required>${groups.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select><label for="assignmentLesson">Занятие</label><select id="assignmentLesson">${lessons.map((l,i)=>`<option value="${l.id}">${i<36?'7 класс':'10–11 классы'} · ${i%36+1}. ${esc(l.title)}</option>`).join('')}</select><label for="assignmentDue">Срок</label><input id="assignmentDue" type="date"><label for="assignmentInstructions">Дополнительное задание</label><textarea id="assignmentInstructions" maxlength="6000" rows="3"></textarea><button class="btn solid" ${groups.length?'':'disabled'}>Скачать задание классу</button></form></section></div>`}
    <section class="theory-card"><h2>${mode==='teacher'?'Выданные задания':'Мои задания'}</h2>${assignments.length?assignments.map(a=>`<article class="assignment-row"><div><b>${esc(a.title)}</b><p>${esc(a.group)}${a.due?' · до '+esc(a.due):''}</p><p>${esc(a.instructions)}</p></div><div>${a.lessonIds.map(id=>`<a class="btn outline" href="#/lesson/${id}">Открыть урок</a>`).join('')}<button class="btn text" data-assignment="${a.id}">Скачать файл</button></div></article>`).join(''):'<p>Пока нет заданий. Можно самостоятельно <a href="#/course">начать курс</a> или открыть файл от учителя.</p>'}</section>
    ${mode==='teacher'?`<section class="theory-card"><h2>Работы на проверку <span>${submissions.length}</span></h2><p>Откройте файлы, которые ученики передали вам. Имя в файле указано самим учеником.</p>${submissions.map(s=>{const review=read('microlab.review.'+s.id,{});return `<article class="submission-row"><h3>${esc(s.student||'Без подписи')} · ${esc(title(s.lessonId))}</h3><small>${esc(s.group)} · ${review.status==='reviewed'?'Проверено':review.status==='needs_revision'?'На доработку':'Ожидает проверки'}</small><details><summary>Ответ, код и схема</summary><p>${esc(s.homework||'Ответ на ДЗ не заполнен')}</p><p>${esc(s.notes)}</p><pre>${esc(s.project.code)}</pre><button class="btn outline" data-open-work="${s.id}">Открыть схему в лаборатории</button></details><form data-review="${s.id}"><label>Комментарий<textarea name="comment" maxlength="6000" required rows="3">${esc(review.comment||'')}</textarea></label><label>Результат<select name="status"><option value="reviewed" ${review.status==='reviewed'?'selected':''}>Проверено</option><option value="needs_revision" ${review.status==='needs_revision'?'selected':''}>Нужна доработка</option></select></label><button class="btn solid">Скачать отзыв ученику</button></form></article>`}).join('')}</section>`:''}</div>`;
    document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;message='';render()});
    $('#importPacket').onclick=()=>$('#packetFile').click();$('#packetFile').onchange=importFile;
    if(mode==='teacher'){
      const backup=document.createElement('button');backup.className='btn outline';backup.textContent='Скачать журнал и работы';
      backup.onclick=()=>downloadPacket({version:1,type:'classroom-backup',id:packetId(),groups,assignments,submissions,reviews:list('microlab.review.')},'microlab-teacher-journal.json');
      $('.exchange-toolbar').append(backup);
    }
    if(mode==='student')$('#studentNameForm').onsubmit=e=>{e.preventDefault();try{put('microlab.studentName',$('#studentName').value.trim());api.toast('Имя сохранено на устройстве')}catch{api.toast('Не удалось сохранить имя')}};
    if(mode==='teacher'){
      $('#groupForm').onsubmit=e=>{e.preventDefault();try{const g={id:packetId(),name:$('#groupName').value.trim(),roster:$('#groupRoster').value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,100)};if(!g.name)return;put('microlab.group.'+g.id,g);render()}catch{api.toast('Не удалось сохранить класс')}};
      $('#assignmentForm').onsubmit=e=>{e.preventDefault();try{const group=groups.find(x=>x.id===$('#assignmentGroup').value),id=$('#assignmentLesson').value;if(!group)return;const p={version:1,type:'assignment',id:packetId(),title:title(id),group:group.name,lessonIds:[id],due:$('#assignmentDue').value,instructions:$('#assignmentInstructions').value};put('microlab.assignment.'+p.id,p);downloadPacket(p,'microlab-assignment.json');message='Задание скачано. Передайте файл ученикам.';render()}catch{api.toast('Не удалось сохранить задание')}};
    }
    document.querySelectorAll('[data-assignment]').forEach(b=>b.onclick=()=>downloadPacket(assignments.find(a=>a.id===b.dataset.assignment),'microlab-assignment.json'));
    document.querySelectorAll('[data-open-work]').forEach(b=>b.onclick=()=>{const s=submissions.find(s=>s.id===b.dataset.openWork);const p=structuredClone(s.project);delete p.lessonId;p.name='Проверка · '+(s.student||'ученик')+' · '+title(s.lessonId);api.load(p);location.hash='#/lab'});
    document.querySelectorAll('[data-review]').forEach(f=>f.onsubmit=e=>{e.preventDefault();try{const s=submissions.find(s=>s.id===f.dataset.review);const p={version:1,type:'review',id:packetId(),submissionId:s.id,lessonId:s.lessonId,status:f.elements.status.value,comment:f.elements.comment.value,at:new Date().toISOString()};put('microlab.review.'+s.id,p);downloadPacket(p,'microlab-feedback.json');message='Отзыв скачан. Передайте файл ученику.';render()}catch{api.toast('Не удалось сохранить отзыв')}});
  }
  async function importFile(e){const f=e.target.files[0];if(!f)return;try{
    if(f.size>5e6)throw Error('Файл больше 5 МБ');const p=validatePacket(JSON.parse(await f.text()),lessons,api.validate);
    if(p.type==='assignment'){put('microlab.assignment.'+p.id,p);mode='student';message='Задание открыто. Назначенный урок доступен без прохождения предыдущих.';}
    if(p.type==='submission'){put('microlab.submission.'+p.id,p);mode='teacher';message='Работа добавлена на проверку.';}
    if(p.type==='classroom-backup'){
      for(const [field,prefix] of [['groups','group'],['assignments','assignment'],['submissions','submission'],['reviews','review']])for(const item of p[field]){
        const key='microlab.'+prefix+'.'+(prefix==='review'?item.submissionId:item.id);
        if(localStorage.getItem(key)===null)put(key,item);
      }
      mode='teacher';message='Журнал объединён. Существующие записи сохранены.';
    }
    if(p.type==='review'){
      if(read('microlab.sent.'+p.lessonId,null)?.id!==p.submissionId)throw Error('Отзыв относится к другой версии работы. Откройте его на устройстве, с которого скачивали эту работу.');
      store.patch(p.lessonId,{review:p,homeworkStatus:p.status});onProgress();message='Отзыв добавлен к домашнему заданию.';
    }render();
  }catch(error){api.toast('Файл не открыт: '+error.message,'error')}finally{e.target.value=''}}
  function assigned(id){return list('microlab.assignment.').some(a=>a.lessonIds?.includes(id));}
  function submit(lesson){
    if(!api.persist(true))return;
    const progress=store.read()[lesson.id]||{};
    let project;try{project=JSON.parse(localStorage.getItem('microlab.lesson.'+lesson.id)||'null')}catch{}
    if(!project){api.toast('Сначала откройте лабораторию и сохраните проект');return;}
    const assignment=list('microlab.assignment.').find(a=>a.lessonIds.includes(lesson.id));
    const p={version:1,type:'submission',id:packetId(),assignmentId:assignment?.id||'',lessonId:lesson.id,student:read('microlab.studentName',''),group:assignment?.group||'',homework:progress.homework||'',notes:progress.practiceNotes||'',project,submittedAt:new Date().toISOString()};
    try{put('microlab.sent.'+lesson.id,p);store.patch(lesson.id,{homeworkStatus:'exported'});onProgress();downloadPacket(p,'microlab-student-work.json');api.toast('Работа скачана. Передайте файл учителю.')}catch{api.toast('Не удалось подготовить работу')}
  }
  return {render,assigned,submit};
}
