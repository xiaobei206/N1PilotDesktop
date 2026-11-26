const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const start = main.indexOf('function classifyCommand(command) {');
const end = main.indexOf("ipcMain.handle('ssh:inspect-command'", start);
assert.ok(start >= 0 && end > start, 'SSH risk classifier exists');
const classify = Function(main.slice(start, end) + '\nreturn classifyCommand;')();
assert.equal(classify('uname -a').level, 'safe');
assert.equal(classify('reboot').level, 'confirm');
assert.equal(classify('uci set network.lan.ipaddr=192.168.60.1').requiresConfirmation, true);
assert.equal(classify('cat /root/.ssh/id_ed25519').level, 'blocked');
assert.equal(classify('cat /etc/shadow').level, 'blocked');
assert.equal(classify('rm /etc/config/network').level, 'confirm');
assert.equal(classify('echo broken > /usr/bin/mount').level, 'confirm');
assert.equal(classify('echo hi'.repeat(2000)).level, 'blocked');
const localPathNormalizerStart = main.indexOf('function normalizeLocalDirectoryInput(rawPath) {');
const localPathNormalizerEnd = main.indexOf("ipcMain.handle('sftp:local-home'", localPathNormalizerStart);
assert.ok(localPathNormalizerStart >= 0 && localPathNormalizerEnd > localPathNormalizerStart, 'local directory path normalizer is defined before the IPC handler');
const normalizeLocalDirectoryInput = Function('os', main.slice(localPathNormalizerStart, localPathNormalizerEnd) + '\nreturn normalizeLocalDirectoryInput;')({ homedir: () => 'C:\\Users\\test' });
assert.equal(normalizeLocalDirectoryInput('Z:'), 'Z:\\', 'bare drive letter means root');
assert.equal(normalizeLocalDirectoryInput('z:'), 'z:\\', 'lowercase bare drive letter means root');
assert.equal(normalizeLocalDirectoryInput('Z:\\'), 'Z:\\', 'explicit drive root stays a drive root');
assert.equal(normalizeLocalDirectoryInput('Z:\\Temp'), 'Z:\\Temp', 'ordinary absolute paths are unchanged');

assert.equal(pkg.version, '1.0.3');
assert.equal(pkg.build.win.icon, 'assets/n1pilot.ico');
assert.ok(main.includes('SFTP_CHANNEL_OPEN_TIMEOUT_MS = 15000') && main.includes('SFTP_METADATA_TIMEOUT_MS = 20000'), 'SFTP channel and metadata reads have bounded waits');
assert.ok(main.includes('directory.list.readdir-complete') && main.includes('directory.list.success'), 'remote directory listing records request and elapsed-time diagnostics');
assert.ok(main.includes('EDITOR_STREAM_TIMEOUT_MS = 30000') && main.includes('stream.write.success') && main.includes('stream.read.success'), 'editor remote stream reads and writes have timeout diagnostics');
assert.ok(renderer.includes('function refreshSelectionVisuals(side)') && renderer.includes('document.createDocumentFragment()'), 'SFTP row selection updates in place and directory rows are batch-rendered');
assert.ok(renderer.includes('directory.remote.open.complete') && renderer.includes('renderElapsedMs'), 'remote directory navigation records network and render timing separately');
assert.ok(css.includes('.terminal-panel .terminal{font:11px/1.5 Consolas,Cascadia Code,monospace;background:#070b13;flex:1;min-height:110px;max-height:350px;overflow:auto;'), 'base terminal output styles are scoped to the classic output panel');
assert.ok(!/(?:^|\})\.terminal\{[^}]*max-height:350px/.test(css), 'generic .terminal selector must not constrain xterm interactive terminal');
assert.ok(css.includes('.right-pane #terminal-panel .terminal{max-height:420px}'), '420px cap is scoped to classic SSH output log');
assert.ok(!css.includes('.right-pane .terminal{max-height:420px}'), 'legacy terminal cap must not constrain xterm interactive terminal');

