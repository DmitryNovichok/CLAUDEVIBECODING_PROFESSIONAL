// Disposable real application. No production host, account or secret is accepted.
const {spawn} = require('node:child_process');
const path = require('node:path');

async function startFixture({script = 'app_fixture.py', startupMs = 30000, shutdown = 'signal', taskCount} = {}) {
  if (!['app_fixture.py', 'readiness_fixture.py'].includes(script)) throw Error('Unknown synthetic fixture');
  if (taskCount !== undefined && (!Number.isInteger(taskCount) || taskCount < 5 || taskCount > 20000)) throw Error('Synthetic task count must be 5..20000');
  const child = spawn(process.env.PYTHON || 'python3', [path.join(__dirname, script)], {stdio:['pipe','pipe','pipe'], env:{...process.env, ...(taskCount === undefined ? {} : {EGE_SYNTHETIC_TASKS:String(taskCount)})}});
  let stderr = '', stdout = '', stopped = false;
  child.stderr.on('data', chunk => {stderr = (stderr + chunk).slice(-20000);});
  // A failed startup must not leave a Python server behind.
  const stop = async () => {
    if (stopped || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
    stopped = true;
    let timer;
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (shutdown === 'stdin') child.stdin.end('\n'); else child.kill('SIGTERM');
    const graceful = await Promise.race([exited.then(() => true), new Promise(resolve => {timer = setTimeout(() => resolve(false), 5000);})]);
    clearTimeout(timer);
    if (!graceful && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([exited, new Promise(resolve => {timer = setTimeout(resolve, 1000);})]);
      clearTimeout(timer);
      throw Error('Synthetic fixture required forced cleanup: ' + script);
    }
  };
  try {
    const config = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Fixture startup timed out: ' + stderr)), startupMs);
      const fail = error => {clearTimeout(timer); reject(error);};
      child.once('error', fail);
      child.once('exit', code => fail(Error('Fixture exited ' + code + ': ' + stderr)));
      child.stdout.on('data', chunk => {
        stdout += chunk;
        const end = stdout.indexOf('\n');
        if (end < 0) return;
        try {
          const data = JSON.parse(stdout.slice(0, end));
          if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(data.origin)) throw Error('Fixture must bind only to loopback');
          clearTimeout(timer); resolve(data);
        } catch (error) {fail(error);}
      });
    });
    return {...config, stop};
  } catch (error) {await stop(); throw error;}
}

async function seedBrowser(context, fixture, role = 'pupil', account) {
  // Runtime download must use the pinned local Pyodide, never a public CDN.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === fixture.origin ? route.continue() : route.abort();
  });
  if (role === 'teacher') {
    const teacher = account || fixture.teachers.find(t => t.email_ok && t.moderation === 'approved');
    await context.addCookies([{name:'egeadm',value:teacher.cookie,url:fixture.origin,httpOnly:true,sameSite:'Strict'}]);
    await context.addInitScript(id => {
      // Playwright also runs init scripts inside opaque Python sandbox frames.
      if (window !== window.top) return;
      localStorage.setItem('egeshka.atour.v1.' + id, '1');
    }, teacher.id);
  } else {
    const pupil = account || fixture.student;
    await context.addCookies([{name:'egest',value:pupil.token,url:fixture.origin,httpOnly:true,sameSite:'Lax'}]);
    await context.addInitScript(sid => {
      if (window !== window.top) return;
      localStorage.setItem('egeshka.tour.v1.' + sid, '1');
      localStorage.setItem('egeshka.stories.labs-lessons-2026-11.' + sid, '1');
      const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      localStorage.setItem('egeTrainer.lbShown.' + sid, day);
    }, pupil.sid);
  }
}
module.exports = {startFixture, seedBrowser};
