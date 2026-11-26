const $ = (id) => document.getElementById(id);
const browser = $('chat-browser');
const sshSessions = new Map();
const activeRuns = new Map();
const interactiveCopyTimers = new Map();
let interactiveCopyToastTimer = null;
let sshTabContextTarget = null;
let activeSessionId = null;
let chatReady = false;
let browserMainFrameFailed = false;
let hostKeyPending = null;
let sendingToChat = false;
let localSftpPath = '';
let localSftpParent = '';
let remoteSftpPath = '/tmp';
let localSftpEntries = [];
let remoteSftpEntries = [];
let remoteDirectoryOpenRequestId = 0;
let localSftpSelected = new Set();
let remoteSftpSelected = new Set();
let localLastSelectedIndex = -1;
let remoteLastSelectedIndex = -1;
const sftpDirectoryHistory = { local: { back: [], forward: [] }, remote: { back: [], forward: [] } };
let lastMouseNavigationAt = 0;
let sftpBusy = false;
let transferTasks = new Map();
let transferQueueRunning = false;
let activeContext = null;
let activeSftpSide = 'local';
let currentLanguage = localStorage.getItem('n1pilot.language') || 'zh';
let sshProfileCache = [];
let sftpExpanded = false;
let moveDialogSide = 'local';
let moveDialogPaths = [];
let remotePropsResolve = null;
let remotePropsCurrentEntry = null;
let remotePropsCurrentData = null;
let remotePropsOwnerTouched = false;
let remotePropsGroupTouched = false;
let remotePropsSpecialBits = '0';
const remoteDragCache = new Map();
const remoteDragPreparation = new Map();
let sftpDebugEnabled = true;
let globalDragOverLogTimes = new Map();
let dropDragOverLogTimes = new Map();
let activeExternalDragGesture = null;
function shouldSampleDragOver(map, key, intervalMs = 400) { const now=Date.now(); const last=map.get(key)||0; if(now-last<intervalMs)return false; map.set(key,now); if(map.size>300)map=new Map([...map.entries()].slice(-150)); return true; }
function sftpDebug(action, details = {}) { if (!sftpDebugEnabled) return; const record = { ts: new Date().toISOString(), action, details }; try { console.debug('[N1Pilot DEBUG]', record); } catch {} try { window.pilot.debugLog(record); } catch {} }

