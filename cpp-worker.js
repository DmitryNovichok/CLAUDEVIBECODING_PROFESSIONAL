/* C++17 playground. Clang, the linker and the pupil program run on the device. */
'use strict';
if (self.location.protocol !== 'blob:' || self.location.origin !== 'null')
  throw Error('Откройте редактор C++ в Egeshka.');

const root = self.EGE_CPP_ROOT;
const maxMemory = 128 * 1024 * 1024;
const maxOutput = 100000;
let toolchain;

// The largest compressed asset is distributed in two independently cacheable
// pieces. Present the original gzip byte stream to the unmodified toolchain.
const fetchAsset = self.fetch.bind(self);
const clangURL = new URL('bin/clang.wasm.gz', root).href;
self.fetch = async (resource, options) => {
  const url = resource instanceof Request ? resource.url : String(resource);
  if (url !== clangURL) return fetchAsset(resource, options);
  const parts = await Promise.all(['.part1', '.part2'].map(async suffix => {
    const response = await fetchAsset(clangURL + suffix, options);
    if (!response.ok) throw Error('Не удалось загрузить компилятор C++. Повторите запуск.');
    return response.blob();
  }));
  const body = new Blob(parts);
  return new Response(body, { headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(body.size) } });
};

async function compiler() {
  if (toolchain) return toolchain;
  self.postMessage({ type: 'status', text: 'Загрузка C++ · при первом запуске около 29 МБ' });
  importScripts(new URL('clang-wasm-toolchain.global.js', root).href);
  toolchain = await self.clangWasmToolchain.createToolchain({ baseUrl: root });
  return toolchain;
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'run') return;
  const started = performance.now();
  let ok = false, buffer = '', written = 0;
  function flush() {
    if (buffer) self.postMessage({ type: 'out', text: buffer });
    buffer = '';
  }
  function write(chunk) {
    const part = String(chunk), room = maxOutput - written;
    buffer += part.slice(0, room);
    written += Math.min(room, part.length);
    if (buffer.length >= 4096) flush();
    if (part.length > room) throw Error('Вывод превысил 100 000 символов. Программа остановлена.');
  }
  try {
    const tc = await compiler();
    self.postMessage({ type: 'status', text: 'Компиляция main.cpp…' });
    const built = await tc.captureCompilerOutput(() => tc.runtime.compileArtifact(data.code, {
      language: 'CPP', fileName: 'main.cpp', maxWasmMemoryBytes: maxMemory,
      compileArgs: [...self.clangWasmToolchain.CLANG_DRIVER_DEFAULT_ARGS, '-std=c++17']
    }));
    if (built.error) {
      const lines = self.clangWasmToolchain.compilerDiagnostics(built.raw);
      throw Error(lines.join('\n') || built.error.message || 'Не удалось собрать программу.');
    }
    let stdin = data.stdin || null;
    self.postMessage({ type: 'running' });
    const result = await tc.execute(built.result, {
      programName: 'main', maxWasmMemoryBytes: maxMemory,
      files: data.files.map(f => ({ path: f.name, contents: f.data })),
      stdin: () => { const next = stdin; stdin = null; return next; },
      stdout: write, stderr: write
    });
    if (result.exitCode !== 0) throw Error('Программа завершилась с кодом ' + result.exitCode + '.');
    ok = true;
  } catch (err) {
    flush();
    self.postMessage({ type: 'err', text: String(err.message || err).slice(0, maxOutput) + '\n' });
  } finally {
    flush();
    self.postMessage({ type: 'done', ok, ms: Math.round(performance.now() - started) });
  }
};
