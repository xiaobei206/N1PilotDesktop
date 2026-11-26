const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const editorPreload = read('editor-preload.js');
const renderer = read('renderer.js');
const editor = read('editor.js');
const html = read('editor.html');
const css = read('editor.css');
const entry = read('editor-monaco-entry.js');
const buildScript = read('scripts/build-editor.js');
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '1.0.3');
assert.equal(pkg.devDependencies['monaco-editor'], '0.57.0', 'the editor engine is Monaco, locally bundled and pinned at build time');
for (const dep of ['diff', 'iconv-lite', 'yaml']) assert.ok(pkg.dependencies[dep], `editor dependency ${dep} is declared`);
assert.ok(pkg.devDependencies.esbuild, 'the local Monaco bundle build dependency is declared');
assert.equal(pkg.build.win.target[0], 'portable', 'preserve the existing portable EXE target');
assert.ok(preload.includes("openRemoteEditor: (sessionId, remotePath) => ipcRenderer.invoke('editor:open-remote-file', sessionId, remotePath)"));
assert.ok(renderer.includes("'编辑文件…'"), 'SFTP context menu exposes Edit');
assert.ok(renderer.includes('window.pilot.openRemoteEditor(session.connectionId, entry.path)'), 'editor opens against selected SSH connection');
assert.ok(entry.includes("monaco-editor/editor"), 'Monaco Editor uses the supported public ESM entry point');
assert.ok(entry.includes("monaco-editor/features/register.all"), 'Monaco editor features are enabled');
assert.ok(entry.includes("monaco-editor/languages/definitions/register.all"), 'Monaco basic language definitions are enabled');
assert.ok(entry.includes("monaco-editor/languages/features/register.all"), 'Monaco JSON/CSS/HTML/TypeScript language features are enabled');
assert.ok(entry.includes('monaco.languages.json.jsonDefaults.setDiagnosticsOptions'), 'Monaco JSON diagnostics use the current public API namespace');
assert.ok(editor.includes("fullPath.includes('/etc/config/')"), 'extensionless OpenWrt UCI configuration files get INI-style tokenization');
assert.ok(entry.includes('window.MonacoEnvironment = { getWorker: createMonacoWorker }'), 'Monaco language workers are locally embedded rather than loaded from a CDN');
assert.ok(entry.includes("const aliases = { javascript: 'typescript', scss: 'css', less: 'css', handlebars: 'html', razor: 'html' }"), 'JS/TS, CSS-family, and HTML-family worker labels map to the correct embedded worker');
assert.ok(buildScript.includes('monacoWorkerSources') && buildScript.includes("format: 'iife'"), 'worker bundles are generated as local classic worker payloads');
assert.ok(buildScript.includes("monaco-editor/editor/editor.worker") && buildScript.includes("monaco-editor/language/json/json.worker"), 'worker entries use current Monaco 0.57 public export paths');
assert.ok(buildScript.includes('locateMonacoBaseCss') && buildScript.includes('editor.main.css'), 'matching Monaco stylesheet is copied by filesystem path to avoid package export restrictions');
assert.ok(html.includes('editor-monaco.bundle.js') && html.includes('editor-monaco.bundle.css'), 'editor HTML loads local Monaco build outputs');
assert.ok(html.includes("worker-src 'self' blob:"), 'CSP explicitly permits the bundled blob workers');
assert.ok(!/codemirror|CodeMirror/.test(`${html}\n${editor}\n${css}\n${JSON.stringify(pkg.dependencies)}`), 'the editor engine was not left on CodeMirror');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
assert.equal(new Set(ids).size, ids.length, 'editor HTML has no duplicate IDs');
for (const id of new Set([...editor.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))) assert.ok(ids.includes(id), `editor.js references existing HTML id ${id}`);
for (const feature of [
  'createMonacoAdapter', 'autoClosingBrackets: \'never\'', 'autoClosingQuotes: \'never\'', 'autoIndent: \'none\'',
  "editor.addCommand(m.KeyCode.Enter, () => facade.replaceSelection('\\n'))", "editor.addCommand(m.KeyCode.Tab, () => facade.replaceSelection('\\t'))",
  'function scanTextWarnings', 'function detectMarkdownFence', 'function showDiffDialog', 'function replaceAllMatches',
  'let editBatchDepth = 0;', "editor.executeEdits('n1pilot-batched-edit', edits);",
  'function persistCurrentDraft', 'checkShellRemote(cm.getValue())', 'formatLabel(selectedFormat().encoding',
  'editor:flush-draft-and-quit', 'editor:language', 'saveFileOnce', 'save.duplicate-request-joined', 'close.save-and-close-stopped'
]) assert.ok(editor.includes(feature), `Monaco editor implementation includes ${feature}`);
assert.ok(!/autoCloseBrackets\s*:/.test(editor), 'no silent closing-bracket insertion option is enabled');
assert.ok(!/smartIndent\s*:\s*true/.test(editor), 'smart indentation is not enabled');
assert.ok(editorPreload.includes("'editor:flush-draft-and-quit'"), 'editor preload supports controlled quit-draft flush');
assert.ok(editorPreload.includes("ipcRenderer.send('editor:flush-draft-complete'"), 'editor preload acknowledges draft flush');
assert.ok(main.includes("'Discard Drafts and Quit'") && main.includes("'不保存草稿直接退出'"), 'application quit offers an explicit discard-drafts path');
assert.ok(main.includes("'app-quit.unsaved-choice'") && main.includes("'app-quit.discard-path-reenter'"), 'application quit decisions are logged');
assert.ok(main.includes("stage('backup-rename.begin'") && main.includes("stage('replacement-rename.success'") && main.includes("'file.save.handler-error'"), 'remote save logs operation stages and handler-level failures');
for (const required of [
  "ipcMain.handle('editor:open-remote-file'", "ipcMain.handle('editor:initialize'", "ipcMain.handle('editor:save'",
  "ipcMain.handle('editor:validate'", "ipcMain.handle('editor:diff-lines'", "ipcMain.handle('editor:check-shell-remote'",
  "ipcMain.handle('editor:save-draft'", "ipcMain.on('editor:flush-draft-complete'", "function editorContextFor(event)",
  'safeStorage.encryptString(JSON.stringify(payload))', "sftp.createWriteStream(remotePath, { flags: 'wx', mode: 0o600 })",
  'formatTextWithLineEndings(originalText, text, originalEols', "'file.save.conflict'", 'readRemoteEditorSnapshot(sftp, remotePath)',
  'appQuitAfterDraftFlush', 'function saveEditorWindowState(context)', 'window.geometry'
]) assert.ok(main.includes(required), `main process includes ${required}`);
assert.ok(main.includes('const command = `sh -n') && main.includes('executedScript: false'), 'remote shell checking only parses, not executes');
assert.ok(main.includes('if (movedOriginal.hash !== expectedHash)'), 'saving rechecks the original version before replacement');
assert.ok(main.includes("const editorWin = new BrowserWindow(") && main.includes('resizable: true') && main.includes('independentWindow: true'), 'each remote file gets an independent resizable window');
assert.ok(main.includes('const editorWebContentsId = editorWebContents.id;'), 'editor WebContents ID is captured while the BrowserWindow is alive');
assert.ok(main.includes('editorWindows.delete(editorWebContentsId);'), 'closed handler removes editor by captured ID rather than dereferencing destroyed BrowserWindow');
const closedHandlerMatch = main.match(/editorWin\.on\('closed', \(\) => \{([\s\S]*?)\n  \}\);/);
assert.ok(closedHandlerMatch && !closedHandlerMatch[1].includes('editorWin.webContents'), 'closed handler never accesses webContents after destruction');

assert.ok(css.includes('.monaco-editor .cm-error-token') && css.includes('#ff5268'), 'diagnostic errors have visible red styling');
assert.ok(/const re=\/\[ \\t\\u00a0\\u200b/.test(editor), 'the invisible-character view includes ordinary spaces and tabs as well as suspicious Unicode');
assert.equal((editor.match(/\$\('diff-dialog'\)\.showModal\(\)/g) || []).length, 1, 'diff dialog is opened exactly once');
assert.ok(editor.includes('monaco.editor.setModelMarkers'), 'diagnostics feed Monaco markers');
assert.ok(!/node_modules\/codemirror|CodeMirror\(/i.test(html + editor), 'no legacy editor runtime remains');
console.log('N1PilotDesktop Monaco remote-editor static smoke tests passed.');