assert.ok(renderer.includes('function buildLayoutSnapshot(reason, extras = {})'), 'DEBUG can capture a DOM/window layout snapshot');
assert.ok(renderer.includes("recordLayoutSnapshot('window.resize'"), 'window viewport changes are recorded');
assert.ok(renderer.includes('terminal.resize-observer-fired') && renderer.includes('terminal.fit'), 'interactive terminal ResizeObserver and fit dimensions are recorded');
assert.ok(renderer.includes('terminal.xterm-grid-resize'), 'xterm row/column changes are recorded');
assert.ok(main.includes("logWindowGeometry('window.resize')") && main.includes("['maximize', 'unmaximize', 'restore'"), 'Electron window resize/maximize state is logged');
assert.ok(main.includes("'ssh.terminal.pty-resize-request'") && main.includes("'ssh.terminal.pty-resize-applied'"), 'remote PTY resize requests and results are logged');
assert.equal(pkg.build.win.signAndEditExecutable, true);
assert.deepEqual(pkg.build.win.target, ['portable'], 'preserves the v0.4.1 Windows portable build target');
assert.equal(pkg.scripts['dist:win'], 'npm run build:editor && electron-builder --win portable --x64', 'builds the local Monaco assets before packaging the portable EXE');
for (const asset of ['n1pilot.svg', 'n1pilot.png', 'n1pilot.ico']) {
  assert.ok(fs.existsSync(path.join(root, 'assets', asset)), `brand icon asset ${asset} exists`);
}
assert.ok(html.includes('assets/n1pilot.svg'), 'top-left brand mark uses the shared SVG icon');
assert.ok(html.includes('node_modules/@xterm/xterm/lib/xterm.js') && html.includes('node_modules/@xterm/addon-fit/lib/addon-fit.js'), 'xterm.js browser assets are loaded from installed dependencies');
assert.ok(pkg.dependencies['@xterm/xterm'] && pkg.dependencies['@xterm/addon-fit'], 'interactive terminal dependencies are declared');
assert.ok(html.includes('新建 SSH 会话走代理（默认关闭）') && !html.includes('新建 SSH 会话走上方代理'), 'SSH proxy checkbox removes the incorrect “上方” wording');
assert.ok(html.includes('id="interactive-panel"') && html.includes('id="interactive-terminal-host"'), 'interactive terminal workspace exists');
assert.ok(renderer.includes("classList.toggle('interactive-mode-active', interactive)"), 'interactive mode activates a dedicated full-height layout class');
assert.ok(css.includes('.layout{grid-template-rows:minmax(0,1fr);}'), 'main grid row is constrained to the available app height instead of sizing to content');
assert.ok(html.includes('id="ssh-workspace"') && html.indexOf('id="command-panel"') < html.indexOf('id="terminal-panel"') && html.indexOf('id="terminal-panel"') < html.indexOf('id="interactive-panel"'), 'command, output, and interactive terminal share one bounded workspace wrapper');
assert.ok(css.includes('.ssh-workspace{display:flex;flex:1 1 0;flex-direction:column;min-width:0;min-height:0;overflow:hidden;}'), 'SSH workspace explicitly owns the remaining vertical space');
assert.ok(!css.includes('height:clamp(300px,calc(100vh - 445px),720px)'), 'interactive panel has no viewport-derived fixed height or 720px cap');
assert.ok(css.includes('.right-pane.interactive-mode-active>.ssh-workspace{flex:1 1 0;min-height:0;overflow:hidden;}'), 'interactive workspace wrapper fills the available right pane');
assert.ok(css.includes('.right-pane.interactive-mode-active .interactive-panel{flex:1 1 0;min-height:0;height:auto;max-height:none;}'), 'interactive panel grows inside the explicit workspace wrapper');
assert.ok(css.includes('.right-pane.interactive-mode-active .interactive-terminal-host{flex:1 1 0;min-height:0;height:0;}'), 'terminal host has a zero flex basis so it uses all remaining panel height');
assert.ok(css.includes('.layout{grid-template-rows:minmax(0,1fr);}'), 'main grid row is constrained to the available app height');
assert.ok(renderer.includes('new ResizeObserver(') && renderer.includes("ui.resizeObserver.observe($('ssh-workspace'))") && renderer.includes("ui.resizeObserver.observe($('interactive-panel'))") && renderer.includes("ui.resizeObserver.observe($('interactive-terminal-host'))"), 'xterm refits when any workspace sizing level changes');
assert.ok(renderer.includes('ui.resizeObserver?.disconnect()'), 'per-tab terminal resize observer is cleaned up on disposal');
assert.ok(main.includes("icon: path.join(__dirname, 'assets', 'n1pilot.ico')"), 'native window uses the custom app icon');
for (const required of [
  "ipcMain.handle('ssh:connect'", "ipcMain.handle('ssh:exec'", "ipcMain.handle('ssh:terminal:start'", "ipcMain.on('ssh:terminal:write'", "ipcMain.on('ssh:terminal:resize'", "ipcMain.handle('sftp:list-local'",
  "ipcMain.handle('sftp:list-remote'", "ipcMain.handle('sftp:upload-files'", "ipcMain.handle('sftp:download-files'",
  "ipcMain.handle('chat:apply-proxy'", "ipcMain.handle('app:read-clipboard'", "const sessions = new Map()",
  'function createProxyTunnel(', "ipcMain.handle('ssh:profiles:save'", 'safeStorage.encryptString',
  "ipcMain.handle('sftp:chmod-remote'", "ipcMain.handle('sftp:chown-remote'", "ipcMain.handle('sftp:show-local-properties'", "ipcMain.handle('sftp:cleanup-native-drag'",
  "ipcMain.handle('window:set-sftp-expanded'"
]) assert.ok(main.includes(required), `main has ${required}`);
for (const required of [
  "'chat:get-proxy'", "'chat:apply-proxy'", "'sftp:list-local'", "'sftp:list-remote'",
  "'sftp:upload-files'", "'sftp:download-files'", 'getChatProxy:', 'applyChatProxy:', 'uploadFiles:', 'downloadFiles:',
  'exec: (sessionId', 'startTerminal:', 'writeTerminal:', 'resizeTerminal:', 'copyText:', 'saveSshProfile:', 'cleanupNativeDrag:', 'chownRemote:'
]) assert.ok(preload.includes(required), `preload has ${required}`);
for (const required of [
  '命令工作区', '粘贴并运行', '运行编辑框代码', '复制完整记录', '复制纯输出',
  '回传本次结果并发送到 GPT', '文件管理器（SFTP）', 'session-tabs', 'gpt-proxy-enabled', 'ssh-use-proxy',
  'local-files', 'remote-files', 'sftp-toggle-btn', 'queue-total-progress', 'transfer-queue-list',
  'move-history-list', 'language-zh-btn', 'language-en-btn', 'window-close-btn', 'remote-properties-dialog', 'remote-tab-general', 'remote-tab-permissions', 'remote-property-mode', 'perm-owner-read'
]) assert.ok(html.includes(required), `HTML includes ${required}`);
for (const required of [
  'normalizeCode', 'handlePasteAndRun', 'runCommand', 'fullRecord', 'outputOnly', 'sendLatestResult', 'createInteractiveTerminal', 'switchActiveSessionMode', 'scheduleSelectionCopy', 'flushPendingTerminalInput',
  'sshSessions', 'initializeProxySettings', 'uploadLocalPaths', 'downloadRemotePaths', 'wireSftpDrop',
  'retryAllFailed', 'remoteParentPath', 'remoteDragKey', 'prepareRemoteForDrag', 'setSftpExpanded',
  'Copy Full Path', 'Move to…', '重试全部失败项'
]) assert.ok(renderer.includes(required), `renderer includes ${required}`);
assert.ok(!renderer.includes('runAutoAgent'), 'legacy automatic agent loop removed');
assert.ok(!renderer.includes('getChatSnapshot'), 'legacy webpage DOM scraper removed');
assert.ok(!renderer.includes('prompt('), 'renderer does not use unsupported prompt()');
assert.ok(!renderer.includes("$('upload-btn')"), 'old single-file upload UI removed');
assert.ok(main.includes('function normalizeLocalDirectoryInput(rawPath)'), 'bare drive-letter local path normalizer exists');
assert.ok(main.includes("client.shell({ term: 'xterm-256color', cols, rows, width: 0, height: 0 }") && main.includes('setWindow(rows, cols, 0, 0)'), 'interactive terminal opens and resizes a real remote PTY');
assert.ok(renderer.includes("container.addEventListener('contextmenu'") && renderer.includes('terminal.paste(text)'), 'interactive terminal right-click pastes clipboard text');
assert.ok(renderer.includes('terminal.getSelection()') && renderer.includes('window.pilot.copyText(selected)'), 'interactive terminal copies mouse selections to the system clipboard');
assert.ok(renderer.includes('ui.endedConnectionId === s.connectionId') && renderer.includes("if (info.state === 'closed') s.interactiveTerminal.endedConnectionId = info.sessionId"), 'a closed shell is not silently restarted by unrelated UI refreshes');
assert.ok(renderer.includes('terminal.onData((data) =>') && renderer.includes('window.pilot.writeTerminal(connectionId, data)'), 'interactive keyboard input is streamed to the active PTY');
assert.ok(main.includes('if (session.interactiveShell) session.interactiveShell.close()'), 'interactive PTY streams are closed during SSH and app shutdown');
assert.ok(main.includes('directory.local.resolve-input'), 'local path normalization is logged');
assert.ok(!renderer.includes('remoteHoverWarmup'), 'no remote-file cache warmup on hover');
assert.ok(!renderer.includes('remoteSelectionWarmupTimer'), 'no remote-file cache warmup on selection');
assert.ok(renderer.includes('external-drag.prepare-during-gesture'), 'remote drag staging begins during a deliberate drag gesture');
assert.ok(renderer.includes('all selected items are dragged'), 'dragging any selected row handle exports the full selection');
assert.ok(!/\bpath\.posix\./.test(renderer), 'renderer does not rely on Node path module without Node integration');
assert.ok(renderer.includes("const targetDir=direction==='upload'?(remoteSftpPath||'/tmp'):(localSftpPath||'')"), 'transfers target the currently browsed directory, not an uncommitted address field');
assert.ok(renderer.includes('external-drag.native-request'), 'native external drag requests are logged');
assert.ok(renderer.includes('event.stopPropagation();') && renderer.includes('window.pilot.startNativeDrag(paths)'), 'dedicated external drag handle delegates to Electron native file drag');
assert.ok((renderer.match(/event\.preventDefault\(\);\s*sftpDebug\('external-drag\.html-drag-cancelled-for-native'/g)||[]).length >= 2, 'native drag cancels the empty Chromium HTML drag before IPC for local and remote items');
assert.ok(!renderer.includes('cache-cleanup-requested'), 'renderer dragend does not delete remote staging before the native drag starts');
assert.ok(main.includes("queueNativeDragCleanup(files, 'native-drag-returned')"), 'native staged files are cleaned after the OS drag returns');
assert.ok(main.includes("app.on('child-process-gone'") && main.includes("render-process-gone"), 'DEBUG logs subprocess/renderer termination diagnostics');
assert.ok(css.includes('.layout.sftp-expanded{grid-template-columns:'), 'expanded SFTP is a true third grid column');
assert.ok(html.includes('id="sftp-debug-toggle"') && html.includes('id="debug-open-log-btn"'), 'DEBUG toggle and log-folder button remain available');
assert.ok(renderer.includes("function setSftpExpanded(expanded)") && renderer.includes("layout.classList.add(\'sftp-expanded\')"), "SFTP expands as a right-side third column");
assert.ok(css.includes('.remote-properties-dialog') && renderer.includes('updateRemoteMatrixFromMode') && renderer.includes('updateRemoteModeFromMatrix'), 'remote properties dialog and bidirectional octal permission editor exist');
assert.ok(css.includes('.file-name{font-size:13px'), 'SFTP file names use a readable 13px font');
assert.ok(css.includes('.top-status{font-size:14px'), 'top status text is readable');
assert.ok(css.includes('.file-list-spacer{display:block'), 'file-list blank area remains clickable at bottom');
assert.ok(renderer.includes("wireSftpBlankArea('local')"), 'local file-list blank area clears selection and has a context menu');
assert.ok(renderer.includes('file-list-spacer'), 'a clickable blank strip remains after the last file at scroll end');
assert.ok(renderer.includes('selection.marquee.start') && renderer.includes('selection.marquee.complete'), 'dragging a rectangle on blank space selects intersecting rows');
assert.ok(renderer.includes('if (refreshDynamic) {') && renderer.includes("renderFileList('local');") && renderer.includes('setTopStatus();'), 'manual language changes refresh dynamic SFTP and status UI without rebuilding at startup');

assert.ok(renderer.includes('const textSources = new WeakMap();') && renderer.includes('const attrSources = new WeakMap();'), 'language localization preserves original text/attribute sources like v0.6.0');
assert.ok(renderer.includes('function localizeTree(root = document.body)') && renderer.includes('const domLocalizer = new MutationObserver'), 'language engine follows v0.6.0 tree-localization and mutation-observer approach');
assert.ok(!renderer.includes('const enToZh = new Map(textPairs.map'), 'ambiguous many-to-one reverse dictionary is not used');
assert.ok(renderer.indexOf('updateLanguageButtons();', renderer.indexOf('function applyLanguage(')) < renderer.indexOf('localizeTree(document.body);', renderer.indexOf('function applyLanguage(')), 'language buttons update before translation runs');
assert.ok(renderer.includes("sftpDebug('language.button.click', { button: 'en' })") && renderer.includes("sftpDebug('language.button.click', { button: 'zh' })"), 'DEBUG records actual language-button clicks');
const langStart = renderer.indexOf('// Language engine restored from v0.6.0');
const langEnd = renderer.indexOf('function t(text)', langStart);
assert.ok(langStart >= 0 && langEnd > langStart, 'v0.6.0 language engine block is present');
const languageEngine = Function("let currentLanguage='en';\n" + renderer.slice(langStart, langEnd) + "\nreturn { setLanguage(v){currentLanguage=v}, normalizeSourceText, translateText };")();
assert.equal(languageEngine.translateText('新建 SSH 会话走代理（默认关闭）'), 'Use proxy for new SSH sessions (off by default)', 'new-session proxy label translates to English');
languageEngine.setLanguage('zh');
assert.equal(languageEngine.normalizeSourceText('Use proxy for new SSH sessions (off by default)'), '新建 SSH 会话走代理（默认关闭）', 'new-session proxy label restores from English to Chinese');
languageEngine.setLanguage('en');
assert.equal(languageEngine.translateText('文件属性'), 'File Properties', 'Chinese to English translation works');
assert.equal(languageEngine.translateText('常规'), 'General', 'remote properties General tab translates to English');
assert.equal(languageEngine.translateText('文件类型：'), 'Type of file:', 'remote properties type label translates to English');
assert.equal(languageEngine.translateText('八进制值：'), 'Numerical:', 'remote properties numerical label translates to English');
languageEngine.setLanguage('zh');
assert.equal(languageEngine.translateText('常规'), '常规', 'remote properties General tab returns to Chinese');
assert.equal(languageEngine.translateText('文件类型：'), '文件类型：', 'remote properties type label returns to Chinese');
assert.equal(languageEngine.translateText('八进制值：'), '八进制值：', 'remote properties numerical label returns to Chinese');
assert.equal(languageEngine.normalizeSourceText('No active SSH'), '无活动 SSH', 'English dynamic text can be canonicalized after language flips to Chinese');
assert.equal(languageEngine.translateText(languageEngine.normalizeSourceText('No active SSH')), '无活动 SSH', 'English to Chinese toggle restores dynamic status text');
languageEngine.setLanguage('en');
assert.equal(languageEngine.translateText('远程目录：/tmp · 36 项'), 'Remote directory: /tmp · 36 items', 'dynamic remote-directory summary translates');
languageEngine.setLanguage('zh');
assert.equal(languageEngine.normalizeSourceText('Remote directory: /tmp · 36 items'), '远程目录：/tmp · 36 项', 'dynamic remote-directory summary restores after switching back');

assert.ok(renderer.includes("if (!event.target.closest?.('.file-row')) clearSelection();"), 'clicking any blank region clears selection');
assert.ok(preload.includes("'sftp:drag-status'"), 'native drag errors are reported to the SFTP status line');
assert.ok(html.includes('id="ssh-tab-context-menu"'), 'SSH tabs have a dedicated right-click context menu');
assert.ok(renderer.includes('function reconnectSession(s, options = {})'), 'a tab reconnects using its own saved configuration');
assert.ok(renderer.includes('function toggleSessionProxy(s)'), 'each SSH tab has an independent proxy switch');
assert.ok(renderer.includes('function closeSessionTab(s)'), 'each SSH tab can be closed independently');
assert.ok(renderer.includes('const attemptId = makeId();') && renderer.includes('tabId: s.id, connectionId: attemptId'), 'tab identity stays stable while each SSH reconnect receives a fresh connection ID');
assert.ok(renderer.includes('if (s.events.length > 10000)') && renderer.includes("while ($('terminal').children.length > 10000)"), 'per-tab SSH output and displayed rows retain up to 10,000 records');
assert.ok(main.includes('const tabId = String(raw?.tabId || sessionId)') && main.includes('tabId: session.tabId'), 'SSH status/output events identify the stable tab separately from the connection');
assert.ok(main.includes('session.cancelConnect = () =>') && main.includes('if (sessions.get(sessionId) !== session)'), 'closing a connecting tab cancels pending SSH/proxy connection work');
assert.ok(renderer.includes('tabId:session.id,sessionId:session.connectionId') && renderer.includes('const ownerTab = task.tabId ? sshSessions.get(task.tabId) : null'), 'queued SFTP tasks stay attached to their tab and resolve the latest connection after reconnect');
assert.ok(css.includes('.session-proxy-toggle[aria-checked="true"]') && css.includes('.session-state-icon.disconnected'), 'tab proxy switch and SSH state icons have independent visual states');
assert.ok(!renderer.includes('remoteSelectionWarmupTimer'), 'remote selection never automatically downloads cache files');
assert.ok(!renderer.includes('remoteHoverWarmup'), 'hover never automatically downloads cache files');
assert.ok(renderer.includes('external-drag.prepare-during-gesture'), 'remote staging begins during an actual drag attempt');
assert.ok(renderer.includes('prepareRemoteForDrag(paths)'), 'remote staging uses the deliberate drag target paths');
assert.ok(renderer.includes('external-drag.auto-native-request-after-prepare'), 'remote native drag starts automatically after staging during the same held gesture');
assert.ok(renderer.includes('external-drag.prepared-after-gesture-ended'), 'early release is logged and the prepared cache remains available');
assert.ok(renderer.includes('handleSftpMouseNavigation'), 'mouse back/forward navigation is wired');
assert.ok(main.includes('N1PilotProperties.exe') && main.includes('local-properties.native-launch'), 'local properties use the native non-blocking launcher when packaged');
assert.ok(fs.existsSync(path.join(root, 'native', 'PropertiesLauncher.cs')), 'native properties launcher source exists');
assert.ok(main.includes('sender.startDrag({ file: files[0], icon })'), 'single-file OS drag uses the native file argument');
assert.ok(main.includes("sender.send('sftp:drag-status'"), 'native drag reports status/errors to the SFTP status line');
assert.ok(css.includes('.queue-row.failed'), 'failed transfers have a distinct visual state');
assert.ok(renderer.includes("if(task.status==='failed' || task.status==='queued')"), 'only queued/failed jobs can be removed from the queue');
assert.ok(renderer.includes('transferTasks.delete(task.id)'), 'successful transfer jobs are removed after completion');
assert.ok(renderer.includes("await window.pilot.saveSshProfile(cfg)"), 'SSH connection attempt persists the connection and password');
assert.ok(!renderer.includes("[' selected','已选择 ']"), 'no invalid reversed selected-count translation rule');
assert.ok(renderer.includes('queue-item-progress'), 'each transfer row has its own progress indicator');

assert.ok(preload.includes('webUtils') && preload.includes('getPathForFile: (file) => webUtils.getPathForFile(file)'), 'external OS files use Electron webUtils path API');
assert.ok(renderer.includes('window.pilot.getPathForFile(file)'), 'external drop path resolution uses the Electron-supported API');
assert.ok(renderer.includes('document.drag.dragstart') || renderer.includes('installGlobalDragDiagnostics'), 'global drag lifecycle diagnostics are installed');
assert.ok(html.includes('id="sftp-debug-toggle"') && html.includes('id="debug-open-log-btn"'), 'DEBUG toggle and log folder control exist');
assert.ok(main.includes("ipcMain.handle('app:set-debug-enabled'") && main.includes("ipcMain.handle('app:open-debug-log-folder'"), 'DEBUG mode is persistent and its log folder can be opened');
assert.ok(main.includes('5 * 1024 * 1024'), 'DEBUG logs rotate at a bounded size');
assert.ok(main.includes('app.debug-session-start') && main.includes('electronVersion: process.versions.electron'), 'each DEBUG session records app/runtime version information');
assert.ok(main.includes('options.skipUnsupported === true') && main.includes('remote-tree.skip-unsupported'), 'native directory drag-out skips unsupported Unix filesystem entries while regular transfers remain strict');
assert.ok(main.includes("remote-drag.prepare.begin") && main.includes("remote-drag.prepare.success") && main.includes("remote-drag.prepare.error"), 'remote native drag preparation is logged in the main process');

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const refs = new Set([...renderer.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
for (const id of refs) assert.ok(ids.has(id), `HTML element #${id} exists`);

const normalizeStart = renderer.indexOf('function normalizeCode(raw) {');
const normalizeEnd = renderer.indexOf('function fullRecord(run)', normalizeStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart, 'clipboard code normalizer exists');
const normalizeCode = Function(renderer.slice(normalizeStart, normalizeEnd) + '\nreturn normalizeCode;')();
assert.equal(normalizeCode('```sh\nuname -a\n```'), 'uname -a');
assert.equal(normalizeCode('echo one\necho two'), 'echo one\necho two');

assert.ok(html.indexOf('文件管理器（SFTP）') < html.indexOf('命令工作区'), 'SFTP panel appears above the command workspace');
assert.ok(html.indexOf('命令工作区') < html.indexOf('SSH 运行输出'), 'command workspace appears above terminal output');
const rendererSource = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
assert.match(rendererSource, /if \(node\.nodeValue !== translated\) \{ rec\.written = translated; node\.nodeValue = translated; \}/, 'source-preserving language engine only writes changed text');
assert.match(rendererSource, /localizeTree\(document\.body\);/, 'initial language localization remains present');
console.log('N1PilotDesktop language-repair static smoke tests passed.');


assert.ok(html.includes('>常规</button>') && html.includes('>权限</button>'), 'remote properties tabs use Chinese source strings for localization');
for (const zhLabel of ['文件类型：', '位置：', '大小：', '创建时间：', '修改时间：', '访问时间：', '所有者 ID：', '用户组 ID：', '读取', '写入', '执行', '所有者：', '组：', '其他：', '八进制值：', '八进制']) {
  assert.ok(html.includes(zhLabel), `remote properties dialog includes Chinese source label ${zhLabel}`);
}
assert.ok(renderer.includes('"常规":"General"') && renderer.includes('"文件类型：":"Type of file:"'), 'remote property dialog labels are present in the canonical Chinese-to-English dictionary');
assert.ok(renderer.includes('function refreshRemotePropertiesDialogLanguage()') && renderer.includes('refreshRemotePropertiesDialogLanguage();'), 'dynamic remote property fields refresh when the language changes');
assert.ok(main.includes("'local-properties.native-spawned'") && main.includes("'local-properties.native-exit'"), 'native properties launcher logs spawn and successful exit as well as errors');
const nativeHelper = fs.readFileSync(path.join(root, 'native', 'PropertiesLauncher.cs'), 'utf8');
assert.ok(nativeHelper.includes('SHObjectProperties') && nativeHelper.includes('SHOP_FILEPATH'), 'native properties launcher calls documented SHObjectProperties API');
assert.ok(nativeHelper.includes('while (IsWindow(propertyWindow)) Thread.Sleep(150)'), 'native launcher stays alive until the property window closes');
assert.ok(nativeHelper.includes('FindPropertiesWindow') && nativeHelper.includes('ERROR_TIMEOUT'), 'native launcher confirms a property window appeared and reports timeout otherwise');