// Layout diagnostics: deliberately record geometry/state only; never command text,
// terminal output, passwords, hostnames, or other connection secrets.
const layoutDebugState = { lastSignature: '', observerTimer: null, observerReasons: [], observerEntries: [], lastWindowResizeAt: 0, lastFitLogAt: 0, lastWorkspaceMode: '', windowResizeTimer: null };
function px(value) { return Math.round((Number(value) || 0) * 10) / 10; }
function layoutNodeMetrics(selector, nodeOverride = null) {
  const node = nodeOverride || (typeof selector === 'string' ? document.querySelector(selector) : selector);
  if (!node) return { selector, exists: false };
  let rect = { x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
  try { const r = node.getBoundingClientRect(); rect = Object.fromEntries(Object.entries({ x:r.x, y:r.y, top:r.top, right:r.right, bottom:r.bottom, left:r.left, width:r.width, height:r.height }).map(([k,v]) => [k, px(v)])); } catch {}
  let cs = null; try { cs = getComputedStyle(node); } catch {}
  return {
    selector, id: node.id || '', className: typeof node.className === 'string' ? node.className : '',
    visible: !!(rect.width || rect.height) && (!cs || (cs.display !== 'none' && cs.visibility !== 'hidden')),
    rect, display: cs?.display || '', visibility: cs?.visibility || '', position: cs?.position || '',
    cssHeight: cs?.height || '', minHeight: cs?.minHeight || '', maxHeight: cs?.maxHeight || '',
    flex: cs?.flex || '', flexBasis: cs?.flexBasis || '', flexGrow: cs?.flexGrow || '', flexShrink: cs?.flexShrink || '',
    overflow: cs?.overflow || '', overflowX: cs?.overflowX || '', overflowY: cs?.overflowY || '',
    clientWidth: node.clientWidth, clientHeight: node.clientHeight, offsetWidth: node.offsetWidth, offsetHeight: node.offsetHeight,
    scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight,
    scrollTop: typeof node.scrollTop === 'number' ? node.scrollTop : undefined,
    parentId: node.parentElement?.id || '', parentClass: typeof node.parentElement?.className === 'string' ? node.parentElement.className : ''
  };
}
function buildLayoutSnapshot(reason, extras = {}) {
  const s = activeSession();
  const ui = s?.interactiveTerminal;
  const selectors = ['body', '.layout', '.right-pane', '.connection-panel', '#transfer-panel', '#ssh-workspace', '#command-panel', '#terminal-panel', '#interactive-panel', '#interactive-terminal-host'];
  const elements = {};
  for (const selector of selectors) elements[selector] = layoutNodeMetrics(selector);
  if (ui?.container) {
    elements['active-terminal-instance'] = layoutNodeMetrics('active-terminal-instance', ui.container);
    elements['xterm-root'] = layoutNodeMetrics('.xterm', ui.container.querySelector('.xterm'));
    elements['xterm-viewport'] = layoutNodeMetrics('.xterm-viewport', ui.container.querySelector('.xterm-viewport'));
    elements['xterm-screen'] = layoutNodeMetrics('.xterm-screen', ui.container.querySelector('.xterm-screen'));
  }
  const right = document.querySelector('.right-pane');
  return {
    reason, window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight, devicePixelRatio: window.devicePixelRatio, documentClientWidth: document.documentElement.clientWidth, documentClientHeight: document.documentElement.clientHeight, documentScrollWidth: document.documentElement.scrollWidth, documentScrollHeight: document.documentElement.scrollHeight },
    workspace: { sftpExpanded, activeTabId: s?.id || null, connectionId: s?.connectionId || null, mode: s?.mode || 'none', connected: !!s?.connected, rightPaneScrollTop: right?.scrollTop ?? null, rightPaneClientHeight: right?.clientHeight ?? null, rightPaneScrollHeight: right?.scrollHeight ?? null, rightPaneOverflow: right ? getComputedStyle(right).overflow : null },
    xterm: ui ? { cols: ui.terminal?.cols ?? null, rows: ui.terminal?.rows ?? null, started: !!(s?.connectionId && ui.startedConnectionId === s.connectionId), ended: !!(s?.connectionId && ui.endedConnectionId === s.connectionId), instanceHidden: ui.container?.classList.contains('hidden') ?? null } : null,
    elements, extras
  };
}
function recordLayoutSnapshot(reason, extras = {}, force = false) {
  if (!sftpDebugEnabled) return;
  const snapshot = buildLayoutSnapshot(reason, extras);
  const signature = JSON.stringify({
    window: snapshot.window,
    workspace: snapshot.workspace,
    xterm: snapshot.xterm,
    elements: Object.fromEntries(Object.entries(snapshot.elements).map(([key, value]) => [key, value.exists === false ? null : { rect: value.rect, display: value.display, cssHeight: value.cssHeight, minHeight: value.minHeight, maxHeight: value.maxHeight, flex: value.flex, overflow: value.overflow, clientHeight: value.clientHeight, scrollHeight: value.scrollHeight }]))
  });
  if (!force && signature === layoutDebugState.lastSignature) return;
  layoutDebugState.lastSignature = signature;
  sftpDebug('layout.snapshot', snapshot);
}
function describeTerminalGeometry(s, ui) {
  return { tabId: s?.id || null, mode: s?.mode || 'none', connected: !!s?.connected, cols: ui?.terminal?.cols ?? null, rows: ui?.terminal?.rows ?? null,
    host: layoutNodeMetrics('#interactive-terminal-host'), panel: layoutNodeMetrics('#interactive-panel'), workspace: layoutNodeMetrics('#ssh-workspace'), rightPane: layoutNodeMetrics('.right-pane'),
    instance: ui?.container ? layoutNodeMetrics('active-terminal-instance', ui.container) : null, xterm: ui?.container ? layoutNodeMetrics('.xterm', ui.container.querySelector('.xterm')) : null,
    viewport: ui?.container ? layoutNodeMetrics('.xterm-viewport', ui.container.querySelector('.xterm-viewport')) : null };
}
function fitInteractiveTerminal(s, reason) {
  const ui = s?.interactiveTerminal;
  if (!ui) return;
  const before = describeTerminalGeometry(s, ui);
  try { ui.fit.fit(); }
  catch (error) { sftpDebug('terminal.fit.error', { reason, tabId: s.id, error: error?.stack || String(error), before }); recordLayoutSnapshot(`fit-error:${reason}`, { error: String(error) }, true); return; }
  const after = describeTerminalGeometry(s, ui);
  const changed = before.cols !== after.cols || before.rows !== after.rows || before.host?.rect?.width !== after.host?.rect?.width || before.host?.rect?.height !== after.host?.rect?.height;
  const now = Date.now();
  const highFrequencyFit = /window-resize|resize-observer/.test(reason);
  if (!highFrequencyFit || changed || now - layoutDebugState.lastFitLogAt >= 180) {
    layoutDebugState.lastFitLogAt = now;
    sftpDebug('terminal.fit', { reason, changed, before: { cols: before.cols, rows: before.rows, host: before.host, panel: before.panel, workspace: before.workspace, rightPane: before.rightPane }, after: { cols: after.cols, rows: after.rows, host: after.host, panel: after.panel, workspace: after.workspace, rightPane: after.rightPane } });
  }
  recordLayoutSnapshot(`terminal.fit:${reason}`, { fitChanged: changed }, !highFrequencyFit);
}
function queueResizeObserverLayoutLog(reason, entries) {
  if (!sftpDebugEnabled) return;
  layoutDebugState.observerReasons.push(reason);
  for (const entry of entries || []) {
    const r = entry.contentRect || {};
    layoutDebugState.observerEntries.push({ targetId: entry.target?.id || '', targetClass: typeof entry.target?.className === 'string' ? entry.target.className : '', width: px(r.width), height: px(r.height), contentBoxSize: entry.contentBoxSize ? (Array.isArray(entry.contentBoxSize) ? entry.contentBoxSize : [entry.contentBoxSize]).map((b) => ({ inlineSize: px(b.inlineSize), blockSize: px(b.blockSize) })) : undefined });
  }
  if (layoutDebugState.observerTimer) clearTimeout(layoutDebugState.observerTimer);
  layoutDebugState.observerTimer = setTimeout(() => {
    const reasons = [...new Set(layoutDebugState.observerReasons)];
    const observed = layoutDebugState.observerEntries.slice(-20);
    layoutDebugState.observerReasons = []; layoutDebugState.observerEntries = []; layoutDebugState.observerTimer = null;
    recordLayoutSnapshot('resize-observer', { reasons, observed }, false);
  }, 70);
}
function droppedFileDetails(files) {
  return Array.from(files || []).map(file => {
    let filePath = ''; let pathError = '';
    try { filePath = window.pilot.getPathForFile(file) || ''; } catch (error) { pathError = String(error?.stack || error); }
    return { name: file.name, path: filePath, pathError: pathError || undefined, size: file.size, type: file.type, lastModified: file.lastModified };
  });
}
async function initializeDebugSettings() {
  try {
    const settings = await window.pilot.getDebugSettings();
    sftpDebugEnabled = settings?.enabled !== false;
    $('sftp-debug-toggle').checked = sftpDebugEnabled;
  } catch { sftpDebugEnabled = $('sftp-debug-toggle').checked; }
  $('sftp-debug-toggle').addEventListener('change', async () => {
    const enabled = $('sftp-debug-toggle').checked;
    try { await window.pilot.setDebugEnabled(enabled); sftpDebugEnabled = enabled; }
    catch (error) { sftpDebugEnabled = !enabled; $('sftp-debug-toggle').checked = sftpDebugEnabled; $('transfer-status').textContent = `${currentLanguage === 'en' ? 'Could not change DEBUG mode' : '无法切换 DEBUG 模式'}: ${error.message || error}`; }
    if (sftpDebugEnabled) sftpDebug('debug.enabled',{scope:'window resize, layout containers, xterm fit/grid, remote PTY resize, SFTP drag/transfer',logPath:'app userData\\logs\\sftp-debug.log'});
    $('transfer-status').textContent = sftpDebugEnabled ? (currentLanguage==='en'?'DEBUG enabled; window/layout/interactive-terminal and SFTP diagnostics are being recorded.':'DEBUG 已开启，正在记录窗口、布局、交互终端和 SFTP 诊断。') : (currentLanguage==='en'?'DEBUG disabled.':'DEBUG 已关闭。');
  });
  $('debug-open-log-btn').addEventListener('click', async () => {
    try { await window.pilot.openDebugLogFolder(); $('transfer-status').textContent = currentLanguage==='en'?'Opened the DEBUG log folder.':'已打开 DEBUG 日志目录。'; }
    catch (error) { $('transfer-status').textContent = `${currentLanguage==='en'?'Could not open log folder':'无法打开日志目录'}: ${error.message || error}`; }
  });
  sftpDebug('debug.scope', { scope: ['window resize/bounds in main process', 'DOM layout boxes and scroll metrics', 'ResizeObserver entries', 'xterm fit dimensions and grid', 'remote PTY rows/columns', 'SFTP diagnostics'], note: 'No command text, terminal output, passwords, or hostnames are recorded.' });
  recordLayoutSnapshot('app.initial-layout', {}, true);
}
function installGlobalDragDiagnostics() {
  // When a remote file must be staged asynchronously, keep the original mouse
  // gesture alive and start the native OS drag as soon as staging finishes.
  // If the user releases early, retain the ready cache for the next drag.
  for (const type of ['pointerup', 'pointercancel', 'mouseup']) {
    document.addEventListener(type, event => {
      const gesture = activeExternalDragGesture;
      if (!gesture || !gesture.pressed) return;
      if (type !== 'mouseup' && gesture.pointerId != null && event.pointerId != null && gesture.pointerId !== event.pointerId) return;
      gesture.pressed = false;
      sftpDebug('external-drag.gesture-release', { gestureId: gesture.id, side: gesture.side, path: gesture.path, type, pointerId: event.pointerId, hadDragStarted: gesture.dragStarted });
    }, true);
  }
  window.addEventListener('blur', () => {
    const gesture = activeExternalDragGesture;
    if (gesture?.pressed && !gesture.nativeRequestSent) {
      gesture.pressed = false;
      sftpDebug('external-drag.gesture-blur', { gestureId: gesture.id, side: gesture.side, path: gesture.path, hadDragStarted: gesture.dragStarted });
    }
  });
  const dragEvents = ['dragstart','dragend','dragenter','dragleave','drop'];
  for (const type of dragEvents) document.addEventListener(type, event => {
    const target = event.target;
    const types = Array.from(event.dataTransfer?.types || []);
    const details = { type, targetTag: target?.tagName || '', targetId: target?.id || '', targetClass: typeof target?.className === 'string' ? target.className : '', closestRow: target?.closest?.('.file-row')?.title || '', closestDragHandle: Boolean(target?.closest?.('.file-drag-out')), types, effectAllowed: event.dataTransfer?.effectAllowed, dropEffect: event.dataTransfer?.dropEffect, button: event.button, buttons: event.buttons };
    if (type === 'drop') details.files = droppedFileDetails(event.dataTransfer?.files || []);
    sftpDebug(`document.drag.${type}`, details);
  }, true);
  document.addEventListener('dragover', event => {
    if (!sftpDebugEnabled) return;
    const target = event.target; const key = `${target?.id || ''}|${typeof target?.className === 'string' ? target.className : target?.tagName || ''}|${Array.from(event.dataTransfer?.types || []).join(',')}`;
    const now = Date.now(); if (now - (globalDragOverLogTimes.get(key) || 0) < 500) return; globalDragOverLogTimes.set(key, now);
    if (globalDragOverLogTimes.size > 200) globalDragOverLogTimes = new Map([...globalDragOverLogTimes.entries()].slice(-100));
    sftpDebug('document.drag.dragover.sample', { targetTag: target?.tagName || '', targetId: target?.id || '', targetClass: typeof target?.className === 'string' ? target.className : '', types: Array.from(event.dataTransfer?.types || []), dropEffect: event.dataTransfer?.dropEffect });
  }, true);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function makeId() { return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function activeSession() { return activeSessionId ? sshSessions.get(activeSessionId) || null : null; }
function sessionName(s) { return `${s.username || 'root'}@${s.host || 'SSH'}:${s.port || 22}`; }
function setTopStatus() {
  const connected = [...sshSessions.values()].filter((s) => s.connected).length;
  const active = activeSession();
  $('ssh-dot').className = `dot ${connected ? 'green' : 'red'}`;
  $('ssh-status').textContent = connected ? (currentLanguage==='en'?`${connected} SSH session(s)`:`${connected} 个 SSH 会话`) : (currentLanguage==='en'?'No active SSH':'无活动 SSH');
  $('connection-badge').className = `badge ${active?.connected ? 'connected' : ''}`;
  $('connection-badge').textContent = active?.connected ? (currentLanguage==='en'?'Connected':'当前已连接') : active ? (currentLanguage==='en'?'Disconnected':'当前已断开') : (currentLanguage==='en'?'No active session':'无活动会话');
  $('disconnect-btn').disabled = !active?.connected;
  $('run-btn').disabled = !active?.connected;
  $('paste-run-btn').disabled = !active?.connected;
  if ($('interactive-mode-btn')) $('interactive-mode-btn').disabled = !active?.connected || active?.mode === 'interactive';
  if ($('command-mode-btn')) $('command-mode-btn').disabled = !active || active?.mode !== 'interactive';
  const localUpload = $('local-upload-btn');
  const remoteDownload = $('remote-download-btn');
  if (localUpload) localUpload.disabled = !active?.connected || !localSftpSelected.size || sftpBusy;
  if (remoteDownload) remoteDownload.disabled = !active?.connected || !remoteSftpSelected.size || sftpBusy;
  for (const id of ['remote-up-btn', 'remote-open-btn', 'remote-refresh-btn']) { const el = $(id); if (el) el.disabled = !active?.connected || sftpBusy; }
  const sftpBadge = $('sftp-session-badge');
  if (sftpBadge) sftpBadge.textContent = active?.connected ? `${active.username}@${active.host}` : '需连接 SSH';
  $('editor-status').textContent = active ? `${sessionName(active)}${active.connected ? (currentLanguage==='en'?' · Ready to run commands':' · 可执行命令') : (currentLanguage==='en'?' · Disconnected; history only':' · 已断开，仅可查看历史')}` : (currentLanguage==='en'?'Connect an SSH session first':'请先连接一个 SSH 会话');
  const latest = active?.latestRun;
  $('copy-record-btn').disabled = !latest;
  $('copy-output-btn').disabled = !latest;
  $('send-result-btn').disabled = !latest || !chatReady || sendingToChat;
}

function appendTerminal(sessionId, text, kind = 'output') {
  const s = sshSessions.get(sessionId);
  if (!s) return;
  const event = { text: String(text ?? ''), kind, at: new Date().toLocaleTimeString() };
  s.events.push(event);
  if (s.events.length > 10000) s.events.splice(0, s.events.length - 10000);
  if (sessionId === activeSessionId) appendDomEvent(event);
}
function appendDomEvent(event) {
  const row = document.createElement('pre');
  row.className = `log-line ${event.kind || 'output'}`;
  row.textContent = event.text;
  $('terminal').appendChild(row);
  while ($('terminal').children.length > 10000) $('terminal').removeChild($('terminal').firstChild);
  $('terminal').scrollTop = $('terminal').scrollHeight;
}
function renderTerminal() {
  $('terminal').replaceChildren();
  const s = activeSession();
  if (!s) {
    const e = document.createElement('pre'); e.className = 'log-line system'; e.textContent = currentLanguage === 'en' ? 'Connect SSH to keep per-session output history here.' : '请先连接 SSH。每个会话的运行输出会分别保留。'; $('terminal').appendChild(e); setTopStatus(); return;
  }
  if (!s.events.length) appendDomEvent({ kind: 'system', text: currentLanguage === 'en' ? `Switched to ${sessionName(s)}. Command output will appear here.` : `已切换到会话 ${sessionName(s)}。执行记录会显示在这里。` });
  else for (const e of s.events) appendDomEvent(e);
  $('terminal').scrollTop = $('terminal').scrollHeight;
  setTopStatus();
}
function tabStatusLabel(s) {
  if (s.connectionState === 'connecting' || s.connectionState === 'reconnecting') return currentLanguage === 'en' ? 'SSH connection in progress' : 'SSH 正在连接';
  if (s.connected) return currentLanguage === 'en' ? 'SSH connected' : 'SSH 已连接';
  if (s.connectionState === 'error') return currentLanguage === 'en' ? 'SSH connection failed; click reconnect' : 'SSH 连接失败；点击重连';
  return currentLanguage === 'en' ? 'SSH disconnected; history is retained' : 'SSH 已断开，历史记录仍保留';
}
function statusGlyph(s) {
  const icon = document.createElement('span');
  const state = s.connected ? 'connected' : (s.connectionState === 'connecting' || s.connectionState === 'reconnecting' ? 'connecting' : 'disconnected');
  icon.className = `session-state-icon ${state}`;
  icon.title = tabStatusLabel(s);
  icon.setAttribute('aria-label', tabStatusLabel(s));
  if (state !== 'connecting') {
    icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="bolt-shape" d="M13.1 1.8 4.2 13.2h6.6L9.9 22.2 20 9.1h-6.8z" fill="currentColor"/><path class="bolt-break" d="M3.8 3.4 20.2 20.6" fill="none" stroke="#10182a" stroke-width="2.5" stroke-linecap="round"/></svg>';
    if (s.connected) icon.querySelector('.bolt-break')?.remove();
  }
  return icon;
}
function createTabMenuButton(label, action, options = {}) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = label; button.disabled = options.disabled === true;
  if (options.danger) button.classList.add('context-danger');
  button.setAttribute('role', 'menuitem');
  button.addEventListener('click', async (event) => {
    event.stopPropagation(); $('ssh-tab-context-menu').classList.add('hidden');
    try { await action(); } catch (error) { const s = sshTabContextTarget; if (s && sshSessions.has(s.id)) appendTerminal(s.id, error?.message || String(error), 'error'); }
  });
  return button;
}
function showSshTabContextMenu(s, x, y) {
  const menu = $('ssh-tab-context-menu');
  if (menu.parentElement !== document.body) document.body.appendChild(menu);
  sshTabContextTarget = s;
  menu.replaceChildren();
  const english = currentLanguage === 'en';
  menu.appendChild(createTabMenuButton(english ? 'Reconnect with this tab’s settings' : '按本标签页配置重连', () => reconnectSession(s), { disabled: !sshSessions.has(s.id) || s.connectionState === 'connecting' }));
  menu.appendChild(createTabMenuButton(english ? (s.config?.useProxy ? 'Turn proxy off and reconnect' : 'Turn proxy on and reconnect') : (s.config?.useProxy ? '关闭代理并重连' : '启用代理并重连'), () => toggleSessionProxy(s), { disabled: !s.config || s.connectionState === 'connecting' }));
  menu.appendChild(createTabMenuButton(english ? 'Disconnect this session' : '断开此会话（保留历史）', () => disconnectSession(s), { disabled: !s.connectionId || (!s.connected && s.connectionState !== 'connecting') }));
  menu.appendChild(createTabMenuButton(english ? 'Close this tab' : '关闭此标签页', () => closeSessionTab(s), { danger: true }));
  menu.classList.remove('hidden');
  const width = 235, height = menu.scrollHeight || 150;
  menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - width - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - height - 6))}px`;
}
function renderTabs() {
  $('ssh-tab-context-menu')?.classList.add('hidden');
  const root = $('session-tabs');
  root.replaceChildren();
  if (!sshSessions.size) {
    const empty = document.createElement('span'); empty.className = 'empty-sessions'; empty.textContent = currentLanguage === 'en' ? 'SSH session tabs appear here after connecting' : '连接 SSH 后，这里会出现会话标签'; root.appendChild(empty); return;
  }
  for (const s of sshSessions.values()) {
    const tab = document.createElement('div');
    const stateClass = s.connectionState === 'connecting' || s.connectionState === 'reconnecting' ? ' connecting' : (s.connected ? '' : ' disconnected');
    tab.className = `session-tab${s.id === activeSessionId ? ' active' : ''}${stateClass}`;
    tab.dataset.tabId = s.id;
    tab.appendChild(statusGlyph(s));

    const reconnect = document.createElement('button');
    reconnect.type = 'button'; reconnect.className = 'session-reconnect-btn'; reconnect.textContent = '↻';
    reconnect.title = currentLanguage === 'en' ? 'Reconnect using this tab’s saved settings' : '按本标签页保存的配置重连';
    reconnect.setAttribute('aria-label', reconnect.title); reconnect.disabled = s.connectionState === 'connecting' || s.connectionState === 'reconnecting';
    reconnect.addEventListener('click', (event) => { event.stopPropagation(); void reconnectSession(s); });
    tab.appendChild(reconnect);

    const main = document.createElement('button'); main.type = 'button'; main.className = 'session-tab-main';
    main.title = tabStatusLabel(s);
    const name = document.createElement('span'); name.className = 'session-tab-name'; name.textContent = sessionName(s); main.appendChild(name);
    main.addEventListener('click', () => { activeSessionId = s.id; useActiveAndUpdate(); if (s.connected && !$('sftp-body').classList.contains('hidden')) loadRemoteDirectory($('remote-path').value.trim() || '/tmp'); });
    tab.appendChild(main);

    const proxy = document.createElement('button'); proxy.type = 'button'; proxy.className = 'session-proxy-toggle';
    proxy.setAttribute('role', 'switch'); proxy.setAttribute('aria-checked', s.config?.useProxy ? 'true' : 'false');
    proxy.setAttribute('aria-label', currentLanguage === 'en' ? 'Proxy setting for this tab; uses the proxy endpoint saved when the tab was created' : '本标签页的代理设置；使用创建标签页时保存的代理地址和端口');
    proxy.title = currentLanguage === 'en' ? (s.config?.useProxy ? 'Proxy enabled — click to disable and reconnect' : 'Proxy disabled — click to enable and reconnect') : (s.config?.useProxy ? '代理已启用，点击关闭并重连' : '代理未启用，点击开启并重连');
    proxy.disabled = !s.config || s.connectionState === 'connecting' || s.connectionState === 'reconnecting';
    proxy.innerHTML = '<span class="switch-knob"></span>';
    proxy.addEventListener('click', (event) => { event.stopPropagation(); void toggleSessionProxy(s); });
    tab.appendChild(proxy);

    const close = document.createElement('button'); close.type = 'button'; close.className = 'session-close-btn'; close.textContent = '×';
    close.title = currentLanguage === 'en' ? 'Close tab and clear its in-memory history' : '关闭标签页并清除该标签页内存历史';
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', (event) => { event.stopPropagation(); void closeSessionTab(s); });
    tab.appendChild(close);
    tab.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); showSshTabContextMenu(s, event.clientX, event.clientY); });
    root.appendChild(tab);
  }
}
function useActiveAndUpdate() {
  renderTabs();
  renderTerminal();
  renderWorkspaceMode();
  setTopStatus();
  const s = activeSession();
  if (s?.mode === 'interactive' && s.connected) void activateInteractiveTerminal(s);
}

function renderWorkspaceMode() {
  const s = activeSession();
  const interactive = s?.mode === 'interactive';
  const previousMode = layoutDebugState.lastWorkspaceMode;
  document.querySelector('.right-pane')?.classList.toggle('interactive-mode-active', interactive);
  $('command-panel').classList.toggle('hidden', interactive);
  $('terminal-panel').classList.toggle('hidden', interactive);
  $('interactive-panel').classList.toggle('hidden', !interactive);
  layoutDebugState.lastWorkspaceMode = interactive ? 'interactive' : 'command';
  if (previousMode !== layoutDebugState.lastWorkspaceMode) {
    sftpDebug('layout.workspace-mode-change', { previousMode: previousMode || 'initial', mode: layoutDebugState.lastWorkspaceMode, tabId: s?.id || null, connected: !!s?.connected });
    requestAnimationFrame(() => requestAnimationFrame(() => recordLayoutSnapshot('workspace-mode-settled', {}, true)));
  }
  $('interactive-mode-btn').disabled = !s?.connected || interactive;
  $('command-mode-btn').disabled = !s || !interactive;
  if (!interactive) return;
  const terminalUi = s.interactiveTerminal;
  for (const other of sshSessions.values()) {
    if (other.interactiveTerminal?.container) other.interactiveTerminal.container.classList.toggle('hidden', other.id !== s.id);
  }
  if (terminalUi?.container) requestAnimationFrame(() => {
    if (activeSessionId !== s.id || s.mode !== 'interactive') return;
    fitInteractiveTerminal(s, 'workspace-mode-render');
    if (s.connected) void activateInteractiveTerminal(s);
    terminalUi.terminal.focus();
  });
}

function showInteractiveCopyToast(message = '已复制到剪贴板') {
  const toast = $('interactive-copy-toast');
  toast.textContent = currentLanguage === 'en' ? 'Copied to clipboard' : message;
  toast.classList.remove('hidden');
  if (interactiveCopyToastTimer) clearTimeout(interactiveCopyToastTimer);
  interactiveCopyToastTimer = setTimeout(() => toast.classList.add('hidden'), 1500);
}

function disposeInteractiveTerminal(s) {
  if (!s?.interactiveTerminal) return;
  const ui = s.interactiveTerminal;
  const timer = interactiveCopyTimers.get(s.id);
  if (timer) clearTimeout(timer);
  interactiveCopyTimers.delete(s.id);
  try { if (ui.finishMouseSelection) { window.removeEventListener('mouseup', ui.finishMouseSelection, true); window.removeEventListener('blur', ui.finishMouseSelection); } } catch {}
  try { ui.resizeObserver?.disconnect(); } catch {}
  try { ui.terminal.dispose(); } catch {}
  try { ui.container.remove(); } catch {}
  s.interactiveTerminal = null;
}

function createInteractiveTerminal(s) {
  if (s.interactiveTerminal) return s.interactiveTerminal;
  if (typeof window.Terminal !== 'function' || !window.FitAddon?.FitAddon) {
    $('interactive-terminal-status').textContent = currentLanguage === 'en' ? 'Terminal library failed to load. Run npm install and restart the app.' : '终端组件未能加载。请先运行 npm install，再重新启动程序。';
    throw new Error('xterm.js / FitAddon 未加载，请检查依赖安装。');
  }
  const container = document.createElement('div');
  container.className = 'interactive-terminal-instance hidden';
  container.dataset.tabId = s.id;
  $('interactive-terminal-host').appendChild(container);
  const terminal = new window.Terminal({
    cursorBlink: true,
    convertEol: false,
    scrollback: 10000,
    allowProposedApi: false,
    rightClickSelectsWord: false,
    fontSize: 13,
    fontFamily: 'Cascadia Code, Consolas, "Courier New", monospace',
    theme: { background: '#070b13', foreground: '#d5e2f7', cursor: '#f2f6ff', selectionBackground: '#345783', black: '#111827', red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa', magenta: '#c084fc', cyan: '#67e8f9', white: '#e5e7eb', brightBlack: '#64748b', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#a5f3fc', brightWhite: '#ffffff' }
  });
  const fit = new window.FitAddon.FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container);
  const ui = { terminal, fit, container, resizeObserver: null, startedConnectionId: null, endedConnectionId: null, startPromise: null, selectionText: '' };
  sftpDebug('terminal.instance-created', { tabId: s.id, mode: s.mode, initialCols: terminal.cols, initialRows: terminal.rows, host: layoutNodeMetrics('#interactive-terminal-host'), panel: layoutNodeMetrics('#interactive-panel') });
  recordLayoutSnapshot('terminal.instance-created', {}, true);
  s.interactiveTerminal = ui;
  if (typeof ResizeObserver === 'function') {
    ui.resizeObserver = new ResizeObserver((entries) => {
      const rects = (entries || []).map((entry) => { const r = entry.contentRect || {}; return { id: entry.target?.id || '', className: typeof entry.target?.className === 'string' ? entry.target.className : '', width: px(r.width), height: px(r.height) }; });
      sftpDebug('terminal.resize-observer-fired', { tabId: s.id, active: activeSessionId === s.id, mode: s.mode, hidden: container.classList.contains('hidden'), rects });
      queueResizeObserverLayoutLog('terminal-resize-observer', entries);
      if (activeSessionId !== s.id || s.mode !== 'interactive' || container.classList.contains('hidden')) return;
      requestAnimationFrame(() => {
        if (activeSessionId !== s.id || s.mode !== 'interactive' || container.classList.contains('hidden')) return;
        fitInteractiveTerminal(s, 'resize-observer');
      });
    });
    // Observe every level that can change the available height. The workspace wrapper
    // is the flex item that grows when the window is resized; the terminal host is the
    // final box xterm must fit into.
    ui.resizeObserver.observe($('ssh-workspace'));
    ui.resizeObserver.observe($('interactive-panel'));
    ui.resizeObserver.observe($('interactive-terminal-host'));
  }

  ui.pendingInput = '';
  terminal.onData((data) => {
    const connectionId = s.connectionId;
    if (!connectionId || !s.connected || sshSessions.get(s.id) !== s) return;
    if (ui.startedConnectionId === connectionId) window.pilot.writeTerminal(connectionId, data);
    else if (ui.pendingInput.length + data.length <= 1024 * 1024) ui.pendingInput += data;
    else $('interactive-terminal-status').textContent = currentLanguage === 'en' ? 'Input buffer is full while the Shell is starting.' : 'Shell 启动期间的输入缓冲区已满。';
  });
  terminal.onResize(({ cols, rows }) => {
    const connectionId = s.connectionId;
    sftpDebug('terminal.xterm-grid-resize', { tabId: s.id, connectionId: connectionId || null, mode: s.mode, cols, rows, host: layoutNodeMetrics('#interactive-terminal-host'), instance: layoutNodeMetrics('active-terminal-instance', container) });
    if (connectionId && s.connected && sshSessions.get(s.id) === s) window.pilot.resizeTerminal(connectionId, cols, rows);
  });
  const scheduleSelectionCopy = (delay = 80) => {
    if (ui.mouseSelecting) return;
    if (interactiveCopyTimers.has(s.id)) clearTimeout(interactiveCopyTimers.get(s.id));
    const timer = setTimeout(async () => {
      interactiveCopyTimers.delete(s.id);
      const selected = terminal.getSelection();
      if (!selected || activeSessionId !== s.id || s.mode !== 'interactive') return;
      try {
        await window.pilot.copyText(selected);
        ui.selectionText = selected;
        showInteractiveCopyToast();
      } catch (error) {
        $('interactive-terminal-status').textContent = `${currentLanguage === 'en' ? 'Clipboard copy failed' : '复制到剪贴板失败'}: ${error.message || error}`;
      }
    }, delay);
    interactiveCopyTimers.set(s.id, timer);
  };
  container.addEventListener('mousedown', (event) => { if (event.button === 0) ui.mouseSelecting = true; });
  ui.finishMouseSelection = () => { if (ui.mouseSelecting) { ui.mouseSelecting = false; scheduleSelectionCopy(60); } };
  window.addEventListener('mouseup', ui.finishMouseSelection, true);
  window.addEventListener('blur', ui.finishMouseSelection);
  terminal.onSelectionChange(() => scheduleSelectionCopy(200));
  container.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    if (activeSessionId !== s.id || s.mode !== 'interactive') return;
    try {
      const text = await window.pilot.readClipboard();
      if (text) { terminal.paste(text); terminal.focus(); }
    } catch (error) {
      $('interactive-terminal-status').textContent = `${currentLanguage === 'en' ? 'Paste failed' : '粘贴失败'}: ${error.message || error}`;
    }
  });
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'v') {
      void window.pilot.readClipboard().then((text) => { if (text && activeSessionId === s.id && s.mode === 'interactive') terminal.paste(text); }).catch(() => {});
      return false;
    }
    return true;
  });
  return ui;
}

function flushPendingTerminalInput(s, connectionId) {
  const ui = s?.interactiveTerminal;
  if (!ui || !connectionId || s.connectionId !== connectionId || ui.startedConnectionId !== connectionId || !ui.pendingInput) return;
  const queued = ui.pendingInput;
  ui.pendingInput = '';
  window.pilot.writeTerminal(connectionId, queued);
}

async function activateInteractiveTerminal(s) {
  if (!s || sshSessions.get(s.id) !== s || s.mode !== 'interactive') return;
  let ui;
  try { ui = createInteractiveTerminal(s); }
  catch (error) { $('interactive-terminal-status').textContent = error.message || String(error); return; }
  for (const other of sshSessions.values()) if (other.interactiveTerminal?.container) other.interactiveTerminal.container.classList.toggle('hidden', other.id !== s.id);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  fitInteractiveTerminal(s, 'activate-interactive-terminal');
  if (!s.connected || !s.connectionId) {
    $('interactive-terminal-status').textContent = currentLanguage === 'en' ? 'SSH disconnected. Reconnect this tab to start a new interactive Shell.' : 'SSH 已断开。请重连此标签页以启动新的交互式 Shell。';
    return;
  }
  if (ui.endedConnectionId === s.connectionId) {
    $('interactive-terminal-status').textContent = currentLanguage === 'en' ? 'Interactive Shell has ended. Switch to command mode and reopen it to start a new Shell.' : '交互式 Shell 已结束；切换回命令模式后再重新进入，可启动新的 Shell。';
    return;
  }
  if (ui.startedConnectionId === s.connectionId) {
    $('interactive-terminal-status').textContent = currentLanguage === 'en' ? `Interactive Shell · ${sessionName(s)}` : `交互式 Shell · ${sessionName(s)}`;
    return;
  }
  if (ui.startPromise?.connectionId === s.connectionId) return ui.startPromise.promise;
  const connectionId = s.connectionId;
  const cols = Math.max(2, ui.terminal.cols || 80);
  const rows = Math.max(2, ui.terminal.rows || 24);
  sftpDebug('terminal.shell-start-request', { tabId: s.id, connectionId, cols, rows, geometry: describeTerminalGeometry(s, ui) });
  $('interactive-terminal-status').textContent = currentLanguage === 'en' ? 'Starting interactive Shell…' : '正在启动交互式 Shell…';
  const promise = window.pilot.startTerminal(connectionId, cols, rows).then((result) => {
    if (sshSessions.get(s.id) !== s || s.connectionId !== connectionId) return;
    ui.startedConnectionId = connectionId;
    sftpDebug('terminal.shell-start-result', { tabId: s.id, connectionId, result, cols: ui.terminal.cols, rows: ui.terminal.rows, geometry: describeTerminalGeometry(s, ui) });
    flushPendingTerminalInput(s, connectionId);
    $('interactive-terminal-status').textContent = currentLanguage === 'en' ? `Interactive Shell · ${sessionName(s)}` : `交互式 Shell · ${sessionName(s)}`;
    if (result?.alreadyRunning === false) ui.terminal.focus();
  }).catch((error) => {
    sftpDebug('terminal.shell-start-failed', { tabId: s.id, connectionId, error: error?.stack || String(error), geometry: describeTerminalGeometry(s, ui) });
    if (s.connectionId === connectionId) $('interactive-terminal-status').textContent = `${currentLanguage === 'en' ? 'Failed to start interactive Shell' : '交互式 Shell 启动失败'}: ${error.message || error}`;
    return null;
  }).finally(() => { if (ui.startPromise?.connectionId === connectionId) ui.startPromise = null; });
  ui.startPromise = { connectionId, promise };
  return promise;
}

async function switchActiveSessionMode(mode) {
  const s = activeSession();
  if (!s) return;
  if (mode === 'interactive' && !s.connected) {
    $('interactive-terminal-status').textContent = currentLanguage === 'en' ? 'Connect SSH first.' : '请先连接 SSH。';
    return;
  }
  if (mode === 'interactive' && s.interactiveTerminal) s.interactiveTerminal.endedConnectionId = null;
  s.mode = mode === 'interactive' ? 'interactive' : 'command';
  renderWorkspaceMode();
  if (s.mode === 'interactive') await activateInteractiveTerminal(s);
  else $('command-editor').focus();
  setTopStatus();
}

async function connectSessionTab(s, connectionMessage = '') {
  if (!s || sshSessions.get(s.id) !== s || s.connectionState === 'connecting' || s.connectionState === 'reconnecting') return;
  const attemptId = makeId();
  s.connectionId = attemptId;
  s.connected = false;
  s.connectionState = 'connecting';
  s.lastError = '';
  renderTabs(); setTopStatus();
  if (connectionMessage) appendTerminal(s.id, connectionMessage, 'system');
  try {
    const result = await window.pilot.connect({ ...s.config, tabId: s.id, connectionId: attemptId });
    if (sshSessions.get(s.id) !== s || s.connectionId !== attemptId) { try { await window.pilot.disconnect(attemptId); } catch {} return; }
    s.host = result.host || s.config.host; s.port = result.port || s.config.port; s.username = result.username || s.config.username;
    s.connected = true; s.connectionState = 'connected';
    $('ssh-message').textContent = result.message || (currentLanguage === 'en' ? 'SSH connected' : 'SSH 连接成功');
    useActiveAndUpdate();
    if (activeSessionId === s.id) loadRemoteDirectory($('remote-path').value.trim() || '/tmp');
  } catch (error) {
    if (sshSessions.get(s.id) !== s || s.connectionId !== attemptId) return;
    s.connected = false; s.connectionState = 'error'; s.lastError = error?.message || String(error);
    if (activeSessionId === s.id) $('ssh-message').textContent = s.lastError;
    appendTerminal(s.id, s.lastError, 'error');
    useActiveAndUpdate();
  }
}
async function discardSessionConnection(s, recordHistory = false) {
  const oldConnectionId = s?.connectionId;
  if (!s) return;
  s.connectionId = null;
  s.connected = false;
  s.connectionState = 'disconnected';
  if (s.interactiveTerminal) { s.interactiveTerminal.startedConnectionId = null; s.interactiveTerminal.endedConnectionId = null; s.interactiveTerminal.pendingInput = ''; }
  renderTabs(); setTopStatus();
  if (oldConnectionId) { try { await window.pilot.disconnect(oldConnectionId); } catch {} }
  if (recordHistory && sshSessions.get(s.id) === s) appendTerminal(s.id, `[${new Date().toLocaleTimeString()}] ${currentLanguage === 'en' ? 'SSH session disconnected by user.' : '已由用户断开 SSH。'}`, 'system');
}
async function disconnectSession(s) {
  if (!s || sshSessions.get(s.id) !== s) return;
  if (!s.connectionId) { s.connected = false; s.connectionState = 'disconnected'; useActiveAndUpdate(); return; }
  await discardSessionConnection(s, true);
  if (sshSessions.get(s.id) === s) useActiveAndUpdate();
}
async function reconnectSession(s, options = {}) {
  if (!s || sshSessions.get(s.id) !== s || s.connectionState === 'connecting' || s.connectionState === 'reconnecting') return;
  const wasConnected = s.connected;
  const english = currentLanguage === 'en';
  if (wasConnected && options.skipConfirmation !== true) {
    const prompt = english
      ? 'Reconnect will interrupt this SSH connection, running commands, and any active SFTP transfers. The tab history will be kept. Continue?'
      : '重连会中断当前 SSH 连接、正在运行的命令以及进行中的 SFTP 传输，但会保留标签页历史。确定继续吗？';
    if (!window.confirm(prompt)) return;
  }
  if (s.connectionId) await discardSessionConnection(s, false);
  if (sshSessions.get(s.id) !== s) return;
  await connectSessionTab(s, `[${new Date().toLocaleTimeString()}] ${english ? 'Reconnecting with this tab’s saved settings…' : '正在按本标签页保存的配置重连…'}`);
}
async function toggleSessionProxy(s) {
  if (!s || sshSessions.get(s.id) !== s || !s.config || s.connectionState === 'connecting' || s.connectionState === 'reconnecting') return;
  const nextEnabled = !s.config.useProxy;
  if (s.connected) {
    const prompt = currentLanguage === 'en'
      ? `Turning the SSH proxy ${nextEnabled ? 'on' : 'off'} requires reconnecting and may interrupt running commands or active SFTP transfers. The tab history will be kept. Continue?`
      : `切换 SSH 代理为${nextEnabled ? '开启' : '关闭'}需要重连，可能会中断正在运行的命令或进行中的 SFTP 传输；标签页历史会保留。确定继续吗？`;
    if (!window.confirm(prompt)) return;
  }
  s.config = { ...s.config, useProxy: nextEnabled, proxy: s.config.proxy ? { ...s.config.proxy } : null };
  renderTabs();
  await reconnectSession(s, { skipConfirmation: true });
}
async function closeSessionTab(s) {
  if (!s || sshSessions.get(s.id) !== s) return;
  const english = currentLanguage === 'en';
  if (s.connected || s.connectionState === 'connecting' || s.connectionState === 'reconnecting') {
    const prompt = english
      ? 'Closing this tab will disconnect SSH and clear its in-memory history. Any running command or active SFTP transfer may be interrupted. Continue?'
      : '关闭标签页会断开 SSH 并清除该标签页的内存历史，正在运行的命令或 SFTP 传输也可能中断。确定关闭吗？';
    if (!window.confirm(prompt)) return;
  }
  const connectionId = s.connectionId;
  s.connectionId = null; s.connected = false; s.connectionState = 'disconnected';
  disposeInteractiveTerminal(s);
  sshSessions.delete(s.id);
  if (activeSessionId === s.id) activeSessionId = [...sshSessions.keys()].pop() || null;
  if (connectionId) { try { await window.pilot.disconnect(connectionId); } catch {} }
  $('ssh-tab-context-menu').classList.add('hidden'); sshTabContextTarget = null;
  if (activeSessionId && activeSession()?.connected && !$('sftp-body').classList.contains('hidden')) loadRemoteDirectory($('remote-path').value.trim() || '/tmp');
  else if (!activeSession()?.connected) { remoteSftpEntries = []; remoteSftpSelected.clear(); renderFileList('remote', true); }
  useActiveAndUpdate();
}
function normalizeCode(raw) {
  let text = String(raw || '').replace(/^\uFEFF/, '').trim();
  const lines = text.split(/\r?\n/);
  if (lines.length >= 2 && /^\s*```(?:sh|bash|ash|shell|zsh)?\s*$/i.test(lines[0]) && /^\s*```\s*$/.test(lines[lines.length - 1])) {
    text = lines.slice(1, -1).join('\n').trim();
  }
  return text;
}
function fullRecord(run) {
  const lines = [
    `SSH 运行记录`, `主机：${run.host || ''}:${run.port || 22}`, `账号：${run.username || ''}`,
    `开始时间：${run.startedAt}`, `结束时间：${run.endedAt || '仍在运行'}`, `命令：`, run.command,
    `退出码：${run.exitCode === null || run.exitCode === undefined ? '未知/未结束' : run.exitCode}`,
    `stdout：`, run.stdout || '(空)', `stderr：`, run.stderr || '(空)'
  ];
  if (run.error) lines.push('执行错误：', run.error);
  if (run.truncated) lines.push('[输出内容可能已达到本地采集上限]');
  return lines.join('\n');
}
function outputOnly(run) {
  const lines = [];
  if (run.stdout) lines.push(run.stdout);
  if (run.stderr) lines.push('[stderr]\n' + run.stderr);
  lines.push(`[退出码：${run.exitCode === null || run.exitCode === undefined ? '未知/未结束' : run.exitCode}]`);
  if (run.error) lines.push(`[执行错误：${run.error}]`);
  return lines.join('\n');
}
async function copyText(text, message) {
  await window.pilot.copyText(String(text || ''));
  if (activeSessionId) appendTerminal(activeSessionId, message || '已复制到剪贴板。', 'success');
}

async function runCommand(raw, sourceLabel = '编辑框') {
  const s = activeSession();
  if (!s?.connected) throw new Error('请先选择一个已连接的 SSH 会话。');
  const command = normalizeCode(raw);
  if (!command) throw new Error('命令框为空。请先粘贴 GPT 代码或输入命令。');
  if (command.length > 12000) throw new Error('代码超过 12000 字符限制；请拆分成较小步骤执行。');
  const risk = await window.pilot.inspectCommand(command);
  if (risk.level === 'blocked') throw new Error(`安全拦截：${risk.reason}`);
  let approvedRisk = false;
  if (risk.requiresConfirmation) {
    approvedRisk = window.confirm(`这条命令可能进行高风险操作：${risk.reason}\n\n命令：\n${command.slice(0, 3000)}${command.length > 3000 ? '\n…（已截断显示）' : ''}\n\n确认后才会执行。确定继续吗？`);
    if (!approvedRisk) { appendTerminal(s.id, '你取消了高风险命令，本次未执行。', 'system'); return; }
  }
  const runId = makeId();
  const run = { id: runId, sessionId: s.id, host: s.host, port: s.port, username: s.username, command, sourceLabel, startedAt: new Date().toLocaleString(), endedAt: '', stdout: '', stderr: '', exitCode: null, error: '', complete: false, truncated: false };
  s.latestRun = run;
  activeRuns.set(runId, run);
  appendTerminal(s.id, `\n[${run.startedAt}] $ ${command}`, 'command');
  setTopStatus();
  $('run-btn').disabled = true; $('paste-run-btn').disabled = true;
  $('editor-status').textContent = `正在执行：${sessionName(s)}`;
  try {
    const timeout = Math.max(5, Math.min(300, Number($('command-timeout').value || 90)));
    const result = await window.pilot.exec(s.connectionId, command, timeout, approvedRisk, runId);
    run.stdout = result.stdout || run.stdout;
    run.stderr = result.stderr || run.stderr;
    run.exitCode = result.exitCode;
    run.truncated = Boolean(result.truncated);
    run.complete = true;
    run.endedAt = new Date().toLocaleString();
    appendTerminal(s.id, `\n[命令结束] 退出码=${run.exitCode === null ? '未知' : run.exitCode}${result.signal ? `；信号=${result.signal}` : ''}`, run.exitCode === 0 ? 'success' : 'system');
  } catch (e) {
    run.error = e?.message || String(e);
    run.complete = true;
    run.endedAt = new Date().toLocaleString();
    appendTerminal(s.id, `\n[执行错误] ${run.error}`, 'error');
  } finally {
    activeRuns.delete(runId);
    if (activeSessionId === s.id) $('editor-status').textContent = `${sessionName(s)} · ${run.complete ? '本次执行已结束' : '执行状态未知'}`;
    setTopStatus();
  }
  return run;
}

async function handleRunFromEditor() {
  try { await runCommand($('command-editor').value, '编辑框'); }
  catch (e) { if (activeSessionId) appendTerminal(activeSessionId, e.message || String(e), 'error'); else alert(e.message || String(e)); }
}
async function handlePasteAndRun() {
  try {
    const clipboardText = await window.pilot.readClipboard();
    if (!String(clipboardText || '').trim()) throw new Error('系统剪贴板为空。先在 GPT 代码块中点复制，再点击“粘贴并运行”。');
    $('command-editor').value = normalizeCode(clipboardText);
    $('command-editor').focus();
    await runCommand($('command-editor').value, '剪贴板');
  } catch (e) { if (activeSessionId) appendTerminal(activeSessionId, e.message || String(e), 'error'); else alert(e.message || String(e)); }
}

async function sendChatMessage(message) {
  if (!chatReady) throw new Error('ChatGPT 页面尚未加载完成。');
  const before = await browser.executeJavaScript(`(() => {
    const visible = (el) => !!(el && el.getClientRects && el.getClientRects().length);
    const selectors = ['#prompt-textarea', '[data-testid="composer-textarea"]', '[contenteditable="true"][role="textbox"]', 'textarea[placeholder]', '[contenteditable="true"]'];
    let editor = null;
    for (const sel of selectors) { editor = Array.from(document.querySelectorAll(sel)).find(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true'); if (editor) break; }
    return { url: location.href, composerFound: !!editor, composerText: editor ? String(('value' in editor ? editor.value : (editor.innerText || editor.textContent)) || '').trim() : '' };
  })()`, true);
  if (!before?.composerFound) throw new Error('左侧 ChatGPT 页面没有找到输入框。');
  if (before.composerText) throw new Error(`ChatGPT 输入框已有未发送内容（${before.composerText.length} 字符），为避免覆盖而取消发送。`);
  const script = `((message) => {
    const visible = (el) => !!(el && el.getClientRects && el.getClientRects().length);
    if (location.hostname !== 'chatgpt.com' && !location.hostname.endsWith('.chatgpt.com')) return { ok:false, error:'当前页面不是 chatgpt.com' };
    const selectors = ['#prompt-textarea', '[data-testid="composer-textarea"]', '[contenteditable="true"][role="textbox"]', 'textarea[placeholder]', '[contenteditable="true"]'];
    let editor = null;
    for (const sel of selectors) { editor = Array.from(document.querySelectorAll(sel)).find(el => visible(el) && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && !el.disabled && el.getAttribute('aria-disabled') !== 'true'); if (editor) break; }
    if (!editor) return { ok:false, error:'没有找到可用输入框' };
    editor.focus();
    if (editor.isContentEditable || editor.getAttribute('contenteditable') === 'true') {
      document.execCommand('insertText', false, message);
      if (!(editor.innerText || '').trim()) editor.textContent = message;
      editor.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:message }));
    } else {
      const proto = editor.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(editor, message); else editor.value = message;
      editor.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:message }));
      editor.dispatchEvent(new Event('change', { bubbles:true }));
    }
    return new Promise(resolve => setTimeout(() => {
      const form = editor.closest('form');
      const buttons = [form && form.querySelector('button[type="submit"]'), document.querySelector('button[data-testid="send-button"]'), document.querySelector('button[aria-label="Send prompt"]'), document.querySelector('button[aria-label="Send message"]'), document.querySelector('button[aria-label*="Send" i]'), document.querySelector('button[aria-label*="发送"]')].filter(Boolean);
      const btn = buttons.find(b => visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
      if (btn) { btn.click(); resolve({ ok:true, method:'click' }); return; }
      resolve({ ok:true, method:'native-enter' });
    }, 250));
  })(${JSON.stringify(String(message || ''))})`;
  const result = await browser.executeJavaScript(script, true);
  if (!result?.ok) throw new Error(result?.error || '无法填入 ChatGPT 输入框。');
  if (result.method === 'native-enter') {
    await browser.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' });
    await browser.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
  }
  let check;
  for (let i = 0; i < 8; i++) {
    await sleep(300);
    check = await browser.executeJavaScript(`(() => {
      const visible = el => !!(el && el.getClientRects && el.getClientRects().length);
      const selectors = ['#prompt-textarea', '[data-testid="composer-textarea"]', '[contenteditable="true"][role="textbox"]', 'textarea[placeholder]', '[contenteditable="true"]'];
      let editor = null; for (const sel of selectors) { editor = Array.from(document.querySelectorAll(sel)).find(el => visible(el)); if (editor) break; }
      return { found:!!editor, text:editor ? String(('value' in editor ? editor.value : (editor.innerText || editor.textContent)) || '').trim() : '' };
    })()`, true);
    if (check?.found && !check.text) break;
  }
  if (!check?.found || check.text) throw new Error('无法确认消息已提交；请检查左侧 ChatGPT 输入框，避免重复发送。');
}

async function sendLatestResult() {
  const s = activeSession(); const run = s?.latestRun;
  if (!run) return;
  if (sendingToChat) return;
  let payload = fullRecord(run);
  const max = 18000;
  if (payload.length > max) payload = payload.slice(0, max) + '\n\n[发送给 GPT 的文本已截断；本地复制完整记录不受此限制]';
  const message = `以下是我人工执行 SSH 命令后采集到的真实结果，请根据它继续分析。不要假设命令成功；先解读退出码与输出，再给出下一步。如需我执行命令，请只给一个带 sh 语言标记的代码块，尽量先做只读检查。\n\n<SSH_RUN_RESULT>\n${payload}\n</SSH_RUN_RESULT>`;
  sendingToChat = true; setTopStatus(); $('transfer-status').textContent = '正在把本次 SSH 结果发送到左侧 ChatGPT…';
  try { await sendChatMessage(message); appendTerminal(s.id, '本次 SSH 运行记录已发送到左侧 ChatGPT。', 'success'); $('transfer-status').textContent = 'SSH 结果已发送到 GPT。'; }
  catch (e) { appendTerminal(s.id, `回传 GPT 失败：${e.message || e}`, 'error'); $('transfer-status').textContent = `回传失败：${e.message || e}`; }
  finally { sendingToChat = false; setTopStatus(); }
}

function getProxyConfig() {
  return {
    enabled: $('gpt-proxy-enabled').checked,
    type: $('proxy-type').value,
    host: $('proxy-host').value.trim(),
    port: Number($('proxy-port').value || 0)
  };
}
function updateProxySummary() {
  const cfg = getProxyConfig();
  const address = `${cfg.type.toUpperCase()} · ${cfg.host || '未填写'}:${cfg.port || '未填写'}`;
  $('proxy-summary').textContent = cfg.enabled ? `${address} · ${currentLanguage==='en'?'Enabled':'已启用'}` : `${address} · ${currentLanguage==='en'?'GPT direct':'GPT 直连'}`;
}
async function initializeProxySettings() {
  try {
    const cfg = await window.pilot.getChatProxy();
    $('gpt-proxy-enabled').checked = cfg.enabled !== false;
    $('proxy-type').value = cfg.type || 'socks5';
    $('proxy-host').value = cfg.host || '127.0.0.1';
    $('proxy-port').value = cfg.port || 10808;
    updateProxySummary();
  } catch (e) {
    $('proxy-status').textContent = `读取代理设置失败：${e.message || e}`;
  }
}
function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
function visibleEntries(side) {
  const all = side === 'local' ? localSftpEntries : remoteSftpEntries;
  const filter = $(`${side}-filter`)?.value.trim().toLocaleLowerCase() || '';
  const showHidden = $('sftp-show-hidden')?.checked === true;
  const sort = $(`${side}-sort`)?.value || 'name';
  return all.filter((e) => (showHidden || !e.name.startsWith('.')) && (!filter || e.name.toLocaleLowerCase().includes(filter)))
    .sort((a,b) => Number(b.isDir)-Number(a.isDir) || (sort === 'size' ? Number(a.size||0)-Number(b.size||0) : sort === 'mtime' ? Number(b.mtime||0)-Number(a.mtime||0) : a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})));
}
function selectedEntries(side) {
  const all = side === 'local' ? localSftpEntries : remoteSftpEntries;
  const selected = side === 'local' ? localSftpSelected : remoteSftpSelected;
  return all.filter((entry) => selected.has(entry.path));
}
function selectedPaths(side) { return selectedEntries(side).map((entry) => entry.path); }
function activePath(side) { return side === 'local' ? localSftpPath : remoteSftpPath; }
function remoteParentPath(raw) { const value=String(raw||'/').replace(/\/+$/,'')||'/'; if(value==='/')return '/'; const slash=value.lastIndexOf('/'); return slash<=0?'/':value.slice(0,slash); }
function updateSelectionCount(side) {
  const selected = side === 'local' ? localSftpSelected : remoteSftpSelected;
  const countEl = $(`${side}-selection-count`);
  if (countEl) countEl.textContent = selected.size ? (currentLanguage === 'en' ? `${selected.size} selected` : `已选择 ${selected.size} 项`) : (currentLanguage === 'en' ? 'No selection' : '未选择文件');
}
function updateSftpButtons() {
  const active = activeSession();
  if ($('local-upload-btn')) $('local-upload-btn').disabled = !active?.connected || !localSftpSelected.size;
  if ($('remote-download-btn')) $('remote-download-btn').disabled = !active?.connected || !remoteSftpSelected.size;
  for (const id of ['remote-up-btn','remote-open-btn','remote-refresh-btn']) if ($(id)) $(id).disabled = !active?.connected;
  const entries = activeContext ? selectedEntries(activeContext.side) : [];
  const one = entries.length === 1;
  for (const id of ['sftp-rename-btn','sftp-properties-btn','sftp-move-btn']) $(id).disabled = !entries.length || (id === 'sftp-rename-btn' || id === 'sftp-properties-btn') && !one;
  $('sftp-delete-btn').disabled = !entries.length;
  $('sftp-copy-path-btn').disabled = !entries.length;
  $('sftp-chmod-btn').disabled = !one || activeContext?.side !== 'remote';
  const badge = $('sftp-session-badge');
  if (badge) badge.textContent = active?.connected ? `${active.username}@${active.host}` : (currentLanguage === 'en' ? 'Connect SSH first' : '需连接 SSH');
  updateSelectionCount('local'); updateSelectionCount('remote'); renderTransferQueue();
}
function setSelection(side, entry, event, index, entries) {
  sftpDebug('selection.change', { side, path: entry.path, name: entry.name, index, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, before: [...(side === 'local' ? localSftpSelected : remoteSftpSelected)] });
  activeSftpSide = side;
  const selectedSet = side === 'local' ? localSftpSelected : remoteSftpSelected;
  const prevIndex = side === 'local' ? localLastSelectedIndex : remoteLastSelectedIndex;
  if (event.shiftKey && prevIndex >= 0) {
    if (!event.ctrlKey && !event.metaKey) selectedSet.clear();
    for (let i=Math.min(prevIndex,index); i<=Math.max(prevIndex,index); i++) selectedSet.add(entries[i].path);
  } else if (event.ctrlKey || event.metaKey) {
    if (selectedSet.has(entry.path)) selectedSet.delete(entry.path); else selectedSet.add(entry.path);
    if (side === 'local') localLastSelectedIndex=index; else remoteLastSelectedIndex=index;
  } else {
    selectedSet.clear(); selectedSet.add(entry.path);
    if (side === 'local') localLastSelectedIndex=index; else remoteLastSelectedIndex=index;
  }
  activeContext = { side, path: entry.path };
}
function refreshSelectionVisuals(side) {
  const root = $(`${side}-files`);
  const selected = side === 'local' ? localSftpSelected : remoteSftpSelected;
  // Update existing rows in-place. Rebuilding every row on each click was
  // needlessly expensive and could disrupt double-click event handling.
  for (const row of root.querySelectorAll('.file-row')) row.classList.toggle('selected', selected.has(row.title));
}
function externalDragPaths(side, entry) {
  const set = side === 'local' ? localSftpSelected : remoteSftpSelected;
  if (!set.has(entry.path)) { set.clear(); set.add(entry.path); }
  return selectedPaths(side);
}
function remoteDragKey(sessionId, paths) { return `${sessionId}\u0000${paths.join('\u0000')}`; }
function renderFileList(side, resetScroll = false) {
  const renderStartedAt = performance.now();
  const root = $(`${side}-files`); const entries = visibleEntries(side);
  const fragment = document.createDocumentFragment();
  if (!root.dataset.debugWired) {
    root.dataset.debugWired='1';
    for (const ev of ['pointerdown','mousedown','mouseup','click','contextmenu','dragenter','dragover','drop']) root.addEventListener(ev, e => { if (e.target===root || e.target.classList?.contains('file-list-spacer') || e.target.classList?.contains('file-list-empty')) sftpDebug('pane.'+ev,{side,target:e.target.className||e.target.id,button:e.button,buttons:e.buttons,clientX:e.clientX,clientY:e.clientY,types:Array.from(e.dataTransfer?.types||[]),selected:[...(side==='local'?localSftpSelected:remoteSftpSelected)]}); }, true);
    // Native-style marquee selection: start on blank space, drag a rectangle,
    // select every visible row intersecting it. Ctrl/Meta adds to selection.
    let marquee = null;
    let marqueeBox = null;
    root.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest?.('.file-row') || event.target.closest?.('button,input,select')) return;
      activeSftpSide = side;
      const set = side === 'local' ? localSftpSelected : remoteSftpSelected;
      const additive = event.ctrlKey || event.metaKey;
      marquee = { pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, additive, base:additive ? new Set(set) : new Set(), moved:false };
      if (!additive) set.clear();
      marqueeBox = document.createElement('div'); marqueeBox.className='sftp-selection-marquee'; document.body.appendChild(marqueeBox);
      try { root.setPointerCapture(event.pointerId); } catch {}
      sftpDebug('selection.marquee.start',{side,x:event.clientX,y:event.clientY,additive});
    });
    document.addEventListener('pointermove', event => {
      if (!marquee || marquee.pointerId !== event.pointerId) return;
      const left=Math.min(marquee.startX,event.clientX), top=Math.min(marquee.startY,event.clientY), right=Math.max(marquee.startX,event.clientX), bottom=Math.max(marquee.startY,event.clientY);
      if (Math.abs(right-left)+Math.abs(bottom-top)>4) marquee.moved=true;
      Object.assign(marqueeBox.style,{left:left+'px',top:top+'px',width:Math.max(1,right-left)+'px',height:Math.max(1,bottom-top)+'px'});
      const set=side==='local'?localSftpSelected:remoteSftpSelected;
      set.clear(); for(const path of marquee.base)set.add(path);
      for(const row of root.querySelectorAll('.file-row')){const r=row.getBoundingClientRect();const hit=r.right>=left&&r.left<=right&&r.bottom>=top&&r.top<=bottom;if(hit)set.add(row.title);row.classList.toggle('selected',set.has(row.title));}
    }, true);
    const finishMarquee = event => {
      if (!marquee || (event.pointerId != null && marquee.pointerId !== event.pointerId)) return;
      const didMove=marquee.moved; if(marqueeBox)marqueeBox.remove(); marqueeBox=null; marquee=null;
      if(didMove){root.dataset.suppressBlankClick='1';setTimeout(()=>delete root.dataset.suppressBlankClick,0);const set=side==='local'?localSftpSelected:remoteSftpSelected;activeContext={side,path:[...set][0]};sftpDebug('selection.marquee.complete',{side,selected:[...set]});updateSftpButtons();}
    };
    document.addEventListener('pointerup',finishMarquee,true); document.addEventListener('pointercancel',finishMarquee,true);
  }
  const previousScrollTop = root.scrollTop;
  const selected = side === 'local' ? localSftpSelected : remoteSftpSelected;
  if (!entries.length) {
    const empty = document.createElement('div'); empty.className = 'file-list-empty';
    empty.textContent = side === 'remote' && !activeSession()?.connected ? (currentLanguage === 'en' ? 'Connect SSH first' : '请先连接 SSH') : (currentLanguage === 'en' ? 'No matching items' : '没有匹配的文件');
    fragment.appendChild(empty);
  }
  for (const [index, entry] of entries.entries()) {
    const row = document.createElement('div');
    row.className = `file-row${selected.has(entry.path) ? ' selected' : ''}${entry.isDir ? ' directory' : ''}`;
    row.draggable = true; row.title = entry.path; row.tabIndex = -1;
    
    const icon = document.createElement('span'); icon.className='file-icon'; icon.textContent=entry.isDir?'📁':entry.isLink?'↗':'📄';
    const name = document.createElement('span'); name.className='file-name'; name.textContent=entry.name; name.title=entry.name;
    const size = document.createElement('span'); size.className='file-size'; size.textContent=entry.isDir?(currentLanguage==='en'?'Folder':'文件夹'):formatBytes(entry.size);
    const dragOut = document.createElement('button'); dragOut.className='file-drag-out'; dragOut.type='button'; dragOut.draggable=true; dragOut.textContent='↗';
    dragOut.title=currentLanguage==='en'?'Drag this handle to Windows Explorer; if this item is selected, all selected items are dragged. Row dragging transfers between SFTP panes.':'拖动此 ↗ 图标到资源管理器；若此项已选中，会一起拖出全部选中项。拖动文件行用于两个 SFTP 面板之间传输。';
    dragOut.setAttribute('aria-label', currentLanguage==='en' ? `Drag ${entry.name} to Windows Explorer` : `将 ${entry.name} 拖到 Windows 资源管理器`);
    dragOut.addEventListener('pointerdown', event => {
      if (event.button === 0) activeExternalDragGesture = { id: makeId(), side, path: entry.path, pointerId: event.pointerId, pressed: true, startedAt: Date.now(), dragStarted: false, nativeRequestSent: false };
      sftpDebug('external-drag.handle-pointerdown',{side,path:entry.path,pointerType:event.pointerType,button:event.button,gestureId:activeExternalDragGesture?.id||null});
    });
    dragOut.addEventListener('mousedown', () => { sftpDebug('external-drag.handle-mousedown',{side,path:entry.path,selected:[...selected]}); root.focus(); if (!selected.has(entry.path)) { selected.clear(); selected.add(entry.path); activeContext={side,path:entry.path}; root.querySelectorAll('.file-row').forEach(r=>r.classList.remove('selected')); row.classList.add('selected'); updateSftpButtons(); } });
    const prepareRemoteForDrag = async (pathsOverride = null) => {
      const s=activeSession(); if(side!=='remote'||!s?.connected)return null;
      const paths=Array.isArray(pathsOverride) ? [...pathsOverride] : externalDragPaths(side,entry); if(!paths.length)return null; const key=remoteDragKey(s.id,paths);
      if(remoteDragCache.has(key))return remoteDragCache.get(key);
      if(remoteDragPreparation.has(key))return remoteDragPreparation.get(key);
      $('transfer-status').textContent=currentLanguage==='en'?'Preparing remote item for drag…':'正在准备远程文件以供拖出…';
      sftpDebug('external-drag.prepare.begin',{sessionId:s.id,paths});
      const promise=window.pilot.prepareRemoteDrag(s.connectionId,paths).then(result=>{
        sftpDebug('external-drag.prepare.success',{sessionId:s.id,sourcePaths:paths,preparedPaths:result.paths});
        const prepared={paths:result.paths||[],sessionId:s.id,sourcePaths:[...paths],createdAt:Date.now()};
        remoteDragCache.set(key,prepared);
        $('transfer-status').textContent=currentLanguage==='en'?'Remote item is staged.':'远程项目已准备完成。';
        sftpDebug('external-drag.cache-ready',{sessionId:s.id,sourcePaths:paths,preparedPaths:prepared.paths,expiresInMs:10*60*1000});
        return prepared;
      }).catch(e=>{ sftpDebug('external-drag.prepare.error',{sessionId:s.id,paths,error:String(e?.stack||e)}); $('transfer-status').textContent=`${currentLanguage==='en'?'Preparing external drag failed':'准备外部拖放失败'}: ${e.message||e}`; throw e; }).finally(()=>remoteDragPreparation.delete(key));
      remoteDragPreparation.set(key,promise); return promise;
    };
    dragOut.addEventListener('mouseenter',()=>sftpDebug('external-drag.handle-hover',{side,path:entry.path,selected:[...selected],preparationStartsOnActualDrag:true}));
    dragOut.addEventListener('dragend',event=>sftpDebug('external-drag.handle-dragend',{side,path:entry.path,dropEffect:event.dataTransfer?.dropEffect,effectAllowed:event.dataTransfer?.effectAllowed}),{once:false});
    dragOut.addEventListener('dragstart', (event) => {
      const paths=externalDragPaths(side,entry);
      sftpDebug('external-drag.dragstart',{side,path:entry.path,types:Array.from(event.dataTransfer?.types||[]),selected:[...selected],paths,closestDragHandle:true,gestureId:activeExternalDragGesture?.id||null});
      if (activeExternalDragGesture && activeExternalDragGesture.side === side && activeExternalDragGesture.path === entry.path) activeExternalDragGesture.dragStarted = true;
      event.stopPropagation();
      if(side==='local'){
        if (!paths.length) { event.preventDefault(); $('transfer-status').textContent=currentLanguage==='en'?'Select a local file or folder first':'请先选择本地文件或文件夹'; return; }
        $('transfer-status').textContent=currentLanguage==='en'?'Starting Windows file drag…':'正在启动 Windows 文件拖放…';
        sftpDebug('external-drag.native-request',{side,paths});
        // Electron's documented native file drag flow cancels the browser's
        // empty HTML drag first, then asks the main process to start OS drag.
        // Leaving the HTML drag active conflicts with webContents.startDrag on
        // Windows and can make the drag disappear or crash the app.
        event.preventDefault();
        sftpDebug('external-drag.html-drag-cancelled-for-native',{side,paths});
        window.pilot.startNativeDrag(paths);
        return;
      }
      const s=activeSession();if(!s?.connected){event.preventDefault();$('transfer-status').textContent=currentLanguage==='en'?'Connect SSH first':'请先连接 SSH';return;}
      const key=remoteDragKey(s.id,paths);
      let prepared=remoteDragCache.get(key);
      // main.js removes staged files after 10 minutes; don't keep a stale cache entry.
      if(prepared && Date.now() - Number(prepared.createdAt || 0) >= 9 * 60 * 1000){
        sftpDebug('external-drag.cache-expired',{sessionId:s.id,sourcePaths:prepared.sourcePaths,preparedPaths:prepared.paths});
        remoteDragCache.delete(key); prepared=null;
      }
      if(!prepared?.paths?.length){
        // Remote files must exist locally before Explorer can accept them. Start
        // staging only after an actual drag gesture, cancel Chromium's empty drag,
        // then launch the OS drag automatically if the user is still holding the
        // same gesture when staging finishes. This removes the old two-gesture
        // 'prepare, then drag again' flow for normal cases.
        event.preventDefault();
        const gesture = activeExternalDragGesture && activeExternalDragGesture.side === side && activeExternalDragGesture.path === entry.path
          ? activeExternalDragGesture : null;
        if (gesture) gesture.dragStarted = true;
        $('transfer-status').textContent=currentLanguage==='en'?'Preparing remote item — keep holding the mouse button; the system drag will start when ready.':'正在准备远程项目，请保持按住鼠标；准备完成后会自动启动系统拖放。';
        sftpDebug('external-drag.prepare-during-gesture',{sessionId:s.id,paths,gestureId:gesture?.id||null,gesturePressed:!!gesture?.pressed});
        void prepareRemoteForDrag(paths).then(staged => {
          if (!staged?.paths?.length) return;
          if (gesture && activeExternalDragGesture === gesture && gesture.pressed && gesture.dragStarted && !gesture.nativeRequestSent) {
            gesture.nativeRequestSent = true;
            $('transfer-status').textContent=currentLanguage==='en'?'Remote item ready — starting system drag now.':'远程项目准备完成，正在启动系统拖放。';
            sftpDebug('external-drag.auto-native-request-after-prepare',{sessionId:s.id,gestureId:gesture.id,sourcePaths:paths,preparedPaths:staged.paths,heldForMs:Date.now()-(gesture.startedAt||Date.now())});
            sftpDebug('external-drag.html-drag-cancelled-for-native',{side,paths:staged.paths,sourcePaths:paths,delayedUntilPrepared:true});
            sftpDebug('external-drag.native-request',{side,paths:staged.paths,sourcePaths:paths,gestureId:gesture.id,delayedUntilPrepared:true});
            window.pilot.startNativeDrag(staged.paths);
          } else {
            sftpDebug('external-drag.prepared-after-gesture-ended',{sessionId:s.id,gestureId:gesture?.id||null,gesturePressed:!!gesture?.pressed,sourcePaths:paths,preparedPaths:staged.paths});
            $('transfer-status').textContent=currentLanguage==='en'?'Remote item is ready. The drag was released before staging finished; drag the ↗ handle again.':'远程项目已准备好，但你在准备完成前松开了鼠标；再拖动一次 ↗ 图标即可立即开始。';
          }
        }).catch(()=>{});
        return;
      }
      $('transfer-status').textContent=currentLanguage==='en'?'Starting Windows file drag…':'正在启动 Windows 文件拖放…';
      // The actual Explorer drag is started in the main process. Cancel the
      // renderer's empty HTML drag before sending IPC; Electron's official
      // Native File Drag & Drop example requires this preventDefault() call.
      event.preventDefault();
      sftpDebug('external-drag.html-drag-cancelled-for-native',{side,paths:prepared.paths,sourcePaths:prepared.sourcePaths});
      sftpDebug('external-drag.native-request',{side,paths:prepared.paths,sourcePaths:prepared.sourcePaths});
      window.pilot.startNativeDrag(prepared.paths);
      // Do not clean staged files from renderer dragend: that event belongs to
      // the cancelled HTML drag and may run before Explorer consumes the native
      // drag. The main process schedules cleanup after native startDrag returns.
    });
    row.append(icon,name,size,dragOut);
    row.addEventListener('click', (event) => {
      root.focus(); setSelection(side, entry, event, index, entries); refreshSelectionVisuals(side); updateSftpButtons();
    });
    row.addEventListener('dblclick', async () => { sftpDebug('file.double-click',{side,path:entry.path,name:entry.name,isDir:!!entry.isDir}); if(entry.isDir) { if(side==='local') await loadLocalDirectory(entry.path); else await loadRemoteDirectory(entry.path); } });
    row.addEventListener('contextmenu', (event) => {
      sftpDebug('file.contextmenu',{side,path:entry.path,name:entry.name,x:event.clientX,y:event.clientY,selected:[...selected]}); event.preventDefault();
      if (!selected.has(entry.path)) { (side==='local'?localSftpSelected:remoteSftpSelected).clear(); (side==='local'?localSftpSelected:remoteSftpSelected).add(entry.path); refreshSelectionVisuals(side); updateSftpButtons(); }
      activeContext={side,path:entry.path};
      showSftpContextMenu(side, event.clientX, event.clientY);
    });
    row.addEventListener('dragstart', (event) => {
      if (event.target === dragOut || dragOut.contains(event.target)) return;
      const set = side === 'local' ? localSftpSelected : remoteSftpSelected;
      if (!set.has(entry.path)) { set.clear(); set.add(entry.path); }
      const paths = selectedPaths(side);
      const payload = { side, paths, sourcePane: `${side}-files`, sourcePath: side === 'local' ? localSftpPath : remoteSftpPath, sessionId: activeSession()?.id || null, ts: Date.now() };
      sftpDebug('internal-drag.dragstart', { ...payload, typesBefore: Array.from(event.dataTransfer?.types || []), entry: { name: entry.name, path: entry.path, isDir: !!entry.isDir } });
      // IMPORTANT: rows always use the in-app payload. Native Windows drag is only
      // initiated by the dedicated ↗ handle; mixing both protocols broke pane-to-pane drops.
      try {
        event.dataTransfer.setData('application/x-n1pilot-sftp', JSON.stringify(payload));
        event.dataTransfer.setData('text/plain', JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copyMove';
        sftpDebug('internal-drag.payload-set', { side, paths, typesAfter: Array.from(event.dataTransfer.types || []), effectAllowed: event.dataTransfer.effectAllowed });
      } catch (error) { sftpDebug('internal-drag.payload-error', { side, paths, error: String(error?.stack || error) }); }
    });
    row.addEventListener('dragend', event => sftpDebug('internal-drag.dragend', { side, path: entry.path, dropEffect: event.dataTransfer?.dropEffect, effectAllowed: event.dataTransfer?.effectAllowed }));
    fragment.appendChild(row);
  }
  root.replaceChildren(fragment);
  // Keep a real, clickable tail after the last visible item so users can clear selection
  // and open the background context menu even at the very bottom of a long directory.
  const spacer = document.createElement('div');
  spacer.className = 'file-list-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  root.appendChild(spacer);
  root.scrollTop = resetScroll ? 0 : previousScrollTop;
  sftpDebug('file-list.rendered',{side,path:activePath(side),count:entries.length,selectedCount:selected.size,renderDurationMs:Math.round((performance.now()-renderStartedAt)*10)/10,sampleNames:entries.slice(0,20).map(e=>e.name)});
  updateSelectionCount(side);
}
async function loadLocalDirectory(rawPath, recordNavigation = true) {
  const target=String(rawPath||localSftpPath||'').trim(); if(!target) return;
  sftpDebug('directory.local.open.begin',{target,recordNavigation,previous:localSftpPath});
  try { const result=await window.pilot.listLocal(target); sftpDebug('directory.local.open.success',{requested:target,resolved:result.path,parent:result.parent,count:(result.entries||[]).length,sampleNames:(result.entries||[]).slice(0,30).map(e=>e.name)}); const previous=localSftpPath; if(recordNavigation&&previous&&previous!==result.path){const h=sftpDirectoryHistory.local;h.back.push(previous);if(h.back.length>100)h.back.shift();h.forward=[];} localSftpPath=result.path; localSftpParent=result.parent||result.path; localSftpEntries=result.entries||[]; $('local-path').value=localSftpPath; localSftpSelected.clear(); localLastSelectedIndex=-1; activeContext={side:'local'}; renderFileList('local', true); updateSftpButtons(); }
  catch(e){ sftpDebug('directory.local.open.error',{target,error:String(e?.stack||e)}); $('transfer-status').textContent=`${currentLanguage==='en'?'Cannot read local directory':'读取本地目录失败'}: ${e.message||e}`; }
}
async function loadRemoteDirectory(rawPath, recordNavigation = true) {
  const session=activeSession(); if(!session?.connected){ $('transfer-status').textContent=currentLanguage==='en'?'Connect SSH before browsing remote files':'请先连接 SSH，再浏览远程目录。'; return; }
  const target=String(rawPath||remoteSftpPath||'/tmp').trim()||'/';
  const requestId = ++remoteDirectoryOpenRequestId;
  const startedAt = performance.now();
  sftpDebug('directory.remote.open.begin',{requestId,sessionId:session.id,connectionId:session.connectionId,target,recordNavigation,previous:remoteSftpPath});
  try {
    const result=await window.pilot.listRemote(session.connectionId,target);
    const requestElapsedMs = Math.round((performance.now()-startedAt)*10)/10;
    if (requestId !== remoteDirectoryOpenRequestId) {
      sftpDebug('directory.remote.open.stale-result',{requestId,latestRequestId:remoteDirectoryOpenRequestId,sessionId:session.id,target,resolved:result.path,requestElapsedMs,count:(result.entries||[]).length});
      return;
    }
    sftpDebug('directory.remote.open.success',{requestId,sessionId:session.id,requested:target,resolved:result.path,count:(result.entries||[]).length,symlinkCount:(result.entries||[]).filter(e=>e.isLink).length,requestElapsedMs,sampleNames:(result.entries||[]).slice(0,30).map(e=>e.name)});
    const previous=remoteSftpPath;
    if(recordNavigation&&previous&&previous!==result.path){const h=sftpDirectoryHistory.remote;h.back.push(previous);if(h.back.length>100)h.back.shift();h.forward=[];}
    remoteSftpPath=result.path; remoteSftpEntries=result.entries||[]; $('remote-path').value=remoteSftpPath; remoteSftpSelected.clear(); remoteLastSelectedIndex=-1; activeContext={side:'remote'};
    const renderStartedAt=performance.now(); renderFileList('remote', true); const renderElapsedMs=Math.round((performance.now()-renderStartedAt)*10)/10;
    $('transfer-status').textContent=`${currentLanguage==='en'?'Remote directory':'远程目录'}: ${remoteSftpPath} · ${remoteSftpEntries.length}`; updateSftpButtons();
    sftpDebug('directory.remote.open.complete',{requestId,sessionId:session.id,target,resolved:remoteSftpPath,entries:remoteSftpEntries.length,requestElapsedMs,renderElapsedMs,totalElapsedMs:Math.round((performance.now()-startedAt)*10)/10});
  }
  catch(e){
    if (requestId !== remoteDirectoryOpenRequestId) { sftpDebug('directory.remote.open.stale-error',{requestId,latestRequestId:remoteDirectoryOpenRequestId,sessionId:session.id,target,error:String(e?.message||e)}); return; }
    sftpDebug('directory.remote.open.error',{requestId,sessionId:session.id,target,elapsedMs:Math.round((performance.now()-startedAt)*10)/10,error:String(e?.stack||e)});
    $('transfer-status').textContent=`${currentLanguage==='en'?'Cannot read remote directory':'读取远程目录失败'}: ${e.message||e}`;
  }
}
async function navigateSftpHistory(side, direction) {
  const history = sftpDirectoryHistory[side];
  const source = direction === 'back' ? history.back : history.forward;
  const destination = direction === 'back' ? history.forward : history.back;
  if (!source.length) return;
  const current = activePath(side);
  const target = source[source.length - 1];
  if (!target || target === current) { source.pop(); return; }
  if (side === 'local') await loadLocalDirectory(target, false);
  else await loadRemoteDirectory(target, false);
  if (activePath(side) === target) {
    source.pop();
    if (current && current !== target) { destination.push(current); if (destination.length > 100) destination.shift(); }
  }
}
function wireSftpBlankArea(side) {
  const root = $(`${side}-files`);
  const clearSelection = () => {
    (side === 'local' ? localSftpSelected : remoteSftpSelected).clear();
    if (side === 'local') localLastSelectedIndex = -1; else remoteLastSelectedIndex = -1;
    activeSftpSide = side; activeContext = { side };
    renderFileList(side); updateSftpButtons();
  };
  root.addEventListener('pointerenter', () => { activeSftpSide = side; });
  root.addEventListener('mousedown', () => { activeSftpSide = side; });
  root.addEventListener('click', event => {
    if (root.dataset.suppressBlankClick) { delete root.dataset.suppressBlankClick; return; }
    if (!event.target.closest?.('.file-row')) clearSelection();
  });
  root.addEventListener('contextmenu', event => {
    if (event.target.closest?.('.file-row')) return;
    event.preventDefault(); clearSelection(); showSftpContextMenu(side, event.clientX, event.clientY);
  });
}
function handleSftpMouseNavigation(event) {
  if (![3, 4].includes(event.button) || $('sftp-body')?.classList.contains('hidden')) return;
  const location = event.target?.closest?.('.sftp-location');
  if (!location) return;
  event.preventDefault(); event.stopPropagation();
  const now = Date.now();
  if (now - lastMouseNavigationAt < 250) return;
  lastMouseNavigationAt = now;
  const side = location.querySelector('#local-files') ? 'local' : 'remote';
  activeSftpSide = side;
  void navigateSftpHistory(side, event.button === 3 ? 'back' : 'forward').catch(error => {
    $('transfer-status').textContent = `${currentLanguage === 'en' ? 'Directory navigation failed' : '目录导航失败'}: ${error.message || error}`;
  });
}
function transferName(itemPath) { return itemPath.split(/[\\/]/).filter(Boolean).pop() || itemPath; }
function renderTransferQueue() {
  const root=$('transfer-queue-list'); if(!root) return;
  const items=[...transferTasks.values()]; root.replaceChildren();
  const live=items.filter(t=>t.status==='running'||t.status==='queued'); const failed=items.filter(t=>t.status==='failed');
  $('queue-summary-text').textContent=currentLanguage==='en'?`${live.length} active · ${failed.length} failed`:`${live.length} 个进行中 · ${failed.length} 个失败`;
  const total=live.reduce((sum,t)=>sum+(t.total||0),0); const done=live.reduce((sum,t)=>sum+(t.transferred||0),0);
  $('queue-total-progress').value=total?Math.min(100,Math.round(done/total*100)):0;
  if(!items.length){ const empty=document.createElement('div'); empty.className='queue-empty'; empty.textContent=currentLanguage==='en'?'No active or failed transfers':'没有进行中的传输或失败任务'; root.appendChild(empty); return; }
  for(const task of items){
    const row=document.createElement('div'); row.className=`queue-row ${task.status==='failed'?'failed':''}`;
    const name=document.createElement('div'); name.className='queue-name'; name.textContent=transferName(task.currentFile||task.sourcePath); name.title=task.currentFile&&task.currentFile!==task.sourcePath?`${task.sourcePath}\n${task.currentFile}`:task.sourcePath;
    const direction=document.createElement('span'); direction.className='queue-direction'; direction.textContent=task.direction==='upload'?(currentLanguage==='en'?'Upload ↑':'上传 ↑'):(currentLanguage==='en'?'Download ↓':'下载 ↓');
    const progress=document.createElement('progress'); progress.className='queue-item-progress'; progress.max=100; progress.value=task.total?Math.min(100,Math.floor((task.transferred||0)/task.total*100)):(task.status==='queued'?0:task.status==='failed'?0:10);
    const percent=document.createElement('span'); percent.className='queue-percent'; percent.textContent=task.total?`${Math.floor((task.transferred||0)/task.total*100)}%`:task.status==='failed'?'—':'…';
    const status=document.createElement('span'); status.className='queue-status'; status.textContent=task.status==='failed'?(currentLanguage==='en'?'Failed':'失败'):task.status==='queued'?(currentLanguage==='en'?'Queued':'排队中'):(currentLanguage==='en'?'Transferring':'传输中'); status.title=task.error||'';
    const actions=document.createElement('div'); actions.className='queue-actions';
    if(task.status==='failed'){ const retry=document.createElement('button'); retry.className='btn tiny primary'; retry.textContent=currentLanguage==='en'?'Retry':'重试'; retry.addEventListener('click',()=>retryTransfer(task.id)); actions.appendChild(retry); }
    if(task.status==='failed' || task.status==='queued'){ const clear=document.createElement('button'); clear.className='btn tiny ghost'; clear.textContent='×'; clear.title=currentLanguage==='en'?'Remove task':'移除此任务'; clear.addEventListener('click',()=>{ if(task.status==='failed' || task.status==='queued') transferTasks.delete(task.id); renderTransferQueue(); }); actions.appendChild(clear); }
    row.append(name,direction,progress,percent,status,actions); root.appendChild(row);
    if(task.status==='failed' && task.error){ const error=document.createElement('div'); error.className='queue-error'; error.textContent=task.error; root.appendChild(error); }
  }
}
async function runTransferQueue() {
  if(transferQueueRunning) return; transferQueueRunning=true;
  try {
    while(true){
      const task=[...transferTasks.values()].find(t=>t.status==='queued'); if(!task) break;
      task.status='running'; task.error=''; task.transferred=0; task.total=0;
      // Queued transfers belong to the SSH tab, not to one transient connection ID.
      const ownerTab = task.tabId ? sshSessions.get(task.tabId) : null;
      if (task.tabId && ownerTab?.connected && ownerTab.connectionId) task.sessionId = ownerTab.connectionId;
      sftpDebug('transfer.start',{id:task.id,direction:task.direction,sourcePath:task.sourcePath,targetDir:task.targetDir,sessionId:task.sessionId,tabId:task.tabId||null,overwrite:task.overwrite}); renderTransferQueue();
      try {
        if (task.tabId && !sshSessions.has(task.tabId)) throw new Error(currentLanguage==='en'?'The SSH tab for this transfer has been closed.':'此传输任务所属的 SSH 标签页已关闭。');
        const currentOwner = task.tabId ? sshSessions.get(task.tabId) : null;
        if (task.tabId && (!currentOwner?.connected || !currentOwner.connectionId)) throw new Error(currentLanguage==='en'?'The SSH tab for this transfer is disconnected.':'此传输任务所属的 SSH 标签页当前未连接。');
        let result;
        if(task.direction==='upload'){
          try { result=await window.pilot.uploadFiles(task.sessionId,[task.sourcePath],task.targetDir,task.overwrite===true,task.id); }
          catch(e){ if(!task.overwrite && /已存在同名文件|已存在同名文件或目录/.test(e.message||'') && window.confirm(`${e.message}\n\n${currentLanguage==='en'?'Overwrite the existing remote item?':'确认覆盖远程同名文件或目录吗？'}`)){ task.overwrite=true; task.status='running'; result=await window.pilot.uploadFiles(task.sessionId,[task.sourcePath],task.targetDir,true,task.id); } else throw e; }
        } else result=await window.pilot.downloadFiles(task.sessionId,[task.sourcePath],task.targetDir,task.id);
        sftpDebug('transfer.success',{id:task.id,direction:task.direction,sourcePath:task.sourcePath,targetDir:task.targetDir,result}); transferTasks.delete(task.id);
        $('transfer-status').textContent=result.message || (currentLanguage==='en'?'Transfer completed':'传输完成');
        if(task.direction==='upload') await loadRemoteDirectory(task.targetDir); else await loadLocalDirectory(task.targetDir);
      } catch(e) {
        task.status='failed'; task.error=String(e.message||e); sftpDebug('transfer.failure',{id:task.id,direction:task.direction,sourcePath:task.sourcePath,targetDir:task.targetDir,error:String(e?.stack||e)}); $('transfer-status').textContent=`${currentLanguage==='en'?'Transfer failed':'传输失败'}: ${task.error}`;
      }
      renderTransferQueue(); updateSftpButtons();
    }
  } finally { transferQueueRunning=false; sftpBusy=[...transferTasks.values()].some(t=>t.status==='running'||t.status==='queued'); updateSftpButtons(); }
}
function enqueueTransfers(direction, paths) {
  sftpDebug('transfer.enqueue',{direction,paths,targetLocal:localSftpPath,targetRemote:remoteSftpPath,sessionId:activeSession()?.id||null});
  const session=activeSession(); if((direction==='upload'||direction==='download') && !session?.connected){ $('transfer-status').textContent=currentLanguage==='en'?'Connect SSH first':'请先连接 SSH。'; return; }
  const items=[...new Set((paths||[]).filter(Boolean))]; if(!items.length) return;
  const targetDir=direction==='upload'?(remoteSftpPath||'/tmp'):(localSftpPath||'');
  for(const sourcePath of items){ const id=makeId(); transferTasks.set(id,{id,tabId:session.id,sessionId:session.connectionId,direction,sourcePath,targetDir,status:'queued',transferred:0,total:0,overwrite:false,error:''}); }
  sftpBusy=true; renderTransferQueue(); void runTransferQueue();
}
function uploadLocalPaths(paths) { enqueueTransfers('upload',paths); }
function downloadRemotePaths(paths) { enqueueTransfers('download',paths); }
function retryTransfer(id){ sftpDebug('transfer.retry-one',{id}); const t=transferTasks.get(id); if(!t||t.status!=='failed') return; t.status='queued'; t.transferred=0; t.total=0; t.error=''; void runTransferQueue(); renderTransferQueue(); }
function retryAllFailed(){ sftpDebug('transfer.retry-all-failed',{ids:[...transferTasks.values()].filter(t=>t.status==='failed').map(t=>t.id)}); for(const t of transferTasks.values()) if(t.status==='failed'){t.status='queued';t.transferred=0;t.total=0;t.error='';} void runTransferQueue(); renderTransferQueue(); }
function wireSftpDrop(rootId,targetSide){
  const root=$(rootId);
  root.addEventListener('dragenter',event=>{const types=Array.from(event.dataTransfer?.types||[]);sftpDebug('drop.dragenter',{targetSide,rootId,types,relatedTarget:event.relatedTarget?.className||event.relatedTarget?.id||null});if(types.includes('application/x-n1pilot-sftp')||types.includes('Files')){event.preventDefault();root.classList.add('drop-target');}});
  root.addEventListener('dragover',event=>{ const types=Array.from(event.dataTransfer?.types||[]); const internal=types.includes('application/x-n1pilot-sftp'); const files=types.includes('Files'); const key=`${targetSide}|${types.join(',')}`; if(shouldSampleDragOver(dropDragOverLogTimes,key,350))sftpDebug('drop.dragover.sample',{targetSide,rootId,types,internal,files,dropEffect:event.dataTransfer?.dropEffect}); if(internal||files){event.preventDefault();event.dataTransfer.dropEffect='copy';root.classList.add('drop-target');} });
  root.addEventListener('dragleave',event=>{sftpDebug('drop.dragleave',{targetSide,rootId,relatedTarget:event.relatedTarget?.className||event.relatedTarget?.id||null});if(!root.contains(event.relatedTarget))root.classList.remove('drop-target');});
  root.addEventListener('drop',async event=>{
    const types=Array.from(event.dataTransfer?.types||[]); let text=''; try{text=event.dataTransfer.getData('application/x-n1pilot-sftp')||event.dataTransfer.getData('text/plain');}catch{}
    let payload=null;try{payload=JSON.parse(text);}catch{}
    const dropped = droppedFileDetails(event.dataTransfer?.files || []);
    sftpDebug('drop.drop',{targetSide,rootId,types,payload,files:dropped,localSftpPath,remoteSftpPath,activeSessionId});
    event.preventDefault();root.classList.remove('drop-target');
    if(payload?.side&&Array.isArray(payload.paths)){
      if(payload.side===targetSide){sftpDebug('drop.ignored-same-pane',{targetSide,payload});return;}
      if(targetSide==='remote'&&payload.side==='local') { sftpDebug('drop.action.upload',{paths:payload.paths,target:remoteSftpPath}); await uploadLocalPaths(payload.paths); }
      else if(targetSide==='local'&&payload.side==='remote') { sftpDebug('drop.action.download',{paths:payload.paths,target:localSftpPath}); await downloadRemotePaths(payload.paths); }
      else sftpDebug('drop.action.unsupported-direction',{targetSide,payload});
      return;
    }
    if(event.dataTransfer.files?.length){ const paths=dropped.map(f=>f.path).filter(Boolean); sftpDebug('drop.external-files',{targetSide,paths,fileDetails:dropped}); if(!paths.length){sftpDebug('drop.external-no-paths',{targetSide,fileDetails:dropped});$('transfer-status').textContent=currentLanguage==='en'?'Could not resolve the dropped file path. Check the DEBUG log.':'无法获取拖入文件的实际路径，请查看 DEBUG 日志。';return;}
      if(targetSide==='remote'){sftpDebug('drop.action.external-upload',{paths,target:remoteSftpPath});await uploadLocalPaths(paths);}
      else { try { const result=await window.pilot.copyLocalFiles(paths,localSftpPath); sftpDebug('drop.action.local-copy-success',{paths,target:localSftpPath,result}); await loadLocalDirectory(localSftpPath); $('transfer-status').textContent=currentLanguage==='en'?`Copied ${result.copied.length} item(s) locally`:`已复制 ${result.copied.length} 项到本地目录`; } catch(e){sftpDebug('drop.action.local-copy-error',{paths,target:localSftpPath,error:String(e?.stack||e)}); $('transfer-status').textContent=`${currentLanguage==='en'?'Local copy failed':'本地复制失败'}: ${e.message||e}`; } }
    } else sftpDebug('drop.no-recognized-payload',{targetSide,types,text});
  });
}
function openTextDialog(title,description,value=''){
  return new Promise(resolve=>{const d=$('text-entry-dialog'),input=$('text-entry-value');$('text-entry-title').textContent=title;$('text-entry-description').textContent=description;input.value=value;const done=()=>{d.removeEventListener('close',closed);resolve(d.returnValue==='confirm'?input.value.trim():null);};const closed=()=>done();d.addEventListener('close',closed,{once:true});d.showModal();input.focus();input.select();});
}
function recentMoveKey(side){return `n1pilot.recentMove.${side}`;}
function getRecentMoves(side){try{return JSON.parse(localStorage.getItem(recentMoveKey(side))||'[]').filter(x=>typeof x==='string');}catch{return [];}}
function addRecentMove(side,target){const list=[target,...getRecentMoves(side).filter(x=>x!==target)].slice(0,12);localStorage.setItem(recentMoveKey(side),JSON.stringify(list));}
function renderMoveHistory(side){
  const root=$('move-history-list'), data=getRecentMoves(side); root.replaceChildren(); $('move-target-options').replaceChildren();
  for(const item of data){ const option=document.createElement('option');option.value=item;$('move-target-options').appendChild(option); const row=document.createElement('div');row.className='move-history-row';const use=document.createElement('button');use.type='button';use.className='move-history-use';use.textContent=item;use.title=item;use.addEventListener('click',()=>{$('move-target-input').value=item;});const remove=document.createElement('button');remove.type='button';remove.className='move-history-remove';remove.textContent='×';remove.title=currentLanguage==='en'?'Remove this history item':'删除这条历史';remove.addEventListener('click',()=>{localStorage.setItem(recentMoveKey(side),JSON.stringify(getRecentMoves(side).filter(x=>x!==item)));renderMoveHistory(side);});row.append(use,remove);root.appendChild(row); }
}
async function moveSelection(){
  if(!activeContext)return; moveDialogSide=activeContext.side; moveDialogPaths=selectedPaths(moveDialogSide);if(!moveDialogPaths.length)return;
  const side=moveDialogSide; const d=$('move-dialog');$('move-dialog-title').textContent=currentLanguage==='en'?'Move to':'移动到';$('move-dialog-description').textContent=currentLanguage==='en'?(side==='local'?'Move selected local items to this folder':'Move selected remote items to this folder'):(side==='local'?'将选中的本地项目移动到目标文件夹':'将选中的远程项目移动到目标文件夹');
  $('move-target-input').value='';renderMoveHistory(side);d.showModal();
  const result=await new Promise(resolve=>{const onClose=()=>{d.removeEventListener('close',onClose);resolve(d.returnValue==='confirm'?$('move-target-input').value.trim():null);};d.addEventListener('close',onClose,{once:true});});
  if(!result)return;
  try{if(side==='local'){for(const source of moveDialogPaths)await window.pilot.moveLocal(source,result);await loadLocalDirectory(localSftpPath);}else{const s=activeSession();for(const source of moveDialogPaths)await window.pilot.moveRemote(s.connectionId,source,result);await loadRemoteDirectory(remoteSftpPath);}addRecentMove(side,result);$('transfer-status').textContent=currentLanguage==='en'?'Move completed':'移动完成';}
  catch(e){$('transfer-status').textContent=`${currentLanguage==='en'?'Move failed':'移动失败'}: ${e.message||e}`;}
}
async function actionNewFolder(side){const name=await openTextDialog(currentLanguage==='en'?'New folder':'新建文件夹',currentLanguage==='en'?'Folder name':'请输入文件夹名称');if(!name)return;try{if(side==='local')await window.pilot.mkdirLocal(localSftpPath,name);else{const s=activeSession();await window.pilot.mkdirRemote(s.connectionId,remoteSftpPath,name);}if(side==='local')await loadLocalDirectory(localSftpPath);else await loadRemoteDirectory(remoteSftpPath);}catch(e){$('transfer-status').textContent=`${currentLanguage==='en'?'Create folder failed':'新建文件夹失败'}: ${e.message||e}`;}}
async function actionRename(){if(!activeContext)return;const side=activeContext.side;const entry=selectedEntries(side)[0];if(!entry)return;const name=await openTextDialog(currentLanguage==='en'?'Rename':'重命名',currentLanguage==='en'?'Enter a new name':'请输入新名称',entry.name);if(!name||name===entry.name)return;try{if(side==='local')await window.pilot.renameLocal(entry.path,name);else await window.pilot.renameRemote(activeSession().connectionId,entry.path,name);if(side==='local')await loadLocalDirectory(localSftpPath);else await loadRemoteDirectory(remoteSftpPath);}catch(e){$('transfer-status').textContent=`${currentLanguage==='en'?'Rename failed':'重命名失败'}: ${e.message||e}`;}}
async function actionDelete(){if(!activeContext)return;const side=activeContext.side, paths=selectedPaths(side);if(!paths.length)return;const msg=currentLanguage==='en'?`Permanently delete ${paths.length} selected item(s)? This cannot be undone.`:`确定永久删除选中的 ${paths.length} 项吗？此操作无法撤销。`;if(!window.confirm(msg))return;try{if(side==='local')await window.pilot.deleteLocal(paths);else await window.pilot.deleteRemote(activeSession().connectionId,paths);if(side==='local')await loadLocalDirectory(localSftpPath);else await loadRemoteDirectory(remoteSftpPath);}catch(e){$('transfer-status').textContent=`${currentLanguage==='en'?'Delete failed':'删除失败'}: ${e.message||e}`;}}
function formatRemoteTimestamp(seconds) {
  if (!seconds) return currentLanguage === 'en' ? 'Not Available' : '不可用';
  try { return new Date(Number(seconds) * 1000).toLocaleString(currentLanguage === 'en' ? 'en-US' : 'zh-CN'); }
  catch { return currentLanguage === 'en' ? 'Not Available' : '不可用'; }
}
function getRemoteTypeLabel(entry) {
  if (entry.isDir) return currentLanguage === 'en' ? 'File folder' : '文件夹';
  const ext = (entry.name.match(/\.([^.]+)$/)?.[1] || '').toUpperCase();
  if (!ext) return currentLanguage === 'en' ? 'File' : '文件';
  return currentLanguage === 'en' ? `${ext} File` : `${ext} 文件`;
}
function selectedRemoteMode() {
  const groupValue = (who) => {
    let value = 0;
    for (const box of document.querySelectorAll(`input[data-who="${who}"]`)) if (box.checked) value |= Number(box.dataset.bit);
    return value;
  };
  return `${groupValue('owner')}${groupValue('group')}${groupValue('other')}`;
}
function updateRemoteModeFromMatrix() {
  const input = $('remote-property-mode');
  if (!input) return;
  const mode = selectedRemoteMode();
  input.value = remotePropsSpecialBits && remotePropsSpecialBits !== '0' ? `${remotePropsSpecialBits}${mode}` : mode;
}
function updateRemoteMatrixFromMode(raw, { preserveRaw = false } = {}) {
  const value = String(raw || '').trim();
  if (!/^[0-7]{3,4}$/.test(value)) return false;
  remotePropsSpecialBits = value.length === 4 ? value[0] : '0';
  const bits = value.slice(-3);
  const whos = ['owner', 'group', 'other'];
  whos.forEach((who, i) => {
    const digit = Number(bits[i]);
    for (const box of document.querySelectorAll(`input[data-who="${who}"]`)) box.checked = (digit & Number(box.dataset.bit)) !== 0;
  });
  if (!preserveRaw) $('remote-property-mode').value = value;
  return true;
}
function setRemotePropertiesTab(tab) {
  const general = tab === 'general';
  $('remote-tab-general').classList.toggle('active', general);
  $('remote-tab-permissions').classList.toggle('active', !general);
  $('remote-tab-general').setAttribute('aria-selected', general ? 'true' : 'false');
  $('remote-tab-permissions').setAttribute('aria-selected', general ? 'false' : 'true');
  $('remote-props-general').classList.toggle('hidden', !general);
  $('remote-props-permissions').classList.toggle('hidden', general);
}
function settleRemoteProperties(result) {
  const dialog = $('remote-properties-dialog');
  if (dialog.open) dialog.close();
  const resolve = remotePropsResolve; remotePropsResolve = null;
  if (resolve) resolve(result);
}
function refreshRemotePropertiesDialogLanguage() {
  if (!remotePropsCurrentEntry || !remotePropsCurrentData) return;
  const entry = remotePropsCurrentEntry, props = remotePropsCurrentData;
  $('remote-properties-title').textContent = `${entry.name} ${currentLanguage === 'en' ? 'Properties' : '属性'}`;
  $('remote-property-type').textContent = getRemoteTypeLabel(entry);
  $('remote-property-size').textContent = Number(props.size || 0).toLocaleString(currentLanguage === 'en' ? 'en-US' : 'zh-CN');
  $('remote-property-created').textContent = currentLanguage === 'en' ? 'Not Available' : '不可用';
  $('remote-property-modified').textContent = formatRemoteTimestamp(props.mtime ? props.mtime : 0);
  $('remote-property-accessed').textContent = formatRemoteTimestamp(props.atime ? props.atime : 0);
}
function openRemotePropertiesDialog(entry, props, initialTab = 'general') {
  remotePropsOwnerTouched = false; remotePropsGroupTouched = false;
  remotePropsCurrentEntry = entry;
  remotePropsCurrentData = props;
  $('remote-property-name').value = entry.name;
  $('remote-property-location').textContent = props.path === '/' ? '/' : props.path.slice(0, props.path.lastIndexOf('/')) || '/';
  $('remote-property-uid').value = props.uid == null ? '0' : String(props.uid);
  $('remote-property-gid').value = props.gid == null ? '0' : String(props.gid);
  refreshRemotePropertiesDialogLanguage();
  const mode = String(props.permissions || '644').replace(/^0(?=\d{3}$)/, '');
  $('remote-property-mode').value = mode;
  updateRemoteMatrixFromMode(mode, { preserveRaw: true });
  setRemotePropertiesTab(initialTab);
  $('remote-properties-dialog').showModal();
  if (initialTab === 'permissions') { $('remote-property-mode').focus(); $('remote-property-mode').select(); }
  else { $('remote-property-name').focus(); $('remote-property-name').select(); }
  return new Promise(resolve => { remotePropsResolve = resolve; });
}
$('remote-tab-general').addEventListener('click', () => setRemotePropertiesTab('general'));
$('remote-tab-permissions').addEventListener('click', () => setRemotePropertiesTab('permissions'));
for (const box of document.querySelectorAll('.permission-matrix input[type="checkbox"]')) box.addEventListener('change', updateRemoteModeFromMatrix);
$('remote-property-mode').addEventListener('input', () => updateRemoteMatrixFromMode($('remote-property-mode').value, { preserveRaw: true }));
$('remote-property-uid').addEventListener('input', () => { remotePropsOwnerTouched = true; });
$('remote-property-gid').addEventListener('input', () => { remotePropsGroupTouched = true; });
$('remote-properties-cancel').addEventListener('click', () => settleRemoteProperties(null));
$('remote-properties-dialog').addEventListener('cancel', (event) => { event.preventDefault(); settleRemoteProperties(null); });
$('remote-properties-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('remote-property-name').value.trim();
  const mode = $('remote-property-mode').value.trim();
  const uidText = $('remote-property-uid').value.trim();
  const gidText = $('remote-property-gid').value.trim();
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..') { $('transfer-status').textContent = currentLanguage === 'en' ? 'Invalid name: path separators, . and .. are not allowed' : '名称无效：不能包含路径分隔符，也不能使用 . 或 ..'; setRemotePropertiesTab('general'); $('remote-property-name').focus(); return; }
  if (!/^[0-7]{3,4}$/.test(mode)) { $('transfer-status').textContent = currentLanguage === 'en' ? 'Enter a 3- or 4-digit octal mode, e.g. 644 or 0755' : '权限格式应为三位或四位八进制数字，例如 644 或 0755'; setRemotePropertiesTab('permissions'); $('remote-property-mode').focus(); return; }
  if ((remotePropsOwnerTouched && !/^\d+$/.test(uidText)) || (remotePropsGroupTouched && !/^\d+$/.test(gidText))) { $('transfer-status').textContent = currentLanguage === 'en' ? 'Owner and group IDs must be non-negative integers.' : 'Owner 和 Group ID 必须是非负整数。'; setRemotePropertiesTab('permissions'); return; }
  settleRemoteProperties({ name, mode, uidText, gidText, ownerTouched: remotePropsOwnerTouched, groupTouched: remotePropsGroupTouched });
});
async function editRemoteProperties(entry, initialTab = 'general') {
  const sessionId = activeSession()?.connectionId;
  if (!sessionId) { $('transfer-status').textContent = currentLanguage === 'en' ? 'Connect SSH first' : '请先连接 SSH'; return; }
  const p = await window.pilot.remoteProperties(sessionId, entry.path);
  const changes = await openRemotePropertiesDialog(entry, p, initialTab);
  if (!changes) return;
  let targetPath = p.path;
  const changedName = changes.name !== entry.name;
  const changedMode = changes.mode !== String(p.permissions || '644');
  const originalUid = p.uid == null ? '0' : String(p.uid);
  const originalGid = p.gid == null ? '0' : String(p.gid);
  const uidChanged = changes.ownerTouched && changes.uidText !== originalUid;
  const gidChanged = changes.groupTouched && changes.gidText !== originalGid;
  if (uidChanged && p.gid == null && !changes.groupTouched) { $('transfer-status').textContent = currentLanguage === 'en' ? 'GID unavailable; enter both Owner and Group IDs to change ownership.' : '服务器未返回 GID；修改所有权时请同时填写 Owner 和 Group ID。'; return; }
  if (gidChanged && p.uid == null && !changes.ownerTouched) { $('transfer-status').textContent = currentLanguage === 'en' ? 'UID unavailable; enter both Owner and Group IDs to change ownership.' : '服务器未返回 UID；修改所有权时请同时填写 Owner 和 Group ID。'; return; }
  try {
    if (changedName) { const result = await window.pilot.renameRemote(sessionId, targetPath, changes.name); targetPath = result.path || targetPath; }
    if (changedMode) await window.pilot.chmodRemote(sessionId, [targetPath], changes.mode);
    if (uidChanged || gidChanged) {
      const uid = uidChanged ? Number(changes.uidText) : Number(originalUid);
      const gid = gidChanged ? Number(changes.gidText) : Number(originalGid);
      if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) throw new Error(currentLanguage === 'en' ? 'Owner/group ID is out of range.' : 'Owner/Group ID 超出有效范围。');
      await window.pilot.chownRemote(sessionId, targetPath, uid, gid);
    }
    const messages = [];
    if (changedName) messages.push(currentLanguage === 'en' ? 'name' : '名称');
    if (changedMode) messages.push(currentLanguage === 'en' ? 'permissions' : '权限');
    if (uidChanged || gidChanged) messages.push(currentLanguage === 'en' ? 'ownership' : '所有权');
    $('transfer-status').textContent = messages.length ? `${currentLanguage === 'en' ? 'Updated' : '已更新'}: ${messages.join(', ')}` : (currentLanguage === 'en' ? 'No changes.' : '没有修改。');
    await loadRemoteDirectory(remoteSftpPath);
  } catch (e) {
    $('transfer-status').textContent = `${currentLanguage === 'en' ? 'Failed to read properties: ' : '读取属性失败：'}${e.message || e}`;
    try { await loadRemoteDirectory(remoteSftpPath); } catch {}
  }
}
async function actionEditRemoteFile() {
  if (!activeContext || activeContext.side !== 'remote') return;
  const entry = selectedEntries('remote')[0];
  if (!entry || entry.isDir) return;
  const session = activeSession();
  if (!session?.connectionId) {
    $('transfer-status').textContent = currentLanguage === 'en' ? 'Connect an SSH session first.' : '请先连接 SSH。';
    return;
  }
  try {
    sftpDebug('editor.open.request', { sessionId: session.id, path: entry.path, name: entry.name, size: entry.size });
    const result = await window.pilot.openRemoteEditor(session.connectionId, entry.path);
    $('transfer-status').textContent = currentLanguage === 'en' ? `Editor opened: ${entry.name}` : `已打开编辑器：${entry.name}`;
    sftpDebug('editor.open.success', { editorId: result?.editorId, path: entry.path });
  } catch (error) {
    sftpDebug('editor.open.error', { path: entry.path, error: String(error?.stack || error) });
    $('transfer-status').textContent = `${currentLanguage === 'en' ? 'Cannot open editor: ' : '无法打开编辑器：'}${error.message || error}`;
  }
}

async function actionProperties() {
  if (!activeContext) return;
  const side = activeContext.side, entry = selectedEntries(side)[0];
  if (!entry) return;
  try {
    if (side === 'local') { const props = await window.pilot.localProperties(entry.path); if (props.native) await window.pilot.showLocalProperties(entry.path); else { $('properties-title').textContent = entry.name; $('properties-content').textContent = JSON.stringify(props, null, 2); $('properties-dialog').showModal(); } return; }
    await editRemoteProperties(entry, 'general');
  } catch (e) { $('transfer-status').textContent = `${currentLanguage === 'en' ? 'Properties failed: ' : '读取属性失败：'}${e.message || e}`; }
}
async function actionChmod() {
  if (!activeContext || activeContext.side !== 'remote') return;
  const entry = selectedEntries('remote')[0]; if (!entry) return;
  try { await editRemoteProperties(entry, 'permissions'); }
  catch (e) { $('transfer-status').textContent = `${currentLanguage === 'en' ? 'Permission change failed: ' : '修改权限失败：'}${e.message || e}`; }
}
async function actionCopyPath(){if(!activeContext)return;const paths=selectedPaths(activeContext.side);if(paths.length)await copyText(paths.join('\r\n'),currentLanguage==='en'?'Full path(s) copied':'完整路径已复制');}
function showSftpContextMenu(side,x,y){
  activeSftpSide=side;
  const selectedItems=selectedEntries(side);
  activeContext={side,path:selectedItems[0]?.path};
  const menu=$('sftp-context-menu');menu.replaceChildren();
  const actions=[];
  if(selectedItems.length){
    actions.push(['open',currentLanguage==='en'?'Open':'打开',()=>{const e=selectedEntries(side)[0];if(e?.isDir)(side==='local'?loadLocalDirectory(e.path):loadRemoteDirectory(e.path));else if(side==='remote')downloadRemotePaths(selectedPaths('remote'));}]);
    if(side==='remote' && selectedItems.length===1 && !selectedItems[0].isDir) actions.push(['edit-remote',currentLanguage==='en'?'Edit remote file…':'编辑文件…',()=>actionEditRemoteFile()]);
    actions.push(['upload-download',side==='local'?(currentLanguage==='en'?'Upload selected':'上传选中'):(currentLanguage==='en'?'Download selected':'下载选中'),()=>side==='local'?uploadLocalPaths(selectedPaths(side)):downloadRemotePaths(selectedPaths(side))]);
    if(selectedItems.length===1){
      actions.push(['rename',currentLanguage==='en'?'Rename (F2)':'重命名 (F2)',()=>actionRename()]);
      actions.push(['properties',currentLanguage==='en'?'Properties':'属性',()=>actionProperties()]);
      if(side==='remote') actions.push(['chmod',currentLanguage==='en'?'Change permissions':'修改权限',()=>actionChmod()]);
    }
    actions.push(['delete',currentLanguage==='en'?'Delete (Del)':'删除 (Del)',()=>actionDelete()]);
    actions.push(['move',currentLanguage==='en'?'Move to…':'移动到…',()=>moveSelection()]);
    actions.push(['copy',currentLanguage==='en'?'Copy full path':'复制完整路径',()=>actionCopyPath()]);
  }
  actions.push(['new',currentLanguage==='en'?'New folder':'新建文件夹',()=>actionNewFolder(side)]);
  actions.push(['refresh',currentLanguage==='en'?'Refresh':'刷新',()=>side==='local'?loadLocalDirectory(localSftpPath):loadRemoteDirectory(remoteSftpPath)]);
  for(const [key,label,fn] of actions){const b=document.createElement('button');b.type='button';b.className='context-menu-item';b.textContent=label;b.addEventListener('click',()=>{menu.classList.add('hidden');Promise.resolve(fn()).catch(e=>$('transfer-status').textContent=e.message||String(e));});menu.appendChild(b);}
  menu.classList.remove('hidden');
  const rect=menu.getBoundingClientRect();
  menu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-rect.width-8))}px`;
  menu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-rect.height-8))}px`;
}
function setSftpExpanded(expanded){
  const panel=$('transfer-panel'), layout=document.querySelector('.layout'), right=document.querySelector('.right-pane'), command=$('command-editor').closest('.command-panel');
  if(expanded===sftpExpanded)return;
  recordLayoutSnapshot('sftp-expand.before', { requestedExpanded: expanded }, true);
  if(expanded){
    layout.appendChild(panel);layout.classList.add('sftp-expanded');layout.style.gridTemplateColumns='';
    $('sftp-body').classList.remove('hidden');$('sftp-toggle-btn').textContent='⇦';$('sftp-toggle-btn').title=currentLanguage==='en'?'Collapse SFTP':'收起 SFTP';$('sftp-toggle-btn').setAttribute('aria-expanded','true');sftpExpanded=true;
  }else{
    right.insertBefore(panel,command);layout.classList.remove('sftp-expanded');layout.style.gridTemplateColumns='';$('sftp-body').classList.add('hidden');$('sftp-toggle-btn').textContent='➜';$('sftp-toggle-btn').title=currentLanguage==='en'?'Expand SFTP to the right':'向右展开 SFTP';$('sftp-toggle-btn').setAttribute('aria-expanded','false');sftpExpanded=false;
  }
  window.pilot.setSftpExpanded(expanded).catch(()=>{});
  requestAnimationFrame(() => requestAnimationFrame(() => {
    recordLayoutSnapshot('sftp-expand.after', { expanded: sftpExpanded }, true);
    const active = activeSession(); if (active?.mode === 'interactive' && active.interactiveTerminal) fitInteractiveTerminal(active, 'sftp-expand-settled');
  }));
  if(expanded){if(!localSftpPath)window.pilot.localHome().then(loadLocalDirectory);if(activeSession()?.connected)loadRemoteDirectory($('remote-path').value.trim()||'/tmp');}
}

// SFTP actions and navigation
$('sftp-toggle-btn').addEventListener('click',()=>setSftpExpanded(!sftpExpanded));
$('local-up-btn').addEventListener('click',()=>{if(localSftpParent&&localSftpPath!==localSftpParent)loadLocalDirectory(localSftpParent);});
$('local-pick-btn').addEventListener('click',async()=>{try{const result=await window.pilot.pickLocalDirectory();if(!result.canceled)loadLocalDirectory(result.path);}catch(e){$('transfer-status').textContent=e.message||String(e);}});
$('local-refresh-btn').addEventListener('click',()=>loadLocalDirectory($('local-path').value.trim()||localSftpPath));
$('local-open-btn').addEventListener('click',()=>loadLocalDirectory($('local-path').value.trim()));
$('local-path').addEventListener('keydown',e=>{if(e.key==='Enter')loadLocalDirectory($('local-path').value.trim());});
$('remote-up-btn').addEventListener('click',()=>loadRemoteDirectory(remoteSftpPath==='/'?'/':remoteSftpPath.replace(/\/+$/,'').replace(/\/[^/]*$/,'')||'/'));
$('remote-refresh-btn').addEventListener('click',()=>loadRemoteDirectory($('remote-path').value.trim()||remoteSftpPath));
$('remote-open-btn').addEventListener('click',()=>loadRemoteDirectory($('remote-path').value.trim()));
$('remote-path').addEventListener('keydown',e=>{if(e.key==='Enter')loadRemoteDirectory($('remote-path').value.trim());});
$('local-upload-btn').addEventListener('click',()=>uploadLocalPaths(selectedPaths('local')));
$('remote-download-btn').addEventListener('click',()=>downloadRemotePaths(selectedPaths('remote')));
$('sftp-new-folder-btn').addEventListener('click',()=>actionNewFolder(activeSftpSide));
$('sftp-rename-btn').addEventListener('click',actionRename);$('sftp-delete-btn').addEventListener('click',actionDelete);$('sftp-properties-btn').addEventListener('click',actionProperties);$('sftp-chmod-btn').addEventListener('click',actionChmod);$('sftp-move-btn').addEventListener('click',moveSelection);$('sftp-copy-path-btn').addEventListener('click',actionCopyPath);
$('local-filter').addEventListener('focus',()=>activeSftpSide='local');$('remote-filter').addEventListener('focus',()=>activeSftpSide='remote');$('local-path').addEventListener('focus',()=>activeSftpSide='local');$('remote-path').addEventListener('focus',()=>activeSftpSide='remote');$('local-files').addEventListener('mousedown',()=>activeSftpSide='local');$('remote-files').addEventListener('mousedown',()=>activeSftpSide='remote');$('local-filter').addEventListener('input',()=>renderFileList('local'));$('remote-filter').addEventListener('input',()=>renderFileList('remote'));
wireSftpBlankArea('local'); wireSftpBlankArea('remote');
document.addEventListener('mousedown',handleSftpMouseNavigation,true); document.addEventListener('auxclick',handleSftpMouseNavigation,true);
$('local-sort').addEventListener('change',()=>renderFileList('local'));$('remote-sort').addEventListener('change',()=>renderFileList('remote'));$('sftp-show-hidden').addEventListener('change',()=>{renderFileList('local');renderFileList('remote');});
$('retry-all-failed-btn').addEventListener('click',retryAllFailed);$('clear-failed-btn').addEventListener('click',()=>{for(const [id,t] of transferTasks)if(t.status==='failed')transferTasks.delete(id);renderTransferQueue();});
for(const side of ['local','remote'])$( `${side}-files`).addEventListener('keydown',event=>{const list=side==='local'?selectedPaths('local'):selectedPaths('remote');if(!list.length&&event.key!=='F5')return;if(event.key==='Delete'){event.preventDefault();activeContext={side};actionDelete();}else if(event.key==='F2'){event.preventDefault();activeContext={side};actionRename();}else if(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='n'){event.preventDefault();actionNewFolder(side);}else if(event.key==='F5'){event.preventDefault();side==='local'?loadLocalDirectory(localSftpPath):loadRemoteDirectory(remoteSftpPath);}else if(event.altKey&&event.key==='ArrowUp'){event.preventDefault();side==='local'?loadLocalDirectory(localSftpParent):loadRemoteDirectory(remoteParentPath(remoteSftpPath));}});
document.addEventListener('click',event=>{if(!$('sftp-context-menu').contains(event.target))$('sftp-context-menu').classList.add('hidden');if(!$('ssh-tab-context-menu').contains(event.target))$('ssh-tab-context-menu').classList.add('hidden');});
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('ssh-tab-context-menu').classList.add('hidden');});
window.addEventListener('resize', () => {
  $('ssh-tab-context-menu').classList.add('hidden');
  const now = Date.now();
  const s = activeSession();
  // One record for every distinct viewport size; full DOM metrics make it possible to
  // see which ancestor stopped growing. No terminal contents are included.
  recordLayoutSnapshot('window.resize', { activeTabId: s?.id || null, mode: s?.mode || 'none' });
  if (s?.mode === 'interactive' && s.interactiveTerminal) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (activeSessionId !== s.id || s.mode !== 'interactive' || !s.interactiveTerminal) return;
      fitInteractiveTerminal(s, 'window-resize-settled');
    }));
  }
  // Capture the final stable dimensions after the user releases the resize border.
  if (layoutDebugState.windowResizeTimer) clearTimeout(layoutDebugState.windowResizeTimer);
  layoutDebugState.windowResizeTimer = setTimeout(() => {
    const finalSession = activeSession();
    sftpDebug('layout.window-resize-settled', { quietMs: Date.now() - now, activeTabId: finalSession?.id || null, mode: finalSession?.mode || 'none' });
    recordLayoutSnapshot('window.resize.settled', {}, true);
    if (finalSession?.mode === 'interactive' && finalSession.interactiveTerminal) fitInteractiveTerminal(finalSession, 'window-resize-final');
  }, 220);
});
window.addEventListener('orientationchange', () => recordLayoutSnapshot('window.orientationchange', {}, true));
window.addEventListener('beforeunload', () => recordLayoutSnapshot('window.beforeunload', {}, true));
wireSftpDrop('remote-files','remote');wireSftpDrop('local-files','local');

$('connect-btn').addEventListener('click', async () => {
  const cfg = { host: $('ssh-host').value.trim(), port: Number($('ssh-port').value || 22), username: $('ssh-user').value.trim(), password: $('ssh-password').value, useProxy: $('ssh-use-proxy').checked, proxy: getProxyConfig() };
  if (!cfg.host || !cfg.username || !cfg.password) { $('ssh-message').textContent = currentLanguage === 'en' ? 'Enter the host, username, and password first.' : '请先填写服务器地址、账号和密码。'; return; }
  $('ssh-message').textContent = currentLanguage === 'en' ? 'Creating a new SSH session…' : '正在建立新的 SSH 会话…'; $('connect-btn').disabled = true;
  let profileSaveWarning = '';
  try { await window.pilot.saveSshProfile(cfg); await loadSshProfiles(`${cfg.username}@${cfg.host}:${cfg.port}`); } catch (e) { profileSaveWarning = e.message || String(e); }
  const tabId = makeId();
  const snapshot = { ...cfg, proxy: cfg.proxy ? { ...cfg.proxy } : null };
  const s = { id: tabId, connectionId: null, host: snapshot.host, port: snapshot.port, username: snapshot.username, connected: false, connectionState: 'disconnected', config: snapshot, events: [], latestRun: null, mode: 'command', interactiveTerminal: null, createdAt: Date.now(), lastError: '' };
  sshSessions.set(s.id, s); activeSessionId = s.id; useActiveAndUpdate();
  await connectSessionTab(s, `[${new Date().toLocaleTimeString()}] ${currentLanguage === 'en' ? 'Opening a new SSH session…' : '正在新建 SSH 会话…'}`);
  if (profileSaveWarning && sshSessions.get(s.id) === s && activeSessionId === s.id) $('ssh-message').textContent += ` (${currentLanguage === 'en' ? 'Profile save warning' : '配置保存提示'}: ${profileSaveWarning})`;
  $('connect-btn').disabled = false; setTopStatus();
});
$('disconnect-btn').addEventListener('click', async () => {
  const s = activeSession(); if (!s?.connected) return;
  await disconnectSession(s);
});
$('trust-host-btn').addEventListener('click', async () => {
  if (!hostKeyPending) return;
  try { const r = await window.pilot.trustHost(hostKeyPending.fingerprint); $('ssh-message').textContent = currentLanguage === 'en' ? 'Host fingerprint saved. Click ↻ on the same tab to retry.' : '已保存主机指纹。请点击原标签页上的 ↻ 重试连接。'; $('hostkey-box').classList.add('hidden'); hostKeyPending = null; }
  catch (e) { $('ssh-message').textContent = e.message || String(e); }
  $('connect-btn').disabled = false;
});
$('cancel-hostkey-btn').addEventListener('click', () => { hostKeyPending = null; $('hostkey-box').classList.add('hidden'); $('connect-btn').disabled = false; $('ssh-message').textContent = currentLanguage === 'en' ? 'Host fingerprint verification cancelled.' : '已取消主机指纹确认'; });
$('run-btn').addEventListener('click', handleRunFromEditor);
$('interactive-mode-btn').addEventListener('click', () => { void switchActiveSessionMode('interactive').catch((error) => { const s = activeSession(); if (s) appendTerminal(s.id, error.message || String(error), 'error'); }); });
$('command-mode-btn').addEventListener('click', () => { void switchActiveSessionMode('command'); });
$('clear-interactive-btn').addEventListener('click', () => { const s = activeSession(); if (s?.interactiveTerminal) { s.interactiveTerminal.terminal.clear(); s.interactiveTerminal.terminal.focus(); } });
$('paste-run-btn').addEventListener('click', handlePasteAndRun);
$('clear-editor-btn').addEventListener('click', () => { $('command-editor').value = ''; $('command-editor').focus(); });
$('command-editor').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey && e.shiftKey) { e.preventDefault(); handlePasteAndRun(); }
  else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); handleRunFromEditor(); }
});
$('copy-record-btn').addEventListener('click', async () => { const r = activeSession()?.latestRun; if (r) { try { await copyText(fullRecord(r), '本次命令的完整运行记录已复制。'); } catch (e) { appendTerminal(activeSessionId, `复制失败：${e.message || e}`, 'error'); } } });
$('copy-output-btn').addEventListener('click', async () => { const r = activeSession()?.latestRun; if (r) { try { await copyText(outputOnly(r), '本次运行的纯输出已复制。'); } catch (e) { appendTerminal(activeSessionId, `复制失败：${e.message || e}`, 'error'); } } });
$('send-result-btn').addEventListener('click', sendLatestResult);
$('clear-terminal-btn').addEventListener('click', () => { const s = activeSession(); if (!s) return; s.events = []; renderTerminal(); });
$('apply-proxy-btn').addEventListener('click', async () => {
  const cfg = getProxyConfig();
  $('apply-proxy-btn').disabled = true;
  $('proxy-status').textContent = currentLanguage==='en'?'Applying proxy settings…':'正在应用代理设置…';
  try {
    const applied = await window.pilot.applyChatProxy(cfg);
    $('proxy-host').value = applied.host; $('proxy-port').value = applied.port; $('proxy-type').value = applied.type; $('gpt-proxy-enabled').checked = applied.enabled;
    updateProxySummary();
    $('proxy-status').textContent = currentLanguage==='en' ? (applied.enabled ? `Applied ${applied.type.toUpperCase()} ${applied.host}:${applied.port}; refreshing ChatGPT.` : 'Application proxy disabled; ChatGPT will try a direct connection.') : (applied.enabled ? `已应用 ${applied.type.toUpperCase()} ${applied.host}:${applied.port}，正在刷新 ChatGPT。` : '已关闭应用代理，ChatGPT 将尝试直连。');
    browser.reload();
  } catch (e) { $('proxy-status').textContent = `${currentLanguage==='en'?'Apply failed':'应用失败'}: ${e.message || e}`; }
  finally { $('apply-proxy-btn').disabled = false; }
});
for (const id of ['gpt-proxy-enabled', 'proxy-type', 'proxy-host', 'proxy-port']) $(id).addEventListener('change', updateProxySummary);

$('window-min-btn').addEventListener('click', () => window.pilot.minimizeWindow());
$('window-max-btn').addEventListener('click', () => window.pilot.toggleMaximizeWindow());
$('window-close-btn').addEventListener('click', () => window.pilot.closeWindow());
$('app-titlebar').addEventListener('dblclick', (event) => { if (!event.target.closest('button')) window.pilot.toggleMaximizeWindow(); });
$('back-btn').addEventListener('click', () => { try { browser.goBack(); } catch {} });
$('forward-btn').addEventListener('click', () => { try { browser.goForward(); } catch {} });
$('reload-btn').addEventListener('click', () => { try { browser.reload(); } catch {} });
$('open-chat-btn').addEventListener('click', () => { try { browser.loadURL('https://chatgpt.com/'); } catch {} });

browser.addEventListener('did-start-loading', () => { browserMainFrameFailed = false; chatReady = false; $('chat-dot').className = 'dot yellow'; $('chat-status').textContent = '网页加载中'; $('webview-cover').classList.remove('hidden'); $('webview-cover').lastElementChild.textContent = '正在等待 ChatGPT 页面…'; setTopStatus(); });
browser.addEventListener('did-stop-loading', () => { if (browserMainFrameFailed) { chatReady = false; setTopStatus(); return; } chatReady = true; $('chat-dot').className = 'dot green'; $('chat-status').textContent = '网页已加载'; $('webview-cover').classList.add('hidden'); $('conversation-url').textContent = browser.getURL() || 'ChatGPT'; setTopStatus(); });
browser.addEventListener('did-fail-load', (_e, code, desc, url, isMainFrame) => { if (!isMainFrame) return; browserMainFrameFailed = true; chatReady = false; $('chat-dot').className = 'dot red'; $('chat-status').textContent = `加载失败 ${code}`; $('webview-cover').classList.remove('hidden'); $('webview-cover').lastElementChild.textContent = `ChatGPT 加载失败：${desc} (${url})`; setTopStatus(); });
window.pilot.on('ssh:status', (info) => {
  const tabId = info.tabId || info.sessionId;
  const s = sshSessions.get(tabId);
  if (!s || !s.connectionId || info.sessionId !== s.connectionId) return;
  if (info.host) s.host = info.host; if (info.username) s.username = info.username; if (info.port) s.port = info.port;
  if (info.state === 'connecting') {
    s.connected = false; s.connectionState = 'connecting';
    if (activeSessionId === s.id) $('ssh-message').textContent = info.message || (currentLanguage === 'en' ? 'Connecting…' : '正在连接…');
    renderTabs(); setTopStatus(); return;
  }
  s.connected = Boolean(info.connected);
  s.connectionState = s.connected ? 'connected' : (info.state === 'error' ? 'error' : 'disconnected');
  if (!s.connected && s.interactiveTerminal) { s.interactiveTerminal.startedConnectionId = null; s.interactiveTerminal.pendingInput = ''; }
  if (info.state === 'error') s.lastError = info.message || '';
  if (activeSessionId === s.id) {
    $('ssh-message').textContent = info.message || '';
    if (info.message && (info.connected || info.state === 'disconnected')) appendTerminal(s.id, info.message, info.connected ? 'success' : 'system');
  }
  if (info.connected && !activeSessionId) activeSessionId = s.id;
  useActiveAndUpdate();
  if (s.connected && s.mode === 'interactive' && activeSessionId === s.id) void activateInteractiveTerminal(s);
});
window.pilot.on('ssh:host-key-pending', (info) => {
  hostKeyPending = info;
  $('hostkey-title').textContent = info.changed ? '警告：SSH 主机指纹发生变化' : '首次连接：确认 SSH 主机指纹';
  $('hostkey-desc').textContent = info.changed ? `以前保存的 ${info.host}:${info.port} 指纹与当前不一致。可能是重装系统，也可能连接到了错误主机；确认之前不要继续。` : `正在连接 ${info.host}:${info.port}，请确认这是目标设备。主机指纹和加密后的连接密码会保存在本机。`;
  $('hostkey-value').textContent = info.fingerprint; $('hostkey-box').classList.remove('hidden'); $('ssh-message').textContent = '等待确认主机指纹'; $('connect-btn').disabled = false;
});
window.pilot.on('ssh:output', (info) => {
  const run = activeRuns.get(info.runId);
  if (run) {
    if (info.kind === 'stdout') run.stdout += info.text;
    else run.stderr += info.text;
  }
  const tabId = info.tabId || sshSessions.get(info.sessionId)?.id || null;
  const s = tabId ? sshSessions.get(tabId) : null;
  if (s && s.connectionId === info.sessionId) appendTerminal(tabId, info.text, info.kind === 'stderr' ? 'stderr' : 'output');
});
window.pilot.on('ssh:terminal:data', (info) => {
  const s = sshSessions.get(info.tabId || '');
  if (!s || s.connectionId !== info.sessionId || !s.connected || !s.interactiveTerminal) return;
  s.interactiveTerminal.terminal.write(String(info.data || ''));
});
window.pilot.on('ssh:terminal:status', (info) => {
  const s = sshSessions.get(info.tabId || '');
  if (!s || (s.connectionId && s.connectionId !== info.sessionId)) return;
  if (info.state === 'ready') {
    if (s.interactiveTerminal && s.connectionId === info.sessionId) { s.interactiveTerminal.startedConnectionId = info.sessionId; flushPendingTerminalInput(s, info.sessionId); }
    if (activeSessionId === s.id && s.mode === 'interactive') $('interactive-terminal-status').textContent = currentLanguage === 'en' ? `Interactive Shell · ${sessionName(s)}` : `交互式 Shell · ${sessionName(s)}`;
  } else if (info.state === 'closed' || info.state === 'disconnected') {
    if (s.interactiveTerminal && s.interactiveTerminal.startedConnectionId === info.sessionId) {
      s.interactiveTerminal.startedConnectionId = null;
      if (info.state === 'closed') s.interactiveTerminal.endedConnectionId = info.sessionId;
      s.interactiveTerminal.pendingInput = '';
    }
    if (activeSessionId === s.id && s.mode === 'interactive') {
      $('interactive-terminal-status').textContent = currentLanguage === 'en' ? 'Interactive Shell ended; reconnect to start a new one.' : '交互式 Shell 已结束；重连后可以启动新的 Shell。';
      s.interactiveTerminal?.terminal.write(`\r\n\x1b[33m[${info.message || 'Interactive Shell ended'}]\x1b[0m\r\n`);
    }
  } else if (info.state === 'error' && activeSessionId === s.id && s.mode === 'interactive') {
    $('interactive-terminal-status').textContent = info.message || (currentLanguage === 'en' ? 'Interactive terminal error' : '交互式终端错误');
  }
});
window.pilot.on('app:log', (message) => { if (activeSessionId) appendTerminal(activeSessionId, String(message), 'system'); else $('ssh-message').textContent = String(message); });
window.pilot.on('sftp:drag-status', (message) => { $('transfer-status').textContent = String(message || ''); });

window.pilot.on('sftp:progress', (info) => {
  const task = transferTasks.get(info.transferId); if (!task) return;
  task.transferred = Number(info.transferred || task.transferred || 0);
  task.total = Number(info.total || task.total || 0);
  task.currentFile = info.currentFile || task.currentFile;
  renderTransferQueue();
});

async function loadSshProfiles(selectedKey = '') {
  try {
    sshProfileCache = await window.pilot.listSshProfiles();
    const select = $('ssh-profile-select'); select.replaceChildren();
    const placeholder = document.createElement('option'); placeholder.value=''; placeholder.textContent=currentLanguage==='en'?'Select saved connection…':'选择保存的连接…'; select.appendChild(placeholder);
    for (const profile of sshProfileCache) { const option=document.createElement('option'); option.value=profile.key; option.textContent=`${profile.username}@${profile.host}:${profile.port}`; select.appendChild(option); }
    if (selectedKey && sshProfileCache.some(p=>p.key===selectedKey)) select.value=selectedKey;
    $('delete-ssh-profile-btn').disabled=!select.value;
  } catch (e) { $('ssh-message').textContent=`读取已保存连接失败：${e.message||e}`; }
}
function applyProfileToForm(profile) {
  if(!profile)return;
  $('ssh-host').value=profile.host||'';$('ssh-port').value=profile.port||22;$('ssh-user').value=profile.username||'';$('ssh-password').value=profile.password||'';$('ssh-use-proxy').checked=profile.useProxy===true;
  if(profile.proxy){$('proxy-type').value=profile.proxy.type||'socks5';$('proxy-host').value=profile.proxy.host||'127.0.0.1';$('proxy-port').value=profile.proxy.port||10808;}
}
$('ssh-profile-select').addEventListener('change',()=>{const p=sshProfileCache.find(item=>item.key===$('ssh-profile-select').value);if(p)applyProfileToForm(p);$('delete-ssh-profile-btn').disabled=!p;});
$('save-ssh-profile-btn').addEventListener('click',async()=>{const cfg={host:$('ssh-host').value.trim(),port:Number($('ssh-port').value||22),username:$('ssh-user').value.trim(),password:$('ssh-password').value,useProxy:$('ssh-use-proxy').checked,proxy:getProxyConfig()};try{await window.pilot.saveSshProfile(cfg);await loadSshProfiles(`${cfg.username}@${cfg.host}:${cfg.port}`);$('ssh-message').textContent=currentLanguage==='en'?'Connection profile and encrypted password saved':'连接配置及加密密码已保存';}catch(e){$('ssh-message').textContent=`${currentLanguage==='en'?'Unable to save connection':'保存连接失败'}: ${e.message||e}`;}});
$('delete-ssh-profile-btn').addEventListener('click',async()=>{const key=$('ssh-profile-select').value;if(!key)return;if(!window.confirm(currentLanguage==='en'?'Delete the saved connection?':'删除这条已保存的连接配置吗？'))return;await window.pilot.deleteSshProfile(key);await loadSshProfiles();});

// Language engine restored from v0.6.0's source-preserving localization design,
// with v0.6.1's additional UI dictionary and compatibility for its bilingual renderers.
const I18N_EN = {"进入交互式终端":"Open interactive terminal","返回命令模式":"Return to command mode","SSH 交互式终端":"SSH Interactive Terminal","清空终端":"Clear terminal","右键粘贴 · 选中文字自动复制":"Right-click to paste · selected text copies automatically","使用真正的 SSH PTY Shell；右键粘贴，选中文字自动复制":"Real SSH PTY Shell; right-click to paste and selected text copies automatically","N1PilotDesktop · 半自动工作台":"N1PilotDesktop · Semi-Automated Workspace","左侧 ChatGPT · 右侧 SSH · 由你决定每一步":"ChatGPT on the left · SSH on the right · You control every step","ChatGPT 加载中":"ChatGPT loading","无活动 SSH":"No active SSH","退出":"Exit","语言 / Language":"Language","文件属性":"File Properties","文件夹":"Folder","文件":"File","不可用":"Not Available","确定":"OK","取消":"Cancel","ChatGPT 对话":"ChatGPT Chat","左侧浏览器单独使用代理；不会改变 SSH 的默认直连行为":"The ChatGPT browser uses its own proxy; SSH stays direct by default","后退":"Back","前进":"Forward","刷新":"Refresh","打开 ChatGPT":"Open ChatGPT","GPT 代理设置":"GPT Proxy Settings","ChatGPT 使用此代理":"Use this proxy for ChatGPT","类型":"Type","代理地址":"Proxy host","端口":"Port","应用并刷新 GPT":"Apply and refresh GPT","默认 SOCKS5 127.0.0.1:10808；V2RayN 端口如不同可在此修改。代理不含用户名/密码认证。":"Default: SOCKS5 127.0.0.1:10808. Change the V2RayN port as needed. Proxy authentication is not supported.","正在等待 ChatGPT 页面…":"Waiting for ChatGPT…","独立持久登录会话 · 不使用 API Key":"Separate persistent login session · No API key","SSH 连接 / 多会话":"SSH Connections / Sessions","每次连接创建一个独立会话标签；密码加密保存在本机":"Each connection gets a separate session tab; passwords are encrypted locally","无活动会话":"No active session","已保存的 SSH 配置":"Saved SSH Profiles","选择已保存配置…":"Select a saved profile…","保存配置":"Save Profile","删除配置":"Delete profile","地址 / IP":"Host / IP","账号":"Username","密码":"Password","SSH 登录密码（加密保存）":"SSH password (saved encrypted)","＋ 新建 SSH 会话":"＋ New SSH Session","断开当前":"Disconnect current","新建 SSH 会话走代理（默认关闭）":"Use proxy for new SSH sessions (off by default)","首次连接需核对主机指纹":"Verify host fingerprint on first connection","确认 SSH 主机指纹":"Verify SSH host fingerprint","信任此指纹":"Trust fingerprint","命令工作区":"Command Workspace","将 GPT 代码粘贴到这里；支持多行 shell 脚本":"Paste GPT commands here; multi-line shell scripts are supported","超时秒数":"Timeout (sec)","在左侧 ChatGPT 复制代码后，粘贴到这里……":"Copy code from ChatGPT on the left and paste it here…","支持多行 shell 脚本。Ctrl+Enter 运行编辑框内容；Ctrl+Shift+Enter 粘贴剪贴板并运行。":"Multi-line shell scripts supported. Ctrl+Enter runs the editor; Ctrl+Shift+Enter pastes and runs the clipboard.","📋 粘贴并运行":"📋 Paste & Run","▶ 运行编辑框代码":"▶ Run Editor Code","清空":"Clear","请先连接一个 SSH 会话":"Connect an SSH session first","高风险命令需你确认；敏感文件读取仍会拦截":"High-risk commands require confirmation; sensitive file reads are blocked","SSH 运行输出":"SSH Output","实时 stdout / stderr；保存最近运行记录，切换会话仍可查看":"Live stdout / stderr; recent run records remain available per session","复制完整记录":"Copy Full Record","复制纯输出":"Copy Output Only","清屏":"Clear Output","就绪。连接 SSH 后，把 ChatGPT 给出的命令粘贴到右侧，再由你决定执行。":"Ready. Connect SSH, paste a command from ChatGPT, and decide whether to execute it.","回传本次结果并发送到 GPT":"Send This Result to GPT","将本次命令、stdout、stderr、退出码发到左侧当前 ChatGPT 对话。":"Send the command, stdout, stderr and exit code to the current ChatGPT conversation.","文件传输（SFTP）":"File Transfer (SFTP)","拖到另一个 SFTP 面板或 Windows 资源管理器，均可直接拖动；支持多选和文件夹递归传输。":"Drag directly to the other SFTP pane or Windows Explorer; multi-select and recursive folder transfers are supported.","正在准备拖到 Windows 资源管理器的文件…":"Preparing files for Windows Explorer…","正在准备文件拖放…":"Preparing file drag…","文件拖放已结束":"File drag ended","外部拖放已结束":"External drag ended","一键重试失败项":"Retry All Failed","重试":"Retry","重试此传输":"Retry this transfer","失败":"Failed","完成":"Completed","进行中":"In progress","等待中":"Pending","整体进度":"Overall progress","上传":"Upload","下载":"Download","传输失败":"Transfer failed","窗口调整失败：":"Window resize failed: ","收起 SFTP":"Collapse SFTP","展开 SFTP":"Expand SFTP to the right","传输队列 / Transfer Queue":"Transfer Queue","空闲 / Idle":"Idle","本地 ⇄ 远程；Ctrl/Shift 多选，双击文件夹进入，支持拖放文件":"Local ⇄ Remote; Ctrl/Shift multi-select, double-click folders, drag and drop","当前会话":"Current session","展开":"Expand","折叠":"Collapse","本地目录":"Local Directory","远程目录":"Remote Directory","上级目录":"Parent directory","选择目录":"Choose folder","新建文件夹":"New Folder","本地文件夹路径":"Local folder path","远程目录路径":"Remote directory path","打开":"Open","过滤文件名…":"Filter filenames…","清除过滤":"Clear filter","未选择文件":"No selection","上传选中 →":"Upload selected →","← 下载选中":"← Download selected","连接 SSH 后可浏览远程目录。上传仅覆盖时会先询问；下载遇到同名本地文件会自动另存为新名称。":"Connect SSH to browse remote files. Upload overwrite requires confirmation; downloads use a unique name when a local item exists.","支持内部与 Windows 资源管理器双向拖放，包含多选和文件夹递归传输。右键可删除、重命名、移动、查看属性、复制完整路径。":"Drag and drop between panes and Windows Explorer, including multi-select and recursive folders. Right-click to delete, rename, move, view properties, or copy full paths.","打开 / 进入文件夹":"Open / Enter Folder","重命名":"Rename","移动到…":"Move to…","删除":"Delete","属性":"Properties","修改远程权限…":"Change Remote Permissions…","复制完整路径":"Copy Full Path","目标目录":"Target directory","移动到":"Move to","输入目标文件夹，或从最近使用的目录中选择。":"Enter a destination folder or choose a recent directory.","最近使用的目录":"Recent directories","移动":"Move","此目录为空":"This folder is empty","请先连接 SSH":"Connect SSH first","连接 SSH 后，这里会出现会话标签":"SSH session tabs appear here after connecting","当前已连接":"Connected","当前已断开":"Disconnected","已选择":"Selected","连接":"Connect","远程文件属性":"Remote File Properties","名称":"Name","完整路径":"Full path","大小":"Size","修改时间":"Modified","创建时间":"Created","权限":"Permissions","所有者 UID":"Owner UID","所属组 GID":"Group GID","复制到剪贴板":"Copied to clipboard","当前过滤条件没有匹配结果":"No files match this filter","此目录没有文件":"This directory has no files","连接其他主机或启动远程通信工具":"Connecting to another host or starting a remote communication tool","修改网络配置或重启网络，可能导致 SSH 失联":"Changing network configuration or restarting networking may disconnect SSH","递归修改文件权限或所有权":"Recursively changing permissions or ownership","修改、覆盖或删除系统文件及配置文件":"Modifying, overwriting, or deleting system files/configuration","连接配置需要填写地址、用户名和密码。":"A saved profile requires a host, username, and password.","保存连接配置需要填写地址、用户名和密码。":"To save a profile, enter the host, username, and password.","找不到这条连接配置。":"Saved profile not found.","配置已保存":"Profile saved","已删除连接配置":"Profile deleted","安全操作":"Safe operation","文件夹名称":"Folder name","新文件名":"New name","输入新文件夹名称":"Enter a new folder name","输入新名称":"Enter a new name","目标位置已存在同名项目":"An item with the same name already exists at the destination","远程项目不存在":"Remote item not found","本地项目不存在":"Local item not found","本地目标目录不存在":"Local destination folder not found","远程目标目录不存在":"Remote destination folder not found","请先选择要删除的项目":"Select items to delete first","请先选择需要拖动的项目":"Select items to drag first","请先选择要移动的项目":"Select items to move first","没有最近使用的目录":"No recent directories","确定删除选中的项目吗？":"Delete the selected items?","无法读取目录":"Unable to read folder","过滤文件名":"Filter filenames","名称无效：不能包含路径分隔符，也不能使用 . 或 ..":"Invalid name: path separators, . and .. are not allowed","权限格式应为三位或四位八进制数字，例如 644 或 0755":"Enter a 3- or 4-digit octal mode, such as 644 or 0755","文件夹已创建":"Folder created","已重命名":"Renamed","已删除":"Deleted","已移动":"Moved","已复制到本地目录":"Copied into the local folder","已复制到剪贴板":"Copied to clipboard","完整路径已复制":"Full paths copied","删除这条记录":"Remove this entry","拖放启动失败：":"Unable to start drag: ","读取属性失败：":"Failed to read properties: ","修改权限失败：":"Failed to change permissions: ","权限已修改":"Permissions updated","输入八进制权限，例如 644 或 0755":"Enter octal permissions, e.g. 644 or 0755","修改远程权限":"Change Remote Permissions","八进制权限":"Octal mode","应用":"Apply","输入":"Input","读取连接配置失败：":"Failed to read saved profiles: ","加载配置失败：":"Failed to load profile: ","保存配置失败：":"Failed to save profile: ","删除配置失败：":"Failed to delete profile: ","已载入保存的连接配置":"Saved connection profile loaded","连接配置已加密保存":"Connection profile saved with encrypted password","连接配置已删除":"Connection profile deleted","确定删除这条保存的连接配置吗？":"Delete this saved connection profile?","名称 ↑":"Name ↑","名称 ↓":"Name ↓","大小 ↓":"Size ↓","大小 ↑":"Size ↑","修改时间 ↓":"Modified ↓","修改时间 ↑":"Modified ↑","这条命令可能进行高风险操作：":"This command may perform a high-risk operation: ","命令：":"Command:","确认后才会执行。确定继续吗？":"It will only run after confirmation. Continue?","确认覆盖远程同名项目吗？":"Overwrite the existing remote item?","读取 SSH 私钥或系统密码文件":"Reading SSH private keys or system password files","包含私钥内容":"Contains private-key material","可能一次性输出全部环境变量和凭据":"May dump all environment variables and credentials","刷机或闪存写入":"Firmware flashing or flash-memory write","重启或关机":"Reboot or shutdown","磁盘格式化或分区变更":"Disk formatting or partition changes","向块设备直接写入":"Writing directly to a block device","删除根目录内容":"Deleting root-directory contents","递归强制删除文件":"Recursively force-deleting files","清空防火墙规则":"Flushing firewall rules","下载后直接执行远程脚本":"Downloading and directly executing a remote script","修改账号密码或操作密码数据库":"Changing account passwords or password databases","卸载系统软件包":"Uninstalling system packages","已应用":"Applied","已关闭应用代理，ChatGPT 将尝试直连。":"Application proxy disabled; ChatGPT will attempt a direct connection.","SSH 连接成功":"SSH connected","连接成功":"Connected","等待确认主机指纹":"Waiting for host fingerprint confirmation","首次连接：确认 SSH 主机指纹":"First connection: verify SSH host fingerprint","警告：SSH 主机指纹发生变化":"Warning: SSH host fingerprint changed","切换到该 SSH 会话":"Switch to this SSH session","该会话已断开；点击查看历史输出":"This session is disconnected; click to view output history","已取消主机指纹确认":"Host fingerprint verification cancelled","请先核对 SSH 主机指纹并确认，再重新连接。":"Verify and trust the SSH host fingerprint before connecting again.","请填写服务器地址和账号":"Enter the server address and username","SSH 端口无效":"Invalid SSH port","请填写 SSH 密码。":"Enter the SSH password.","SSH 连接超时（20 秒），请检查地址、端口、N1 是否在线以及 SSH 服务状态":"SSH connection timed out (20 seconds). Check the host, port, N1 availability, and SSH service.","SSH 连接提前关闭":"SSH connection closed prematurely","连接代理超时，请检查代理地址、端口和 V2RayN/N1 代理服务":"Proxy connection timed out. Check the address, port, and V2RayN/N1 proxy service","本地路径不是文件夹":"Local path is not a folder","远程路径不是文件夹：":"Remote path is not a folder: ","远程目标目录不存在或不是文件夹：":"Remote destination is missing or is not a folder: ","请先连接 SSH 会话":"Connect an SSH session first","远程路径包含无效字符":"The remote path contains invalid characters","已连接":"Connected","已断开":"Disconnected","已复制到剪贴板。":"Copied to clipboard.","已取消高风险命令，本次未执行。":"High-risk command cancelled; nothing was executed.","正在执行：":"Running: ","本次执行已结束":"This run has finished","执行状态未知":"Execution state unknown","执行错误":"Execution error","已信任":"Trusted","请选择":"Please select","请先选择":"Please select first","SSH 结果已发送到 GPT。":"SSH results sent to GPT.","正在把本次 SSH 结果发送到左侧 ChatGPT…":"Sending these SSH results to ChatGPT…","SSH 会话已断开：":"SSH session disconnected: ","SSH 错误：":"SSH error: ","连接代理失败：":"Failed to connect to proxy: ","代理握手失败：":"Proxy handshake failed: ","代理设置无法保存：":"Could not save proxy settings: ","初始化 GPT 代理失败：":"Failed to initialize the GPT proxy: ","应用代理设置失败":"Failed to apply proxy settings","退出程序":"Quit application","确定断开并退出吗？":"Disconnect and quit?","远程路径无效":"Invalid remote path","本地文件列表":"Local file list","远程文件列表":"Remote file list","选择本地文件夹":"Choose local folder","已创建文件夹":"Folder created","创建文件夹失败：":"Could not create folder: ","请先连接 SSH，再浏览远程目录。":"Connect SSH before browsing remote folders.","请先选择一个已连接的 SSH 会话。":"Select a connected SSH session first.","命令框为空。请先粘贴 GPT 代码或输入命令。":"The command editor is empty. Paste GPT code or enter a command first.","代码超过 12000 字符限制；请拆分成较小步骤执行。":"The command exceeds the 12,000-character limit. Split it into smaller steps.","系统剪贴板为空。先在 GPT 代码块中点复制，再点击“粘贴并运行”。":"The system clipboard is empty. Copy a code block in GPT first, then click Paste & Run.","ChatGPT 页面尚未加载完成。":"The ChatGPT page has not finished loading.","左侧 ChatGPT 页面没有找到输入框。":"Could not find the input box on the left ChatGPT page.","无法填入 ChatGPT 输入框。":"Could not fill the ChatGPT input box.","无法确认消息已提交；请检查左侧 ChatGPT 输入框，避免重复发送。":"Could not confirm submission. Check the ChatGPT input box on the left to avoid sending a duplicate.","你取消了高风险命令，本次未执行。":"You cancelled the high-risk command; nothing was executed.","请先连接 SSH。每个会话的运行输出会分别保留。":"Connect SSH first. Output is retained separately for each session.","请先连接 SSH。":"Connect SSH first.","已由用户断开 SSH。":"SSH disconnected by user.","断开失败：":"Disconnect failed: ","复制失败：":"Copy failed: ","系统剪贴板为空":"The system clipboard is empty","本次命令的完整运行记录已复制。":"Full command record copied.","本次运行的纯输出已复制。":"Output-only record copied.","传输中…":"Transferring…","主机":"Host","开始时间":"Started","结束时间":"Finished","仍在运行":"Still running","退出码":"Exit code","未知/未结束":"Unknown / still running","stdout":"stdout","stderr":"stderr","空":"empty","输出内容可能已达到本地采集上限":"Output may have reached the local capture limit","信号":"Signal","命令结束":"Command finished","加载失败":"Load failed","半自动工作台":"Semi-Automatic Workbench","代理地址无效":"Invalid proxy address","每次连接创建一个独立会话标签；密码按连接配置加密保存":"Each connection gets its own session tab; passwords are encrypted per profile","已保存的连接":"Saved connections","选择保存的连接…":"Select a saved connection…","保存/更新配置":"Save / Update","SSH 登录密码":"SSH password","在左侧 ChatGPT 复制代码后，粘贴到这里……\n\n支持多行 shell 脚本。Ctrl+Enter 运行编辑框内容；Ctrl+Shift+Enter 粘贴剪贴板并运行。":"Paste commands copied from ChatGPT here…\n\nMulti-line shell supported. Ctrl+Enter runs the editor; Ctrl+Shift+Enter pastes and runs clipboard content.","文件管理器（SFTP）":"File Manager (SFTP)","本地与远程双栏 · 多选、右键菜单、内部拖放":"Local and remote panes · Multi-select, context menu and internal drag & drop","日志目录":"Log folder","打开调试日志目录":"Open DEBUG log folder","记录拖拽、路径解析与传输诊断日志":"Record drag, path-resolution and transfer diagnostics","向右展开 SFTP":"Expand SFTP to the right","Filter 文件名…":"Filter filenames…","重命名 (F2)":"Rename (F2)","删除 (Del)":"Delete (Del)","修改权限":"Change Permissions","显示隐藏文件":"Show hidden files","连接 SSH 后可浏览远程目录。":"Connect SSH to browse remote directories.","传输队列":"Transfer Queue","重试全部失败项":"Retry All Failed","清除失败记录":"Clear Failed","没有进行中的传输或失败任务":"No active or failed transfers","本地拖到远程可上传；远程拖到本地可下载。目录支持递归传输。拖到资源管理器请拖动文件行右侧的 ↗；若该项属于多选，会一起拖出全部选中项。":"Drag local items to remote to upload, or remote items to local to download. Folders transfer recursively. Drag a row’s ↗ handle to Explorer; if that row is selected, all selected items go together.","没有匹配的文件":"No matching items","最小化":"Minimize","最大化/还原":"Maximize / Restore","切换语言":"Switch language","SOCKS5 · 127.0.0.1:10808":"SOCKS5 · 127.0.0.1:10808","本地与远程双栏 · 多选、右键操作、内外部拖放":"Local and remote panes · Multi-select, context actions and internal/external drag & drop","没有活动传输":"No active transfers","暂无传输任务":"No transfer tasks yet","排序":"Sort","- by Edison":"- by Edison","需连接 SSH":"Connect SSH first","就绪":"Ready","网页已加载":"Web page loaded","网页加载中":"Loading web page","代理设置无法保存":"Unable to save proxy settings","General":"General","Permissions":"Permissions","Type of file:":"Type of file:","Location:":"Location:","Size:":"Size:","Created:":"Created:","Modified:":"Modified:","Acessed:":"Acessed:","Owner: ID:":"Owner: ID:","Group: ID:":"Group: ID:","Read":"Read","Write":"Write","Execute":"Execute","Owner:":"Owner:","Group:":"Group:","Other:":"Other:","Numerical:":"Numerical:","读取属性失败":"Failed to read properties","关闭":"Close","请输入文件夹名称":"Enter a folder name","请输入新名称":"Enter a new name","将选中的本地项目移动到目标文件夹":"Move selected local items to this folder","将选中的远程项目移动到目标文件夹":"Move selected remote items to this folder","确认覆盖远程同名文件或目录吗？":"Overwrite the existing remote item?","确定永久删除选中的":"Permanently delete selected","删除这条已保存的连接配置吗？":"Delete this saved connection profile?","连接配置及加密密码已保存":"Connection profile and encrypted password saved","保存连接失败":"Failed to save connection","没有活动 SSH":"No active SSH","远程目录不存在":"Remote directory not found","远程路径不是文件夹":"Remote path is not a folder","文件名无效":"Invalid filename","文件夹名称无效":"Invalid folder name","移动完成":"Move completed","传输完成":"Transfer completed","重命名失败":"Rename failed","删除失败":"Delete failed","修改权限失败":"Failed to change permissions","移动失败":"Move failed","新建文件夹失败":"Failed to create folder","上传失败":"Upload failed","下载失败":"Download failed","读取本地目录失败":"Failed to read local directory","读取远程目录失败":"Failed to read remote directory","复制失败":"Copy failed","复制完整路径已复制":"Full path copied","已复制":"Copied","已上传":"Uploaded","已下载":"Downloaded","常规":"General","文件名":"File name","文件类型：":"Type of file:","位置：":"Location:","大小：":"Size:","创建时间：":"Created:","修改时间：":"Modified:","访问时间：":"Acessed:","所有者 ID：":"Owner: ID:","用户组 ID：":"Group: ID:","读取":"Read","写入":"Write","执行":"Execute","所有者：":"Owner:","组：":"Group:","其他：":"Other:","八进制值：":"Numerical:","八进制":"Octal","所有者读取":"Owner Read","所有者写入":"Owner Write","所有者执行":"Owner Execute","组读取":"Group Read","组写入":"Group Write","组执行":"Group Execute","其他用户读取":"Other Read","其他用户写入":"Other Write","其他用户执行":"Other Execute","文件属性标签":"File properties tabs"};
const DYNAMIC_EN = [["整体进度 ","Overall progress "],["失败项","failed item(s)"],["已选择 ","Selected "],["正在连接 ","Connecting to "],["已连接 ","Connected to "],["已断开 ","Disconnected from "],["读取本地目录失败：","Failed to read local folder: "],["读取远程目录失败：","Failed to read remote folder: "],["选择本地目录失败：","Failed to choose local folder: "],["初始化本地目录失败：","Failed to initialize local folder: "],["请先选择本地文件。","Select local files first."],["请先选择远程文件。","Select remote files first."],["请先连接 SSH。","Connect SSH first."],["请先连接 SSH，再浏览远程目录。","Connect SSH before browsing remote folders."],["准备上传 ","Preparing upload of "],["准备下载 ","Preparing download of "],[" 个文件到 "," item(s) to "],["上传失败：","Upload failed: "],["下载失败：","Download failed: "],["移动失败：","Move failed: "],["删除失败：","Delete failed: "],["重命名失败：","Rename failed: "],["创建文件夹失败：","Could not create folder: "],["远程目录：","Remote folder: "],["应用失败：","Apply failed: "],["复制失败：","Copy failed: "],["回传失败：","Send failed: "],["回传 GPT 失败：","Failed to send to GPT: "],["ChatGPT 加载失败：","ChatGPT failed to load: "],["当前只支持传输文件，请双击进入文件夹后选择文件。","Only files can be transferred in this operation. Double-click to enter a folder first."],["正在建立新的 SSH 会话…","Creating a new SSH session…"],["SSH 连接成功","SSH connected"],["正在连接…","Connecting…"],["等待确认主机指纹","Waiting for host-key verification"],["本次命令的完整运行记录已复制。","Full command record copied."],["本次运行的纯输出已复制。","Command output copied."],["正在应用代理设置…","Applying proxy settings…"],["网页加载中","Loading page"],["网页已加载","Page loaded"],["正在等待 ChatGPT 页面…","Waiting for ChatGPT…"],["请选择一个已连接的 SSH 会话。","Select a connected SSH session."],["命令框为空。请先粘贴 GPT 代码或输入命令。","The command editor is empty. Paste GPT code or enter a command first."],["本地路径不是文件夹","Local path is not a folder"],["远程路径不是文件夹","Remote path is not a folder"],["远程目录不存在：","Remote folder not found: "],["远程文件不存在：","Remote file not found: "],["本地已存在同名文件：","A local file with the same name already exists: "],["远程已存在同名文件：","A remote file with the same name already exists: "],["远程已存在同名文件或文件夹：","A remote item with the same name already exists: "],["本地已存在同名文件夹：","A local folder with the same name already exists: "],["当前只支持下载文件，请双击进入文件夹后选择文件：","Only files can be downloaded here; double-click to enter the folder first: "],["这条命令可能进行高风险操作：","This command may perform a high-risk operation: "],["确认后才会执行。确定继续吗？","It will run only after confirmation. Continue?"],["安全拦截：","Blocked by safety checks: "],["执行错误：","Execution error: "],["命令结束","Command finished"],["已保存","Saved"],["加载失败","Load failed"],["状态：","Status: "],["已启用","Enabled"],["未填写","Not set"],["GPT 直连","GPT direct connection"],["应用代理","application proxy"],["正在刷新 ChatGPT。",", reloading ChatGPT."],["这条命令可能进行高风险操作：","This command may perform a high-risk operation: "],["确认后才会执行。确定继续吗？","It will only run after confirmation. Continue?"],["确认覆盖远程同名项目吗？","Overwrite the existing remote item?"],["以前保存的 ","Previously saved "],[" 指纹与当前不一致。可能是重装系统，也可能连接到了错误主机；确认之前不要继续。"," fingerprint does not match. The system may have been reinstalled, or this may be the wrong host. Do not continue until verified."],["正在连接 ","Connecting to "],["，请确认这是目标设备。指纹会保存在本机；连接密码会加密保存。",", verify this is the intended device. The fingerprint is stored locally; the connection password is saved encrypted."],[" 个 SSH 会话"," SSH session(s)"],[" · 可执行命令"," · commands available"],[" · 已断开，仅可查看历史"," · disconnected; history only"],["密码会加密保存在本机","password is saved encrypted locally"],["读取已保存连接失败：","Failed to load saved connections: "],["应用失败: ","Apply failed: "],["已应用 ","Applied "],["SSH 结果已发送到 GPT。","SSH result sent to GPT."],["已取消主机指纹确认","Host fingerprint confirmation cancelled"],["当前已连接","Connected"],["当前已断开","Disconnected"],["没有活动 SSH","No active SSH"],["无活动 SSH","No active SSH"],["远程目录: ","Remote directory: "],["传输失败：","Transfer failed: "],["新建文件夹失败：","Failed to create folder: "],["修改权限失败：","Failed to change permissions: "],["本地复制失败：","Local copy failed: "],["外部拖放失败: ","External drag failed: "],["SSH 错误：","SSH error: "]];
const uniqueEnglishToChinese = new Map(Object.entries({"N1PilotDesktop · Semi-Automated Workspace":"N1PilotDesktop · 半自动工作台","ChatGPT on the left · SSH on the right · You control every step":"左侧 ChatGPT · 右侧 SSH · 由你决定每一步","ChatGPT loading":"ChatGPT 加载中","Exit":"退出","Language":"语言 / Language","File Properties":"文件属性","Folder":"文件夹","File":"文件","Not Available":"不可用","OK":"确定","Cancel":"取消","ChatGPT Chat":"ChatGPT 对话","The ChatGPT browser uses its own proxy; SSH stays direct by default":"左侧浏览器单独使用代理；不会改变 SSH 的默认直连行为","Back":"后退","Forward":"前进","Refresh":"刷新","Open ChatGPT":"打开 ChatGPT","GPT Proxy Settings":"GPT 代理设置","Use this proxy for ChatGPT":"ChatGPT 使用此代理","Type":"类型","Proxy host":"代理地址","Port":"端口","Apply and refresh GPT":"应用并刷新 GPT","Default: SOCKS5 127.0.0.1:10808. Change the V2RayN port as needed. Proxy authentication is not supported.":"默认 SOCKS5 127.0.0.1:10808；V2RayN 端口如不同可在此修改。代理不含用户名/密码认证。","Waiting for ChatGPT…":"正在等待 ChatGPT 页面…","Separate persistent login session · No API key":"独立持久登录会话 · 不使用 API Key","SSH Connections / Sessions":"SSH 连接 / 多会话","Each connection gets a separate session tab; passwords are encrypted locally":"每次连接创建一个独立会话标签；密码加密保存在本机","No active session":"无活动会话","Saved SSH Profiles":"已保存的 SSH 配置","Select a saved profile…":"选择已保存配置…","Save Profile":"保存配置","Delete profile":"删除配置","Host / IP":"地址 / IP","Username":"账号","Password":"密码","SSH password (saved encrypted)":"SSH 登录密码（加密保存）","＋ New SSH Session":"＋ 新建 SSH 会话","Disconnect current":"断开当前","Use proxy for new SSH sessions (off by default)":"新建 SSH 会话走代理（默认关闭）","Verify host fingerprint on first connection":"首次连接需核对主机指纹","Verify SSH host fingerprint":"确认 SSH 主机指纹","Trust fingerprint":"信任此指纹","Command Workspace":"命令工作区","Paste GPT commands here; multi-line shell scripts are supported":"将 GPT 代码粘贴到这里；支持多行 shell 脚本","Timeout (sec)":"超时秒数","Copy code from ChatGPT on the left and paste it here…":"在左侧 ChatGPT 复制代码后，粘贴到这里……","Multi-line shell scripts supported. Ctrl+Enter runs the editor; Ctrl+Shift+Enter pastes and runs the clipboard.":"支持多行 shell 脚本。Ctrl+Enter 运行编辑框内容；Ctrl+Shift+Enter 粘贴剪贴板并运行。","📋 Paste & Run":"📋 粘贴并运行","▶ Run Editor Code":"▶ 运行编辑框代码","Clear":"清空","High-risk commands require confirmation; sensitive file reads are blocked":"高风险命令需你确认；敏感文件读取仍会拦截","SSH Output":"SSH 运行输出","Live stdout / stderr; recent run records remain available per session":"实时 stdout / stderr；保存最近运行记录，切换会话仍可查看","Copy Full Record":"复制完整记录","Copy Output Only":"复制纯输出","Clear Output":"清屏","Ready. Connect SSH, paste a command from ChatGPT, and decide whether to execute it.":"就绪。连接 SSH 后，把 ChatGPT 给出的命令粘贴到右侧，再由你决定执行。","Send This Result to GPT":"回传本次结果并发送到 GPT","Send the command, stdout, stderr and exit code to the current ChatGPT conversation.":"将本次命令、stdout、stderr、退出码发到左侧当前 ChatGPT 对话。","File Transfer (SFTP)":"文件传输（SFTP）","Drag directly to the other SFTP pane or Windows Explorer; multi-select and recursive folder transfers are supported.":"拖到另一个 SFTP 面板或 Windows 资源管理器，均可直接拖动；支持多选和文件夹递归传输。","Preparing files for Windows Explorer…":"正在准备拖到 Windows 资源管理器的文件…","Preparing file drag…":"正在准备文件拖放…","File drag ended":"文件拖放已结束","External drag ended":"外部拖放已结束","Retry":"重试","Retry this transfer":"重试此传输","Failed":"失败","Completed":"完成","In progress":"进行中","Pending":"等待中","Overall progress":"整体进度","Upload":"上传","Download":"下载","Transfer failed":"传输失败","Window resize failed: ":"窗口调整失败：","Collapse SFTP":"收起 SFTP","Idle":"空闲 / Idle","Local ⇄ Remote; Ctrl/Shift multi-select, double-click folders, drag and drop":"本地 ⇄ 远程；Ctrl/Shift 多选，双击文件夹进入，支持拖放文件","Current session":"当前会话","Expand":"展开","Collapse":"折叠","Local Directory":"本地目录","Remote Directory":"远程目录","Parent directory":"上级目录","Choose folder":"选择目录","New Folder":"新建文件夹","Local folder path":"本地文件夹路径","Remote directory path":"远程目录路径","Open":"打开","Clear filter":"清除过滤","No selection":"未选择文件","Upload selected →":"上传选中 →","← Download selected":"← 下载选中","Connect SSH to browse remote files. Upload overwrite requires confirmation; downloads use a unique name when a local item exists.":"连接 SSH 后可浏览远程目录。上传仅覆盖时会先询问；下载遇到同名本地文件会自动另存为新名称。","Drag and drop between panes and Windows Explorer, including multi-select and recursive folders. Right-click to delete, rename, move, view properties, or copy full paths.":"支持内部与 Windows 资源管理器双向拖放，包含多选和文件夹递归传输。右键可删除、重命名、移动、查看属性、复制完整路径。","Open / Enter Folder":"打开 / 进入文件夹","Rename":"重命名","Move to…":"移动到…","Delete":"删除","Properties":"属性","Change Remote Permissions…":"修改远程权限…","Copy Full Path":"复制完整路径","Target directory":"目标目录","Move to":"移动到","Enter a destination folder or choose a recent directory.":"输入目标文件夹，或从最近使用的目录中选择。","Recent directories":"最近使用的目录","Move":"移动","This folder is empty":"此目录为空","SSH session tabs appear here after connecting":"连接 SSH 后，这里会出现会话标签","Selected":"已选择","Connect":"连接","Remote File Properties":"远程文件属性","Name":"名称","Full path":"完整路径","Size":"大小","Modified":"修改时间","Created":"创建时间","Owner UID":"所有者 UID","Group GID":"所属组 GID","No files match this filter":"当前过滤条件没有匹配结果","This directory has no files":"此目录没有文件","Connecting to another host or starting a remote communication tool":"连接其他主机或启动远程通信工具","Changing network configuration or restarting networking may disconnect SSH":"修改网络配置或重启网络，可能导致 SSH 失联","Recursively changing permissions or ownership":"递归修改文件权限或所有权","Modifying, overwriting, or deleting system files/configuration":"修改、覆盖或删除系统文件及配置文件","A saved profile requires a host, username, and password.":"连接配置需要填写地址、用户名和密码。","To save a profile, enter the host, username, and password.":"保存连接配置需要填写地址、用户名和密码。","Saved profile not found.":"找不到这条连接配置。","Profile saved":"配置已保存","Profile deleted":"已删除连接配置","Safe operation":"安全操作","Folder name":"文件夹名称","New name":"新文件名","Enter a new folder name":"输入新文件夹名称","An item with the same name already exists at the destination":"目标位置已存在同名项目","Remote item not found":"远程项目不存在","Local item not found":"本地项目不存在","Local destination folder not found":"本地目标目录不存在","Remote destination folder not found":"远程目标目录不存在","Select items to delete first":"请先选择要删除的项目","Select items to drag first":"请先选择需要拖动的项目","Select items to move first":"请先选择要移动的项目","No recent directories":"没有最近使用的目录","Delete the selected items?":"确定删除选中的项目吗？","Unable to read folder":"无法读取目录","Filter filenames":"过滤文件名","Invalid name: path separators, . and .. are not allowed":"名称无效：不能包含路径分隔符，也不能使用 . 或 ..","Enter a 3- or 4-digit octal mode, such as 644 or 0755":"权限格式应为三位或四位八进制数字，例如 644 或 0755","Renamed":"已重命名","Deleted":"已删除","Moved":"已移动","Copied into the local folder":"已复制到本地目录","Full paths copied":"完整路径已复制","Remove this entry":"删除这条记录","Unable to start drag: ":"拖放启动失败：","Failed to read properties: ":"读取属性失败：","Failed to change permissions: ":"修改权限失败：","Permissions updated":"权限已修改","Enter octal permissions, e.g. 644 or 0755":"输入八进制权限，例如 644 或 0755","Change Remote Permissions":"修改远程权限","Octal mode":"八进制权限","Apply":"应用","Input":"输入","Failed to read saved profiles: ":"读取连接配置失败：","Failed to load profile: ":"加载配置失败：","Failed to save profile: ":"保存配置失败：","Failed to delete profile: ":"删除配置失败：","Saved connection profile loaded":"已载入保存的连接配置","Connection profile saved with encrypted password":"连接配置已加密保存","Connection profile deleted":"连接配置已删除","Name ↑":"名称 ↑","Name ↓":"名称 ↓","Size ↓":"大小 ↓","Size ↑":"大小 ↑","Modified ↓":"修改时间 ↓","Modified ↑":"修改时间 ↑","This command may perform a high-risk operation: ":"这条命令可能进行高风险操作：","Command:":"命令：","It will only run after confirmation. Continue?":"确认后才会执行。确定继续吗？","Reading SSH private keys or system password files":"读取 SSH 私钥或系统密码文件","Contains private-key material":"包含私钥内容","May dump all environment variables and credentials":"可能一次性输出全部环境变量和凭据","Firmware flashing or flash-memory write":"刷机或闪存写入","Reboot or shutdown":"重启或关机","Disk formatting or partition changes":"磁盘格式化或分区变更","Writing directly to a block device":"向块设备直接写入","Deleting root-directory contents":"删除根目录内容","Recursively force-deleting files":"递归强制删除文件","Flushing firewall rules":"清空防火墙规则","Downloading and directly executing a remote script":"下载后直接执行远程脚本","Changing account passwords or password databases":"修改账号密码或操作密码数据库","Uninstalling system packages":"卸载系统软件包","Applied":"已应用","Application proxy disabled; ChatGPT will attempt a direct connection.":"已关闭应用代理，ChatGPT 将尝试直连。","SSH connected":"SSH 连接成功","Waiting for host fingerprint confirmation":"等待确认主机指纹","First connection: verify SSH host fingerprint":"首次连接：确认 SSH 主机指纹","Warning: SSH host fingerprint changed":"警告：SSH 主机指纹发生变化","Switch to this SSH session":"切换到该 SSH 会话","This session is disconnected; click to view output history":"该会话已断开；点击查看历史输出","Host fingerprint verification cancelled":"已取消主机指纹确认","Verify and trust the SSH host fingerprint before connecting again.":"请先核对 SSH 主机指纹并确认，再重新连接。","Enter the server address and username":"请填写服务器地址和账号","Invalid SSH port":"SSH 端口无效","Enter the SSH password.":"请填写 SSH 密码。","SSH connection timed out (20 seconds). Check the host, port, N1 availability, and SSH service.":"SSH 连接超时（20 秒），请检查地址、端口、N1 是否在线以及 SSH 服务状态","SSH connection closed prematurely":"SSH 连接提前关闭","Proxy connection timed out. Check the address, port, and V2RayN/N1 proxy service":"连接代理超时，请检查代理地址、端口和 V2RayN/N1 代理服务","Local path is not a folder":"本地路径不是文件夹","Remote path is not a folder: ":"远程路径不是文件夹：","Remote destination is missing or is not a folder: ":"远程目标目录不存在或不是文件夹：","The remote path contains invalid characters":"远程路径包含无效字符","Copied to clipboard.":"已复制到剪贴板。","High-risk command cancelled; nothing was executed.":"已取消高风险命令，本次未执行。","Running: ":"正在执行：","This run has finished":"本次执行已结束","Execution state unknown":"执行状态未知","Execution error":"执行错误","Trusted":"已信任","Please select":"请选择","Please select first":"请先选择","SSH results sent to GPT.":"SSH 结果已发送到 GPT。","Sending these SSH results to ChatGPT…":"正在把本次 SSH 结果发送到左侧 ChatGPT…","SSH session disconnected: ":"SSH 会话已断开：","SSH error: ":"SSH 错误：","Failed to connect to proxy: ":"连接代理失败：","Proxy handshake failed: ":"代理握手失败：","Could not save proxy settings: ":"代理设置无法保存：","Failed to initialize the GPT proxy: ":"初始化 GPT 代理失败：","Failed to apply proxy settings":"应用代理设置失败","Quit application":"退出程序","Disconnect and quit?":"确定断开并退出吗？","Invalid remote path":"远程路径无效","Local file list":"本地文件列表","Remote file list":"远程文件列表","Choose local folder":"选择本地文件夹","Could not create folder: ":"创建文件夹失败：","Connect SSH before browsing remote folders.":"请先连接 SSH，再浏览远程目录。","Select a connected SSH session first.":"请先选择一个已连接的 SSH 会话。","The command editor is empty. Paste GPT code or enter a command first.":"命令框为空。请先粘贴 GPT 代码或输入命令。","The command exceeds the 12,000-character limit. Split it into smaller steps.":"代码超过 12000 字符限制；请拆分成较小步骤执行。","The system clipboard is empty. Copy a code block in GPT first, then click Paste & Run.":"系统剪贴板为空。先在 GPT 代码块中点复制，再点击“粘贴并运行”。","The ChatGPT page has not finished loading.":"ChatGPT 页面尚未加载完成。","Could not find the input box on the left ChatGPT page.":"左侧 ChatGPT 页面没有找到输入框。","Could not fill the ChatGPT input box.":"无法填入 ChatGPT 输入框。","Could not confirm submission. Check the ChatGPT input box on the left to avoid sending a duplicate.":"无法确认消息已提交；请检查左侧 ChatGPT 输入框，避免重复发送。","You cancelled the high-risk command; nothing was executed.":"你取消了高风险命令，本次未执行。","Connect SSH first. Output is retained separately for each session.":"请先连接 SSH。每个会话的运行输出会分别保留。","Connect SSH first.":"请先连接 SSH。","SSH disconnected by user.":"已由用户断开 SSH。","Disconnect failed: ":"断开失败：","Copy failed: ":"复制失败：","The system clipboard is empty":"系统剪贴板为空","Full command record copied.":"本次命令的完整运行记录已复制。","Output-only record copied.":"本次运行的纯输出已复制。","Transferring…":"传输中…","Host":"主机","Started":"开始时间","Finished":"结束时间","Still running":"仍在运行","Exit code":"退出码","Unknown / still running":"未知/未结束","stdout":"stdout","stderr":"stderr","empty":"空","Output may have reached the local capture limit":"输出内容可能已达到本地采集上限","Signal":"信号","Command finished":"命令结束","Load failed":"加载失败","Semi-Automatic Workbench":"半自动工作台","Invalid proxy address":"代理地址无效","Each connection gets its own session tab; passwords are encrypted per profile":"每次连接创建一个独立会话标签；密码按连接配置加密保存","Saved connections":"已保存的连接","Select a saved connection…":"选择保存的连接…","Save / Update":"保存/更新配置","SSH password":"SSH 登录密码","Paste commands copied from ChatGPT here…\n\nMulti-line shell supported. Ctrl+Enter runs the editor; Ctrl+Shift+Enter pastes and runs clipboard content.":"在左侧 ChatGPT 复制代码后，粘贴到这里……\n\n支持多行 shell 脚本。Ctrl+Enter 运行编辑框内容；Ctrl+Shift+Enter 粘贴剪贴板并运行。","File Manager (SFTP)":"文件管理器（SFTP）","Local and remote panes · Multi-select, context menu and internal drag & drop":"本地与远程双栏 · 多选、右键菜单、内部拖放","Log folder":"日志目录","Open DEBUG log folder":"打开调试日志目录","Record drag, path-resolution and transfer diagnostics":"记录拖拽、路径解析与传输诊断日志","Rename (F2)":"重命名 (F2)","Delete (Del)":"删除 (Del)","Change Permissions":"修改权限","Show hidden files":"显示隐藏文件","Connect SSH to browse remote directories.":"连接 SSH 后可浏览远程目录。","Clear Failed":"清除失败记录","No active or failed transfers":"没有进行中的传输或失败任务","Drag local items to remote to upload, or remote items to local to download. Folders transfer recursively. Drag a row’s ↗ handle to Explorer; if that row is selected, all selected items go together.":"本地拖到远程可上传；远程拖到本地可下载。目录支持递归传输。拖到资源管理器请拖动文件行右侧的 ↗；若该项属于多选，会一起拖出全部选中项。","No matching items":"没有匹配的文件","Minimize":"最小化","Maximize / Restore":"最大化/还原","Switch language":"切换语言","SOCKS5 · 127.0.0.1:10808":"SOCKS5 · 127.0.0.1:10808","Local and remote panes · Multi-select, context actions and internal/external drag & drop":"本地与远程双栏 · 多选、右键操作、内外部拖放","No active transfers":"没有活动传输","No transfer tasks yet":"暂无传输任务","Sort":"排序","- by Edison":"- by Edison","Ready":"就绪","Web page loaded":"网页已加载","Loading web page":"网页加载中","Unable to save proxy settings":"代理设置无法保存","General":"General","Type of file:":"Type of file:","Location:":"Location:","Size:":"Size:","Created:":"Created:","Modified:":"Modified:","Acessed:":"Acessed:","Owner: ID:":"Owner: ID:","Group: ID:":"Group: ID:","Read":"Read","Write":"Write","Execute":"Execute","Owner:":"Owner:","Group:":"Group:","Other:":"Other:","Numerical:":"Numerical:","Failed to read properties":"读取属性失败","Close":"关闭","Enter a folder name":"请输入文件夹名称","Move selected local items to this folder":"将选中的本地项目移动到目标文件夹","Move selected remote items to this folder":"将选中的远程项目移动到目标文件夹","Permanently delete selected":"确定永久删除选中的","Connection profile and encrypted password saved":"连接配置及加密密码已保存","Failed to save connection":"保存连接失败","Remote directory not found":"远程目录不存在","Remote path is not a folder":"远程路径不是文件夹","Invalid filename":"文件名无效","Invalid folder name":"文件夹名称无效","Move completed":"移动完成","Transfer completed":"传输完成","Rename failed":"重命名失败","Delete failed":"删除失败","Failed to change permissions":"修改权限失败","Move failed":"移动失败","Failed to create folder":"新建文件夹失败","Upload failed":"上传失败","Download failed":"下载失败","Failed to read local directory":"读取本地目录失败","Failed to read remote directory":"读取远程目录失败","Copy failed":"复制失败","Full path copied":"复制完整路径已复制","Copied":"已复制","Uploaded":"已上传","Downloaded":"已下载"}));
const uniqueDynamicEnglishToChinese = new Map(Object.entries({"Overall progress ":"整体进度 ","failed item(s)":"失败项","Selected ":"已选择 ","Connected to ":"已连接 ","Disconnected from ":"已断开 ","Failed to read local folder: ":"读取本地目录失败：","Failed to read remote folder: ":"读取远程目录失败：","Failed to choose local folder: ":"选择本地目录失败：","Failed to initialize local folder: ":"初始化本地目录失败：","Select local files first.":"请先选择本地文件。","Select remote files first.":"请先选择远程文件。","Connect SSH first.":"请先连接 SSH。","Connect SSH before browsing remote folders.":"请先连接 SSH，再浏览远程目录。","Preparing upload of ":"准备上传 ","Preparing download of ":"准备下载 "," item(s) to ":" 个文件到 ","Upload failed: ":"上传失败：","Download failed: ":"下载失败：","Move failed: ":"移动失败：","Delete failed: ":"删除失败：","Rename failed: ":"重命名失败：","Could not create folder: ":"创建文件夹失败：","Remote folder: ":"远程目录：","Copy failed: ":"复制失败：","Send failed: ":"回传失败：","Failed to send to GPT: ":"回传 GPT 失败：","ChatGPT failed to load: ":"ChatGPT 加载失败：","Only files can be transferred in this operation. Double-click to enter a folder first.":"当前只支持传输文件，请双击进入文件夹后选择文件。","Creating a new SSH session…":"正在建立新的 SSH 会话…","SSH connected":"SSH 连接成功","Connecting…":"正在连接…","Waiting for host-key verification":"等待确认主机指纹","Full command record copied.":"本次命令的完整运行记录已复制。","Command output copied.":"本次运行的纯输出已复制。","Applying proxy settings…":"正在应用代理设置…","Loading page":"网页加载中","Page loaded":"网页已加载","Waiting for ChatGPT…":"正在等待 ChatGPT 页面…","Select a connected SSH session.":"请选择一个已连接的 SSH 会话。","The command editor is empty. Paste GPT code or enter a command first.":"命令框为空。请先粘贴 GPT 代码或输入命令。","Local path is not a folder":"本地路径不是文件夹","Remote path is not a folder":"远程路径不是文件夹","Remote folder not found: ":"远程目录不存在：","Remote file not found: ":"远程文件不存在：","A local file with the same name already exists: ":"本地已存在同名文件：","A remote file with the same name already exists: ":"远程已存在同名文件：","A remote item with the same name already exists: ":"远程已存在同名文件或文件夹：","A local folder with the same name already exists: ":"本地已存在同名文件夹：","Only files can be downloaded here; double-click to enter the folder first: ":"当前只支持下载文件，请双击进入文件夹后选择文件：","It will run only after confirmation. Continue?":"确认后才会执行。确定继续吗？","Blocked by safety checks: ":"安全拦截：","Execution error: ":"执行错误：","Command finished":"命令结束","Saved":"已保存","Load failed":"加载失败","Status: ":"状态：","Enabled":"已启用","Not set":"未填写","GPT direct connection":"GPT 直连","application proxy":"应用代理",", reloading ChatGPT.":"正在刷新 ChatGPT。","It will only run after confirmation. Continue?":"确认后才会执行。确定继续吗？","Overwrite the existing remote item?":"确认覆盖远程同名项目吗？","Previously saved ":"以前保存的 "," fingerprint does not match. The system may have been reinstalled, or this may be the wrong host. Do not continue until verified.":" 指纹与当前不一致。可能是重装系统，也可能连接到了错误主机；确认之前不要继续。",", verify this is the intended device. The fingerprint is stored locally; the connection password is saved encrypted.":"，请确认这是目标设备。指纹会保存在本机；连接密码会加密保存。"," SSH session(s)":" 个 SSH 会话"," · commands available":" · 可执行命令"," · disconnected; history only":" · 已断开，仅可查看历史","password is saved encrypted locally":"密码会加密保存在本机","Failed to load saved connections: ":"读取已保存连接失败：","Applied ":"已应用 ","SSH result sent to GPT.":"SSH 结果已发送到 GPT。","Host fingerprint confirmation cancelled":"已取消主机指纹确认","Connected":"当前已连接","Disconnected":"当前已断开","Remote directory: ":"远程目录: ","Transfer failed: ":"传输失败：","Failed to create folder: ":"新建文件夹失败：","Failed to change permissions: ":"修改权限失败：","Local copy failed: ":"本地复制失败：","External drag failed: ":"外部拖放失败: ","SSH error: ":"SSH 错误："}));
const englishSourceAliases = new Map(Object.entries({"File folder": "文件夹", "No matching items": "没有匹配的文件", "No active or failed transfers": "没有进行中的传输或失败任务", "Not Available": "不可用", "Collapse SFTP": "收起 SFTP", "Expand SFTP to the right": "向右展开 SFTP", "Connect SSH first": "请先连接 SSH", "Connect SSH before browsing remote files": "请先连接 SSH，再浏览远程目录。", "Transfer completed": "传输完成", "Transfer failed": "传输失败", "Rename failed": "重命名失败", "Delete failed": "删除失败", "Move failed": "移动失败", "Failed to read local directory": "读取本地目录失败", "Failed to read remote directory": "读取远程目录失败", "Local copy failed": "本地复制失败", "Preparing external drag failed": "准备外部拖放失败", "Cannot read local directory": "读取本地目录失败", "Directory navigation failed": "目录导航失败", "No changes.": "没有修改。", "Updated": "已更新", "Owner/group ID must be non-negative integers.": "Owner 和 Group ID 必须是非负整数。", "GID unavailable; enter both Owner and Group IDs to change ownership.": "服务器未返回 GID；修改所有权时请同时填写 Owner 和 Group ID。", "UID unavailable; enter both Owner and Group IDs to change ownership.": "服务器未返回 UID；修改所有权时请同时填写 Owner 和 Group ID。", "Owner/group ID is out of range.": "Owner/Group ID 超出有效范围。", "Connection profile and encrypted password saved": "连接配置及加密密码已保存", "Unable to save connection": "保存连接失败", "No active SSH": "无活动 SSH", "Connect an SSH session first": "请先连接一个 SSH 会话", "Retry All Failed": "一键重试失败项", "Transfer Queue": "传输队列", "Filter filenames…": "过滤文件名…", "Connected": "已连接", "Disconnected": "已断开", "Copied to clipboard": "已复制到剪贴板", "Enter a new name": "请输入新名称", "Folder created": "已创建文件夹", "Delete this saved connection profile?": "删除这条已保存的连接配置吗？", "Overwrite the existing remote item?": "确认覆盖远程同名文件或目录吗？"}));
const textSources = new WeakMap();
const attrSources = new WeakMap();
function normalizeSourceText(raw) {
  const source = String(raw ?? '');
  // Normalize known English strings even after the target has changed to Chinese.
  // applyLanguage changes currentLanguage before this walk; gating by currentLanguage caused the switch-back race.
  const trimmed = source.trim();
  let chinese = englishSourceAliases.get(trimmed) || uniqueEnglishToChinese.get(trimmed) || uniqueDynamicEnglishToChinese.get(trimmed);
  if (!chinese) {
    const m = trimmed.match(/^(\d+) selected$/);
    if (m) chinese = '已选择 ' + m[1] + ' 项';
  }
  if (!chinese) {
    const m = trimmed.match(/^Remote directory: (.+) · (\d+) items$/);
    if (m) chinese = '远程目录：' + m[1] + ' · ' + m[2] + ' 项';
  }
  if (!chinese) {
    for (const [zh, en] of DYNAMIC_EN) {
      if (en && trimmed.startsWith(en)) {
        const reverseMatches = DYNAMIC_EN.filter(pair => pair[1] === en);
        if (reverseMatches.length === 1) { chinese = zh + trimmed.slice(en.length); break; }
      }
    }
  }
  if (!chinese) return source;
  return source === trimmed ? chinese : source.replace(trimmed, chinese);
}
function translateText(source) {
  const original = String(source ?? '');
  if (currentLanguage !== 'en') return original;
  const trimmed = original.trim();
  if (Object.prototype.hasOwnProperty.call(I18N_EN, trimmed)) {
    const translated = I18N_EN[trimmed];
    return original === trimmed ? translated : original.replace(trimmed, translated);
  }
  const selectedMatch = trimmed.match(/^已选择\s*(\d+)\s*项$/);
  if (selectedMatch) return original.replace(trimmed, 'Selected ' + selectedMatch[1] + ' item(s)');
  const remoteSummaryMatch = trimmed.match(/^远程目录：(.+) · (\d+) 项$/);
  if (remoteSummaryMatch) return original.replace(trimmed, 'Remote directory: ' + remoteSummaryMatch[1] + ' · ' + remoteSummaryMatch[2] + ' items');
  let result = original;
  for (const [zh, en] of DYNAMIC_EN) result = result.replaceAll(zh, en);
  result = result.replace(/已选择\s*(\d+)\s*项/g, 'Selected $1 item(s)')
    .replace(/已上传\s*(\d+)\s*个文件或文件夹到\s*/g, 'Uploaded $1 item(s) to ')
    .replace(/已下载\s*(\d+)\s*个文件或文件夹到\s*/g, 'Downloaded $1 item(s) to ')
    .replace(/准备上传\s*(\d+)\s*个文件或文件夹到\s*/g, 'Preparing upload of $1 item(s) to ')
    .replace(/准备下载\s*(\d+)\s*个文件或文件夹到\s*/g, 'Preparing download of $1 item(s) to ')
    .replace(/([0-9.]+)\s*个文件到\s*/g, '$1 file(s) to ')
    .replace(/(\d+) 个 SSH 会话/g, '$1 SSH session(s)')
    .replace(/已选择 (\d+) 项/g, '$1 selected');
  return result;
}
function t(text) { return translateText(text); }
function localizeTree(root = document.body) {
  if (!root) return;
  if (root.nodeType === Node.ELEMENT_NODE && (root.id === 'terminal' || root.closest?.('#terminal'))) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest('#terminal') || ['SCRIPT','STYLE'].includes(node.parentElement?.tagName)) continue;
    if (!textSources.has(node)) textSources.set(node, { source: normalizeSourceText(node.nodeValue), written: null });
    const rec = textSources.get(node);
    if (rec.written !== null && node.nodeValue !== rec.written) rec.source = normalizeSourceText(node.nodeValue);
    const translated = translateText(rec.source);
    if (node.nodeValue !== translated) { rec.written = translated; node.nodeValue = translated; } else rec.written = translated;
  }
  const elements = root.querySelectorAll ? [root, ...root.querySelectorAll('*')] : [];
  for (const el of elements) {
    if (!el?.getAttribute) continue;
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      if (!el.hasAttribute(attr)) continue;
      let attrs = attrSources.get(el); if (!attrs) { attrs = new Map(); attrSources.set(el, attrs); }
      if (!attrs.has(attr)) attrs.set(attr, { source: normalizeSourceText(el.getAttribute(attr)), written: null });
      const rec = attrs.get(attr), now = el.getAttribute(attr);
      if (rec.written !== null && now !== rec.written) rec.source = normalizeSourceText(now);
      const translated = translateText(rec.source);
      if (now !== translated) el.setAttribute(attr, translated);
      rec.written = translated;
    }
  }
  document.documentElement.lang = currentLanguage === 'en' ? 'en' : 'zh-CN';
}
function updateLanguageButtons() {
  const english = currentLanguage === 'en';
  $('language-zh-btn')?.classList.toggle('active', !english);
  $('language-en-btn')?.classList.toggle('active', english);
  $('language-zh-btn')?.setAttribute('aria-pressed', !english ? 'true' : 'false');
  $('language-en-btn')?.setAttribute('aria-pressed', english ? 'true' : 'false');
}
function applyLanguage(lang, refreshDynamic = false) {
  currentLanguage = lang === 'en' ? 'en' : 'zh';
  updateLanguageButtons();
  localStorage.setItem('n1pilot.language', currentLanguage);
  document.documentElement.lang = currentLanguage === 'en' ? 'en' : 'zh-CN';
  document.title = 'N1PilotDesktop - by Edison';
  try { void window.pilot.setAppLanguage(currentLanguage).catch(() => {}); } catch {}
  localizeTree(document.body);
  try { refreshRemotePropertiesDialogLanguage(); } catch (e) { console.error('language.refresh.remote-properties', e); }
  if (refreshDynamic) {
    try { renderTabs(); } catch (e) { console.error('language.refresh.ssh-tabs', e); }
    try { renderFileList('local'); } catch (e) { console.error('language.refresh.local', e); }
    try { renderFileList('remote'); } catch (e) { console.error('language.refresh.remote', e); }
    try { renderTransferQueue(); } catch (e) { console.error('language.refresh.queue', e); }
    try { setTopStatus(); } catch (e) { console.error('language.refresh.top-status', e); }
    try { updateSftpButtons(); } catch (e) { console.error('language.refresh.sftp-buttons', e); }
    sftpDebug('language.changed', { language: currentLanguage });
  }
  updateLanguageButtons();
  void loadSshProfiles($('ssh-profile-select')?.value || '');
  try { updateSftpButtons(); } catch {}
}
$('language-zh-btn')?.addEventListener('click', () => { sftpDebug('language.button.click', { button: 'zh' }); applyLanguage('zh', true); });
$('language-en-btn')?.addEventListener('click', () => { sftpDebug('language.button.click', { button: 'en' }); applyLanguage('en', true); });
const domLocalizer = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'characterData') localizeTree(record.target.parentElement || document.body);
    else if (record.type === 'attributes') localizeTree(record.target);
    else for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) localizeTree(node);
      else if (node.nodeType === Node.TEXT_NODE) localizeTree(node.parentElement || document.body);
    }
  }
});
domLocalizer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
localizeTree(document.body);
updateLanguageButtons();
try { void window.pilot.setAppLanguage(currentLanguage).catch(() => {}); } catch {}


installGlobalDragDiagnostics();
window.pilot.on('sftp:drag-status', status => { sftpDebug('native-drag.status',{status}); $('transfer-status').textContent = status; });
useActiveAndUpdate();
void initializeDebugSettings();
initializeProxySettings();
loadSshProfiles();
window.pilot.localHome().then((home) => loadLocalDirectory(home)).catch((e) => { $('transfer-status').textContent = `初始化本地目录失败：${e.message || e}`; });
