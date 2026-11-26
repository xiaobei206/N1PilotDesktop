'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, '.editor-build');
const workers = {
  editor: 'monaco-editor/editor/editor.worker',
  json: 'monaco-editor/language/json/json.worker',
  css: 'monaco-editor/language/css/css.worker',
  html: 'monaco-editor/language/html/html.worker',
  typescript: 'monaco-editor/language/typescript/ts.worker'
};

function locateMonacoBaseCss() {
  // Prefer CSS imported by the current ESM entry. If a package build omits it,
  // fall back to the shipped stylesheet via its physical path (not a package subpath).
  const runtimeEntry = require.resolve('monaco-editor', { paths: [root] });
  const packageRoot = path.resolve(path.dirname(runtimeEntry), '..', '..');
  const candidates = [
    path.join(packageRoot, 'min', 'vs', 'editor', 'editor.main.css'),
    path.join(packageRoot, 'esm', 'vs', 'editor', 'editor.main.css'),
    path.join(packageRoot, 'min', 'vs', 'editor', 'editor.css'),
    path.join(packageRoot, 'esm', 'vs', 'editor', 'editor.css')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function main() {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
  const inlineSources = {};
  for (const [name, packageEntry] of Object.entries(workers)) {
    const entry = require.resolve(packageEntry, { paths: [root] });
    const outfile = path.join(tempRoot, `${name}.worker.js`);
    await esbuild.build({
      entryPoints: [entry], outfile, bundle: true, minify: true,
      platform: 'browser', format: 'iife', target: ['chrome120'],
      legalComments: 'none', sourcemap: false, logLevel: 'warning'
    });
    inlineSources[name] = fs.readFileSync(outfile, 'utf8');
  }
  const generatedWorkers = `// Generated locally by scripts/build-editor.js; do not edit.\nexport const monacoWorkerSources = Object.freeze(${JSON.stringify(inlineSources)});\n`;
  fs.writeFileSync(path.join(tempRoot, 'monaco-workers-inline.js'), generatedWorkers, 'utf8');

  await esbuild.build({
    entryPoints: [path.join(root, 'editor-monaco-entry.js')],
    outfile: path.join(root, 'editor-monaco.bundle.js'),
    bundle: true,
    minify: true,
    platform: 'browser',
    format: 'iife',
    target: ['chrome120'],
    sourcemap: false,
    legalComments: 'none',
    loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file', '.svg': 'dataurl' },
    assetNames: 'monaco-assets/[name]-[hash]',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info'
  });
  const cssOutput = path.join(root, 'editor-monaco.bundle.css');
  if (!fs.existsSync(cssOutput) || !fs.statSync(cssOutput).size) {
    const fallbackCss = locateMonacoBaseCss();
    if (!fallbackCss) throw new Error('Monaco did not emit a CSS bundle and no compatible packaged stylesheet was found.');
    await esbuild.build({
      entryPoints: [fallbackCss],
      outfile: cssOutput,
      bundle: true,
      minify: true,
      platform: 'browser',
      target: ['chrome120'],
      sourcemap: false,
      legalComments: 'none',
      assetNames: 'monaco-assets/[name]-[hash]',
      loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file', '.svg': 'dataurl' },
      logLevel: 'info'
    });
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
  const js = path.join(root, 'editor-monaco.bundle.js');
  const css = path.join(root, 'editor-monaco.bundle.css');
  if (!fs.existsSync(js) || !fs.statSync(js).size || !fs.existsSync(css) || !fs.statSync(css).size) {
    throw new Error('Monaco bundle output is missing or empty.');
  }
  console.log(`Monaco Editor bundle ready: ${path.basename(js)} (${fs.statSync(js).size} bytes), ${path.basename(css)} (${fs.statSync(css).size} bytes)`);
}

main().catch((error) => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.error('Failed to build the local Monaco editor bundle.');
  console.error(error && (error.stack || error.message) || error);
  process.exitCode = 1;
});
