import {build} from 'esbuild';
import {mkdir, readdir, cp, readFile, writeFile} from 'node:fs/promises';

// The embedded site ships assets next to source/. Also assemble a complete offline dist/.
await mkdir('dist', {recursive: true});
for (const entry of await readdir('..', {withFileTypes: true})) {
  if (['source', 'app.js', 'egeshka.js', 'README-EGESHKA.md'].includes(entry.name)) continue;
  await cp('../' + entry.name, 'dist/' + entry.name, {recursive: true});
}
const index = (await readFile('../index.html', 'utf8'))
  .replace('<script src="egeshka.js"></script>', '')
  .replace(/<section id="egeGate"[\s\S]*?<\/section>\s*/, '')
  .replace('<div id="appShell" hidden>', '<div id="appShell">')
  .replace('<script type="application/json" id="egeArduinoApp" data-src="app.js"></script>', '<script type="module" src="app.js"></script>');
await writeFile('dist/index.html', index);
await build({entryPoints:['src/app.js'],bundle:true,format:'esm',minify:true,outfile:'dist/app.js'});
console.log('Built MicroLab app and offline assets in dist/');
