const { app, BrowserWindow, ipcMain, dialog, shell, session: electronSession, safeStorage, screen } = require('electron');
const path = require('path');
const os = require('os');
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const { execFile, spawn } = require('child_process');
const { Client } = require('ssh2');
const iconv = require('iconv-lite');
const YAML = require('yaml');
const { diffLines, diffArrays } = require('diff');

let win;
const sessions = new Map();
const editorWindows = new Map();
const MAX_EDITOR_BYTES = 2 * 1024 * 1024;
const SFTP_CHANNEL_OPEN_TIMEOUT_MS = 15000;
const SFTP_METADATA_TIMEOUT_MS = 20000;
const EDITOR_STREAM_TIMEOUT_MS = 30000;
let pendingHost = null;
let knownHosts = {};
let shuttingDown = false;
let appQuitAfterDraftFlush = false;
let appQuitDiscardingDrafts = false;
let appQuitWaitingForDraftFlush = false;
let pendingEditorDraftFlush = new Set();
let appQuitDraftFlushTimer = null;
let baseWindowBounds = null;
let sftpExpanded = false;
const CHATGPT_URL = 'https://chatgpt.com/';
const CHAT_PARTITION = 'persist:chatgpt';
const DEFAULT_PROXY = { enabled: true, type: 'socks5', host: '127.0.0.1', port: 10808 };
let chatProxyConfig = { ...DEFAULT_PROXY };

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function knownHostsPath() { return path.join(app.getPath('userData'), 'known-hosts.json'); }
function proxySettingsPath() { return path.join(app.getPath('userData'), 'chat-proxy-settings.json'); }
function sshProfilesPath() { return path.join(app.getPath('userData'), 'ssh-profiles.json'); }
function appLanguagePath() { return path.join(app.getPath('userData'), 'ui-language.json'); }
function debugSettingsPath() { return path.join(app.getPath('userData'), 'debug-settings.json'); }
let debugEnabled = true;
function loadDebugSettings() { const settings = readJson(debugSettingsPath(), {}); debugEnabled = typeof settings.enabled === 'boolean' ? settings.enabled : true; }
function debugLogPath() { return path.join(app.getPath('userData'), 'logs', 'sftp-debug.log'); }
function writeDebugRecord(source, action, details = {}) {
  if (!debugEnabled) return;
  try {
    const file = debugLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { if (fs.existsSync(file) && fs.statSync(file).size >= 5 * 1024 * 1024) {
      for (let i = 3; i >= 1; i--) { const from = i === 1 ? file : `${file}.${i - 1}`; const to = `${file}.${i}`; if (fs.existsSync(from)) { if (fs.existsSync(to)) fs.unlinkSync(to); fs.renameSync(from, to); } }
    } } catch {}
    const line = JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, source, action, details });
    fs.appendFileSync(file, line + '\n', 'utf8');
    if (process.env.N1PILOT_DEBUG_CONSOLE === '1') console.log(line);
  } catch (error) { console.error('Failed to write N1Pilot DEBUG log', error); }
}
let appLanguage = 'zh';
function loadAppLanguage() { const data = readJson(appLanguagePath(), {}); appLanguage = data.language === 'en' ? 'en' : 'zh'; }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 }); }
function sanitizeProxyConfig(raw = {}) {
  const type = String(raw.type || DEFAULT_PROXY.type).toLowerCase();
  if (!['socks5', 'http'].includes(type)) throw new Error('代理类型只支持 SOCKS5 或 HTTP');
  const host = String(raw.host || '').trim().replace(/^\[|\]$/g, '');
  const port = Number(raw.port || DEFAULT_PROXY.port);
  if (!host || /[\s\/@?#]/.test(host)) throw new Error('代理地址无效，请只填写主机名或 IP，不要包含协议和斜杠');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('代理端口必须是 1–65535 的整数');
  return { enabled: raw.enabled !== false, type, host, port };
}
function proxyAddress(host) { return String(host).includes(':') && !String(host).startsWith('[') ? `[${host}]` : String(host); }
async function applyProxyConfig(raw, persist = true) {
  const cfg = sanitizeProxyConfig(raw);
  const chatSession = electronSession.fromPartition(CHAT_PARTITION);
  if (cfg.enabled) {
    await chatSession.setProxy({ proxyRules: `${cfg.type}://${proxyAddress(cfg.host)}:${cfg.port}` });
  } else {
    await chatSession.setProxy({ mode: 'direct' });
  }
  if (typeof chatSession.closeAllConnections === 'function') await chatSession.closeAllConnections();
  chatProxyConfig = cfg;
  if (persist) {
    try {
      fs.mkdirSync(path.dirname(proxySettingsPath()), { recursive: true });
      fs.writeFileSync(proxySettingsPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
    } catch (err) { send('app:log', `代理设置无法保存：${err.message}`); }
  }
  return { ...cfg };
}
function loadProxySettings() {
  try { chatProxyConfig = sanitizeProxyConfig(JSON.parse(fs.readFileSync(proxySettingsPath(), 'utf8'))); }
  catch { chatProxyConfig = { ...DEFAULT_PROXY }; }
}
function readKnownHosts() { try { knownHosts = JSON.parse(fs.readFileSync(knownHostsPath(), 'utf8')); } catch { knownHosts = {}; } }
function saveKnownHosts() {
  try { fs.mkdirSync(path.dirname(knownHostsPath()), { recursive: true }); fs.writeFileSync(knownHostsPath(), JSON.stringify(knownHosts, null, 2), { mode: 0o600 }); }
  catch (e) { send('app:log', `无法保存主机指纹：${e.message}`); }
}
function hostId(cfg) { return `${String(cfg.host).trim().toLowerCase()}:${Number(cfg.port || 22)}`; }

function logWindowGeometry(action, extra = {}) {
  if (!win || win.isDestroyed()) return;
  try {
    writeDebugRecord('main', action, {
      bounds: win.getBounds(), contentBounds: win.getContentBounds(),
      maximized: win.isMaximized(), minimized: win.isMinimized(), fullScreen: win.isFullScreen(), visible: win.isVisible(),
      sftpExpanded, baseWindowBounds: baseWindowBounds ? { ...baseWindowBounds } : null, ...extra
    });
  } catch (error) { writeDebugRecord('main', 'window.geometry-log-error', { action, error: error?.stack || String(error) }); }
}

function finishEditorDraftFlush(success, message = '') {
  clearTimeout(appQuitDraftFlushTimer); appQuitDraftFlushTimer = null;
  appQuitWaitingForDraftFlush = false; pendingEditorDraftFlush.clear();
  writeDebugRecord('editor', 'app-quit.draft-flush-finished', { success: !!success, message: success ? '' : String(message).slice(0, 500) });
  if (!success) {
    appQuitAfterDraftFlush = false;
    try { dialog.showMessageBoxSync(win, { type: 'error', buttons: [appLanguage === 'en' ? 'OK' : '确定'], title: appLanguage === 'en' ? 'Could not save recovery drafts' : '无法保存恢复草稿', message: appLanguage === 'en' ? 'Quit was cancelled because one or more editor drafts could not be safely saved. Keep the editor windows open and check the DEBUG log.' : '有编辑器恢复草稿未能可靠保存，已取消退出。请保持编辑器窗口打开并检查 DEBUG 日志。', detail: String(message || '') }); } catch {}
    return;
  }
  appQuitAfterDraftFlush = true;
  if (win && !win.isDestroyed()) win.close();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 980, minWidth: 1180, minHeight: 720, frame: false,
    title: 'N1PilotDesktop    - by Edison', icon: path.join(__dirname, 'assets', 'n1pilot.ico'), backgroundColor: '#0b1020', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true }
  });
  baseWindowBounds = win.getBounds();
  logWindowGeometry('window.created');
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => logWindowGeometry('window.renderer-loaded'));
  win.webContents.on('render-process-gone', (_event, details) => writeDebugRecord('main', 'app.render-process-gone', details || {}));
  win.on('resize', () => {
    if (!sftpExpanded && win && !win.isDestroyed()) baseWindowBounds = win.getBounds();
    logWindowGeometry('window.resize');
  });
  for (const eventName of ['maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen', 'show', 'hide']) {
    win.on(eventName, () => logWindowGeometry(`window.${eventName}`));
  }
  win.on('close', (event) => {
    if (shuttingDown) return;
    const dirtyEditors = [...editorWindows.values()].filter((context) => context.dirty && !context.window.isDestroyed());
    if (dirtyEditors.length && !appQuitAfterDraftFlush && !appQuitDiscardingDrafts) {
      const names = dirtyEditors.slice(0, 8).map((context) => path.posix.basename(context.remotePath)).join(', ');
      const activeSaveCount = dirtyEditors.reduce((sum, context) => sum + (context.activeSaveOperations?.size || 0), 0);
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: appLanguage === 'en'
          ? ['Cancel Quit', 'Save Drafts and Quit', 'Discard Drafts and Quit']
          : ['取消退出', '保存草稿并退出', '不保存草稿直接退出'],
        defaultId: 0, cancelId: 0,
        title: appLanguage === 'en' ? 'Unsaved remote files' : '远程文件尚未保存',
        message: appLanguage === 'en'
          ? `${dirtyEditors.length} editor window(s) have unsaved changes.${activeSaveCount ? ` ${activeSaveCount} remote save operation(s) are still in progress; their final server-side outcome may be uncertain if you discard and quit.` : ''}`
          : `有 ${dirtyEditors.length} 个编辑器窗口存在未保存修改。${activeSaveCount ? `另有 ${activeSaveCount} 个远程保存操作尚未结束；直接退出后，服务器端最终结果可能无法确认。` : ''}`,
        detail: names
      });
      writeDebugRecord('editor', 'app-quit.unsaved-choice', {
        choice: choice === 0 ? 'cancel' : choice === 1 ? 'save-drafts-and-quit' : 'discard-drafts-and-quit',
        dirtyEditorCount: dirtyEditors.length,
        editorNames: dirtyEditors.slice(0, 8).map((context) => path.posix.basename(context.remotePath)), activeSaveCount
      });
      if (choice === 0) { event.preventDefault(); return; }
      if (choice === 2) {
        event.preventDefault();
        appQuitDiscardingDrafts = true;
        appQuitAfterDraftFlush = false;
        setImmediate(() => {
          if (win && !win.isDestroyed()) {
            writeDebugRecord('editor', 'app-quit.discard-path-reenter');
            win.close();
          }
        });
        return;
      }
      event.preventDefault();
      if (appQuitWaitingForDraftFlush) return;
      appQuitWaitingForDraftFlush = true;
      pendingEditorDraftFlush = new Set(dirtyEditors.map((context) => context.window.webContents.id));
      writeDebugRecord('editor', 'app-quit.draft-flush-begin', { editorCount: pendingEditorDraftFlush.size });
      for (const context of dirtyEditors) {
        try { context.window.webContents.send('editor:flush-draft-and-quit'); }
        catch (error) { writeDebugRecord('editor', 'app-quit.draft-flush-send-failed', { editorId: context.editorId, error: String(error) }); finishEditorDraftFlush(false, `${path.posix.basename(context.remotePath)}: ${String(error?.message || error)}`); return; }
      }
      if (!pendingEditorDraftFlush.size) finishEditorDraftFlush(false, 'No editor acknowledged the draft flush.');
      else {
        clearTimeout(appQuitDraftFlushTimer);
        appQuitDraftFlushTimer = setTimeout(() => finishEditorDraftFlush(false, 'Timed out waiting for editor recovery drafts.'), 10000);
        appQuitDraftFlushTimer.unref?.();
      }
      return;
    }
    if (sessions.size) {
      const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: appLanguage === 'en' ? ['Cancel', 'Disconnect all SSH and Quit'] : ['取消', '断开所有 SSH 并退出'], defaultId: 0, cancelId: 0, title: appLanguage === 'en' ? 'Quit N1PilotDesktop' : '退出程序', message: appLanguage === 'en' ? `${sessions.size} SSH session(s) are still open. Disconnect them and quit?` : `当前有 ${sessions.size} 个 SSH 会话。确定断开并退出吗？` });
      if (choice === 0) { event.preventDefault(); appQuitAfterDraftFlush = false; appQuitDiscardingDrafts = false; writeDebugRecord('main', 'app-quit.cancelled-by-open-ssh-sessions', { sessionCount: sessions.size }); return; }
    }
    shuttingDown = true;
    writeDebugRecord('main', 'app-quit.begin', { discardDrafts: appQuitDiscardingDrafts, editorCount: editorWindows.size, sessionCount: sessions.size });
    for (const context of editorWindows.values()) {
      if (appQuitDiscardingDrafts) {
        try { deleteEditorDraft(context); } catch (error) { writeDebugRecord('editor', 'app-quit.discard-draft-delete-error', { editorId: context.editorId, error: String(error?.message || error) }); }
        context.dirty = false;
      }
      context.closeAuthorized = true;
      try { if (!context.window.isDestroyed()) context.window.close(); } catch {}
    }
    for (const session of sessions.values()) { try { if (session.channel) session.channel.close(); } catch {} try { if (session.interactiveShell) session.interactiveShell.close(); } catch {} try { session.client.end(); } catch {} }
    sessions.clear();
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => { try { if (new URL(url).protocol === 'https:') return { action: 'allow' }; } catch {} return { action: 'deny' }; });
  });
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    try { const u = new URL(params.src || CHATGPT_URL); if (u.protocol !== 'https:' || u.hostname !== 'chatgpt.com') event.preventDefault(); }
    catch { event.preventDefault(); }
    webPreferences.nodeIntegration = false; webPreferences.contextIsolation = true; webPreferences.sandbox = true; webPreferences.partition = CHAT_PARTITION;
  });
}
app.whenReady().then(async () => {
  readKnownHosts();
  loadProxySettings();
  loadAppLanguage();
  loadDebugSettings();
  writeDebugRecord('main', 'app.debug-session-start', { appVersion: app.getVersion(), electronVersion: process.versions.electron, platform: process.platform, arch: process.arch, debugEnabled });
  app.on('child-process-gone', (_event, details) => writeDebugRecord('main', 'app.child-process-gone', details || {}));
  // Monitor uncaught exceptions without replacing Node's default crash/exit behavior.
  process.on('uncaughtExceptionMonitor', (error, origin) => writeDebugRecord('main', 'process.uncaughtExceptionMonitor', { origin, error: error?.stack || String(error) }));
  process.on('unhandledRejection', (reason) => { writeDebugRecord('main', 'process.unhandledRejection', { reason: reason?.stack || String(reason) }); setImmediate(() => { throw reason instanceof Error ? reason : new Error(String(reason)); }); });
  try { await applyProxyConfig(chatProxyConfig, false); }
  catch (err) { send('app:log', `初始化 GPT 代理失败：${err.message}`); }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('app:set-language', async (_event, language) => {
  appLanguage = language === 'en' ? 'en' : 'zh';
  writeJson(appLanguagePath(), { language: appLanguage });
  for (const context of editorWindows.values()) { try { if (!context.window.isDestroyed()) context.window.webContents.send('editor:language', appLanguage); } catch {} }
  return { language: appLanguage };
});
ipcMain.handle('chat:get-proxy', async () => ({ ...chatProxyConfig }));
ipcMain.handle('chat:apply-proxy', async (_event, raw) => applyProxyConfig(raw, true));

function loadSshProfilesRaw() { return readJson(sshProfilesPath(), []); }
function saveSshProfile(raw) {
  const cfg = {
    host: String(raw?.host || '').trim(), port: Number(raw?.port || 22),
    username: String(raw?.username || '').trim(), password: String(raw?.password || ''),
    useProxy: raw?.useProxy === true,
    proxy: raw?.useProxy === true ? sanitizeProxyConfig({ ...(raw?.proxy || {}), enabled: true }) : null
  };
  if (!cfg.host || !cfg.username) throw new Error('请先填写服务器地址和账号');
  if (!cfg.password) throw new Error('SSH 密码不能为空');
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error('SSH 端口无效');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统的安全存储不可用，无法安全保存 SSH 密码');
  const key = `${cfg.username}@${cfg.host}:${cfg.port}`;
  const profiles = loadSshProfilesRaw().filter((p) => p.key !== key);
  profiles.unshift({ key, host: cfg.host, port: cfg.port, username: cfg.username, encryptedPassword: safeStorage.encryptString(cfg.password).toString('base64'), useProxy: cfg.useProxy, proxy: cfg.proxy, updatedAt: Date.now() });
  writeJson(sshProfilesPath(), profiles.slice(0, 100));
  return { ok: true, profiles: profiles.slice(0, 100).map(({ encryptedPassword, ...p }) => p) };
}
ipcMain.handle('ssh:profiles:list', async () => loadSshProfilesRaw().map((p) => {
  let password = '';
  try { if (p.encryptedPassword && safeStorage.isEncryptionAvailable()) password = safeStorage.decryptString(Buffer.from(p.encryptedPassword, 'base64')); } catch {}
  return { key: p.key, host: p.host, port: p.port, username: p.username, password, useProxy: p.useProxy === true, proxy: p.proxy || null, updatedAt: p.updatedAt || 0 };
}));
ipcMain.handle('ssh:profiles:save', async (_event, cfg) => saveSshProfile(cfg));
ipcMain.handle('ssh:profiles:delete', async (_event, key) => {
  writeJson(sshProfilesPath(), loadSshProfilesRaw().filter((p) => p.key !== String(key || ''))); return { ok: true };
});
ipcMain.handle('window:set-sftp-expanded', async (_event, expanded) => {
  if (!win || win.isDestroyed()) return { ok: false };
  const shouldExpand = Boolean(expanded);
  writeDebugRecord('main', 'window.sftp-expand.request', { requestedExpanded: shouldExpand, currentExpanded: sftpExpanded, bounds: win.getBounds() });
  if (shouldExpand === sftpExpanded) return { width: win.getBounds().width, expanded: sftpExpanded };
  if (shouldExpand) {
    baseWindowBounds = win.getBounds();
    sftpExpanded = true;
    const display = screen.getDisplayMatching(baseWindowBounds).workArea;
    const baseWidth = baseWindowBounds.width || 1600;
    const desiredWidth = Math.min(baseWidth + 760, Math.max(baseWidth, display.width - 24));
    let x = baseWindowBounds.x;
    if (x + desiredWidth > display.x + display.width) x = Math.max(display.x, display.x + display.width - desiredWidth);
    win.setBounds({ x, y: baseWindowBounds.y, width: desiredWidth, height: baseWindowBounds.height }, true);
    logWindowGeometry('window.sftp-expand.applied', { expanded: true, desiredWidth });
    return { width: desiredWidth, expanded: true };
  }
  sftpExpanded = false;
  const restore = baseWindowBounds || win.getBounds();
  win.setBounds({ x: restore.x, y: restore.y, width: restore.width, height: restore.height }, true);
  logWindowGeometry('window.sftp-expand.applied', { expanded: false, restoredBounds: restore });
  return { width: restore.width, expanded: false };
});
ipcMain.handle('window:minimize', () => { if (win) win.minimize(); return true; });
ipcMain.handle('window:toggle-maximize', () => { if (!win) return false; if (win.isMaximized()) win.unmaximize(); else win.maximize(); return win.isMaximized(); });
ipcMain.handle('window:close', () => { if (win) win.close(); return true; });

function createProxyTunnel(proxy, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    let stage = proxy.type === 'http' ? 'http' : 'greeting';
    let buffer = Buffer.alloc(0);
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(message));
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      socket.removeListener('data', onData);
      socket.removeListener('timeout', onTimeout);
      // Keep a harmless error listener during the hand-off to ssh2.
      socket.on('error', () => {});
      socket.setTimeout(0);
      resolve(socket);
    };
    const onTimeout = () => fail('连接代理超时，请检查代理地址、端口和 V2RayN/N1 代理服务');
    const targetRequest = () => {
      const host = String(targetHost);
      const ipVersion = net.isIP(host);
      let address;
      if (ipVersion === 4) {
        address = Buffer.from(host.split('.').map((part) => Number(part)));
      } else {
        const hostBytes = Buffer.from(host, 'utf8');
        if (!hostBytes.length || hostBytes.length > 255) throw new Error('SSH 目标主机名过长');
        address = Buffer.concat([Buffer.from([hostBytes.length]), hostBytes]);
      }
      const atyp = ipVersion === 4 ? 0x01 : 0x03;
      return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, atyp]), address, Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])]);
    };
    const onData = (chunk) => {
      if (settled) return;
      buffer = Buffer.concat([buffer, chunk]);
      try {
        while (!settled) {
          if (stage === 'http') {
            const end = buffer.indexOf('\r\n\r\n');
            if (end < 0) return;
            const header = buffer.subarray(0, end).toString('latin1');
            if (!/^HTTP\/1\.[01] 200(?:\s|$)/i.test(header.split('\r\n')[0])) {
              return fail(`HTTP 代理拒绝 CONNECT：${header.split('\r\n')[0] || '没有有效响应'}`);
            }
            const remainder = buffer.subarray(end + 4);
            if (remainder.length) socket.unshift(remainder);
            succeed();
            return;
          }
          if (stage === 'greeting') {
            if (buffer.length < 2) return;
            if (buffer[0] !== 0x05 || buffer[1] !== 0x00) return fail(buffer[0] === 0x05 && buffer[1] === 0xff ? 'SOCKS5 代理要求认证或拒绝无认证连接；本版本支持无认证代理' : 'SOCKS5 代理握手失败');
            buffer = buffer.subarray(2);
            stage = 'reply';
            socket.write(targetRequest());
            continue;
          }
          if (stage === 'reply') {
            if (buffer.length < 5) return;
            if (buffer[0] !== 0x05) return fail('SOCKS5 返回了无效响应');
            if (buffer[1] !== 0x00) return fail(`SOCKS5 无法连接 SSH 目标（错误码 ${buffer[1]}）`);
            let addressLength;
            if (buffer[3] === 0x01) addressLength = 4;
            else if (buffer[3] === 0x04) addressLength = 16;
            else if (buffer[3] === 0x03) { if (buffer.length < 5) return; addressLength = buffer[4] + 1; }
            else return fail('SOCKS5 返回了未知地址类型');
            const total = 4 + addressLength + 2;
            if (buffer.length < total) return;
            const remainder = buffer.subarray(total);
            if (remainder.length) socket.unshift(remainder);
            succeed();
            return;
          }
        }
      } catch (err) { fail(`代理握手失败：${err.message}`); }
    };
    socket.setTimeout(12000);
    socket.on('timeout', onTimeout);
    socket.on('error', (err) => fail(`连接代理失败：${err.message}`));
    socket.on('close', () => { if (!settled) fail('代理连接提前关闭'); });
    socket.on('data', onData);
    socket.on('connect', () => {
      if (proxy.type === 'http') {
        const host = String(targetHost).includes(':') ? `[${targetHost}]` : targetHost;
        socket.write(`CONNECT ${host}:${targetPort} HTTP/1.1\r\nHost: ${host}:${targetPort}\r\nProxy-Connection: Keep-Alive\r\n\r\n`);
      } else socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });
  });
}

function classifyCommand(command) {
  const c = String(command || '').trim();
  if (!c) return { level: 'blocked', reason: '命令为空', requiresConfirmation: false };
  if (/\0/.test(c)) return { level: 'blocked', reason: '命令包含无效控制字符', requiresConfirmation: false };
  if (c.length > 12000) return { level: 'blocked', reason: '命令过长（超过 12000 字符）', requiresConfirmation: false };
  if (c.split(/\r?\n/).length > 100) return { level: 'blocked', reason: '脚本超过 100 行，为防止误执行已拦截', requiresConfirmation: false };

  const never = [
    [/(?:cat|less|more|head|tail|sed|awk|grep|base64|xxd|hexdump)\b[^\n]*(?:\/root\/\.ssh\/(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)|\/etc\/shadow|\/etc\/gshadow)/i, '读取 SSH 私钥或系统密码文件'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, '包含私钥内容'],
    [/\b(?:printenv|env)\b\s*(?:$|[;|&])/i, '可能一次性输出全部环境变量和凭据']
  ];
  for (const [re, reason] of never) {
    if (re.test(c)) return { level: 'blocked', reason, requiresConfirmation: false };
  }

  const confirm = [
    [/\b(sysupgrade|mtd|ubiformat|flash_erase|nandwrite|fw_setenv)\b/i, '刷机或闪存写入'],
    [/\b(reboot|poweroff|halt)\b/i, '重启或关机'],
    [/\bmkfs(?:\.[a-z0-9]+)?\b|\b(parted|fdisk|wipefs)\b/i, '磁盘格式化或分区变更'],
    [/\bdd\b[^\n]*\bof\s*=\s*\/dev\//i, '向块设备直接写入'],
    [/\brm\s+-[^\n]*r[^\n]*f\s+\/(?:\s|\*|$)/i, '删除根目录内容'],
    [/\brm\s+-[^\n]*r[^\n]*f\b/i, '递归强制删除文件'],
    [/\b(nft\s+flush\s+ruleset|iptables\s+-F|ip6tables\s+-F)\b/i, '清空防火墙规则'],
    [/\b(ssh|scp|sftp|telnet|nc|netcat)\b/i, '连接其他主机或启动远程通信工具'],
    [/(curl|wget)[^\n]*\|\s*(sh|bash|ash)\b/i, '下载后直接执行远程脚本'],
    [/\bpasswd\b|\/etc\/(?:shadow|gshadow)/i, '修改账号密码或操作密码数据库'],
    [/\buci\s+(set|delete|commit)\s+network\b|\/etc\/init\.d\/network\s+(restart|reload)|\b(ifdown|ifup)\s+(wan|lan|br-lan)\b/i, '修改网络配置或重启网络，可能导致 SSH 失联'],
    [/\b(opkg|apk)\s+(remove|del|purge)\b/i, '卸载系统软件包'],
    [/\b(chmod|chown)\s+-R\b/i, '递归修改文件权限或所有权'],
    [/\b(?:sed\s+-i|tee|install|cp|mv|truncate|shred|rm|chmod|chown|touch|ln)\b[^\n]*(?:\/etc\/|\/usr\/|\/bin\/|\/sbin\/|\/boot\/|\/lib\/)|(?:>|>>|2>)\s*\/(?:etc|usr|bin|sbin|boot|lib)\//i, '修改、覆盖或删除系统文件及配置文件']
  ];
  for (const [re, reason] of confirm) {
    if (re.test(c)) return { level: 'confirm', reason, requiresConfirmation: true };
  }
  return { level: 'safe', reason: '未命中已知高风险规则', requiresConfirmation: false };
}


ipcMain.handle('ssh:inspect-command', async (_event, rawCommand) => classifyCommand(String(rawCommand || '')));

ipcMain.handle('ssh:connect', async (_event, raw) => {
  const cfg = {
    host: String(raw?.host || '').trim(),
    port: Number(raw?.port || 22),
    username: String(raw?.username || '').trim(),
    password: String(raw?.password || ''),
    useProxy: raw?.useProxy === true,
    proxy: raw?.useProxy === true ? sanitizeProxyConfig({ ...(raw?.proxy || {}), enabled: true }) : null
  };
  if (!cfg.host || !cfg.username) throw new Error('请填写服务器地址和账号');
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error('SSH 端口无效');
  if (!cfg.password) throw new Error('请填写 SSH 密码');

  const sessionId = String(raw?.connectionId || crypto.randomUUID());
  const tabId = String(raw?.tabId || sessionId);
  if (sessions.has(sessionId)) throw new Error('SSH connection ID already exists');
  const client = new Client();
  const session = { id: sessionId, tabId, client, cfg, connected: false, busy: false, channel: null, interactiveShell: null, interactiveShellPending: null, terminalSize: { cols: 80, rows: 24 }, proxySocket: null, cancelConnect: null, createdAt: Date.now() };
  sessions.set(sessionId, session);
  const id = hostId(cfg);
  const previouslyKnown = knownHosts[id];
  let thisPendingHost = null;
  send('ssh:status', { sessionId, tabId, connected: false, state: 'connecting', host: cfg.host, port: cfg.port, username: cfg.username, message: `正在连接 ${cfg.username}@${cfg.host}:${cfg.port}` });

  let proxySocket = null;
  return await new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(value);
    };
    const connectionTimer = setTimeout(() => {
      try { client.end(); } catch {}
      try { if (proxySocket) proxySocket.destroy(); } catch {}
      sessions.delete(sessionId);
      session.cancelConnect = null;
      done(new Error('SSH 连接超时（20 秒），请检查地址、端口、N1 是否在线以及 SSH 服务状态'));
    }, 20000);
    session.cancelConnect = () => {
      clearTimeout(connectionTimer);
      if (!settled) done(new Error('SSH connection cancelled'));
      session.cancelConnect = null;
      try { client.end(); } catch {}
      try { proxySocket?.destroy(); } catch {}
      try { session.proxySocket?.destroy(); } catch {}
    };

    client.on('ready', () => {
      clearTimeout(connectionTimer);
      session.cancelConnect = null;
      if (sessions.get(sessionId) !== session) { try { client.end(); } catch {} try { session.proxySocket?.destroy(); } catch {} return; }
      session.connected = true;
      send('ssh:status', { sessionId, tabId, connected: true, state: 'connected', host: cfg.host, port: cfg.port, username: cfg.username, message: `已连接 ${cfg.username}@${cfg.host}:${cfg.port}` });
      done(null, { ok: true, sessionId, tabId, host: cfg.host, port: cfg.port, username: cfg.username, message: 'SSH 连接成功' });
    });
    client.on('error', (err) => {
      clearTimeout(connectionTimer);
      session.cancelConnect = null;
      session.connected = false;
      if (thisPendingHost) {
        pendingHost = thisPendingHost;
        send('ssh:host-key-pending', pendingHost);
        done(new Error('请先核对 SSH 主机指纹并确认，再重新连接。'));
      } else {
        send('ssh:status', { sessionId, tabId, connected: false, state: 'error', host: cfg.host, port: cfg.port, username: cfg.username, message: `SSH 错误：${err.message}` });
        done(err);
      }
      sessions.delete(sessionId);
    });
    client.on('close', () => {
      clearTimeout(connectionTimer);
      session.cancelConnect = null;
      session.connected = false;
      session.channel = null;
      session.interactiveShell = null;
      session.interactiveShellPending = null;
      send('ssh:terminal:status', { sessionId: session.id, tabId: session.tabId, state: 'disconnected', message: 'SSH 连接已断开，交互式 Shell 已结束。' });
      try { session.proxySocket?.destroy(); } catch {}
      if (sessions.get(sessionId) === session) sessions.delete(sessionId);
      send('ssh:status', { sessionId, tabId, connected: false, state: 'disconnected', host: cfg.host, port: cfg.port, username: cfg.username, message: `SSH 会话已断开：${cfg.host}:${cfg.port}` });
      if (!settled) done(new Error('SSH 连接提前关闭'));
    });

    const sshOptions = {
      host: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password,
      readyTimeout: 16000, keepaliveInterval: 10000, keepaliveCountMax: 3, hostHash: 'sha256',
      hostVerifier: (fingerprint) => {
        const fp = String(fingerprint);
        if (previouslyKnown && previouslyKnown === fp) return true;
        thisPendingHost = { sessionId, tabId, id, host: cfg.host, port: cfg.port, fingerprint: fp, previousFingerprint: previouslyKnown || null, changed: Boolean(previouslyKnown && previouslyKnown !== fp) };
        send('ssh:host-key-pending', thisPendingHost);
        return false;
      }
    };
    const startSshHandshake = (sock = null) => {
      if (sock) sshOptions.sock = sock;
      client.connect(sshOptions);
    };
    if (cfg.useProxy) {
      createProxyTunnel(cfg.proxy, cfg.host, cfg.port).then((sock) => {
        if (sessions.get(sessionId) !== session) { try { sock.destroy(); } catch {} return; }
        proxySocket = sock;
        session.proxySocket = sock;
        startSshHandshake(sock);
      }).catch((err) => {
        clearTimeout(connectionTimer);
        session.cancelConnect = null;
        if (sessions.get(sessionId) !== session) return;
        sessions.delete(sessionId);
        send('ssh:status', { sessionId, tabId, connected: false, state: 'error', host: cfg.host, port: cfg.port, username: cfg.username, message: `SSH 代理连接失败：${err.message}` });
        done(err);
      });
    } else startSshHandshake();
  });
});

ipcMain.handle('ssh:trust-host', async (_event, fingerprint) => {
  if (!pendingHost || String(fingerprint) !== pendingHost.fingerprint) throw new Error('待确认的主机指纹不匹配');
  knownHosts[pendingHost.id] = pendingHost.fingerprint;
  saveKnownHosts();
  const trusted = { ...pendingHost };
  pendingHost = null;
  return { ok: true, message: `已保存 ${trusted.host}:${trusted.port} 的主机指纹。请再次点击“连接 SSH”。` };
});

ipcMain.handle('ssh:exec', async (_event, sessionId, rawCommand, rawTimeoutSeconds, approvedRisk = false, runId = '') => {
  const command = String(rawCommand || '').trim();
  const risk = classifyCommand(command);
  if (risk.level === 'blocked') throw new Error(`安全拦截：${risk.reason}`);
  if (risk.requiresConfirmation && approvedRisk !== true) throw new Error(`该命令需要人工确认：${risk.reason}`);
  const session = sessions.get(String(sessionId || ''));
  if (!session?.connected || !session.client) throw new Error('当前 SSH 会话尚未连接');
  if (session.busy) throw new Error('当前 SSH 会话已有命令正在执行，请等待它结束');
  session.busy = true;
  const timeoutMs = Math.max(5000, Math.min(300000, Number(rawTimeoutSeconds || 90) * 1000));

  return await new Promise((resolve, reject) => {
    const { client } = session;
    let stdout = '', stderr = '', finished = false, channel;
    const maxOutput = 100000;
    const emitChunk = (kind, buf) => {
      const data = buf.toString('utf8');
      if (kind === 'stdout' && stdout.length < maxOutput) stdout += data.slice(0, maxOutput - stdout.length);
      if (kind === 'stderr' && stderr.length < maxOutput) stderr += data.slice(0, maxOutput - stderr.length);
      send('ssh:output', { sessionId: session.id, tabId: session.tabId, runId, kind, text: data });
    };
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { if (channel) channel.close(); } catch {}
      session.channel = null;
      session.busy = false;
      reject(new Error(`命令执行超过 ${Math.round(timeoutMs / 1000)} 秒，SSH 命令通道已关闭；远端子进程不一定会被终止。已收到的输出仍保留在终端记录中。`));
    }, timeoutMs);
    const finish = (err, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      session.channel = null;
      session.busy = false;
      if (err) reject(err); else resolve(result);
    };
    client.exec(command, { pty: false }, (err, stream) => {
      if (err) return finish(err);
      channel = stream;
      session.channel = stream;
      stream.on('data', (buf) => emitChunk('stdout', buf));
      stream.stderr.on('data', (buf) => emitChunk('stderr', buf));
      stream.on('error', (e) => finish(e));
      stream.on('close', (code, signal) => finish(null, {
        sessionId: session.id, runId, command, exitCode: Number.isInteger(code) ? code : null, signal: signal || null,
        stdout, stderr, truncated: stdout.length >= maxOutput || stderr.length >= maxOutput
      }));
    });
  });
});

ipcMain.handle('ssh:terminal:start', async (_event, sessionId, rawCols = 80, rawRows = 24) => {
  const session = sessions.get(String(sessionId || ''));
  if (!session?.connected || !session.client) throw new Error('当前 SSH 会话尚未连接');
  const cols = Math.max(2, Math.min(500, Math.trunc(Number(rawCols) || 80)));
  const rows = Math.max(2, Math.min(300, Math.trunc(Number(rawRows) || 24)));
  writeDebugRecord('main', 'ssh.terminal.start-request', { sessionId: session.id, tabId: session.tabId, requestedCols: cols, requestedRows: rows, shellAlreadyOpen: !!(session.interactiveShell && !session.interactiveShell.destroyed), lastTerminalSize: session.terminalSize });
  session.terminalSize = { cols, rows };
  if (session.interactiveShell && !session.interactiveShell.destroyed) {
    try { session.interactiveShell.setWindow(rows, cols, 0, 0); writeDebugRecord('main', 'ssh.terminal.start-reused-existing-shell', { sessionId: session.id, tabId: session.tabId, cols, rows }); }
    catch (error) { writeDebugRecord('main', 'ssh.terminal.start-reused-shell-resize-error', { sessionId: session.id, tabId: session.tabId, cols, rows, error: error?.stack || String(error) }); }
    return { ok: true, alreadyRunning: true, cols, rows };
  }
  if (session.interactiveShellPending) return session.interactiveShellPending;

  const startPromise = new Promise((resolve, reject) => {
    let completed = false;
    const finish = (error, result) => {
      if (completed) return;
      completed = true;
      if (session.interactiveShellPending === startPromise) session.interactiveShellPending = null;
      if (error) reject(error); else resolve(result);
    };
    queueMicrotask(() => {
    try {
      session.client.shell({ term: 'xterm-256color', cols, rows, width: 0, height: 0 }, (error, stream) => {
        if (error) {
          writeDebugRecord('main', 'ssh.terminal.start-error', { sessionId: session.id, tabId: session.tabId, cols, rows, error: error?.stack || String(error) });
          send('ssh:terminal:status', { sessionId: session.id, tabId: session.tabId, state: 'error', message: `无法启动交互式 Shell：${error.message}` });
          return finish(error);
        }
        if (sessions.get(session.id) !== session || !session.connected) {
          try { stream.close(); } catch {}
          return finish(new Error('SSH 连接已变化，交互式 Shell 未启动'));
        }
        session.interactiveShell = stream;
        const terminalDecoder = new StringDecoder('utf8');
        stream.on('data', (buffer) => {
          if (sessions.get(session.id) !== session || session.interactiveShell !== stream) return;
          const data = terminalDecoder.write(buffer);
          if (data) send('ssh:terminal:data', { sessionId: session.id, tabId: session.tabId, data });
        });
        stream.on('error', (streamError) => {
          writeDebugRecord('main', 'ssh.terminal.stream-error', { sessionId: session.id, tabId: session.tabId, cols: session.terminalSize?.cols, rows: session.terminalSize?.rows, error: streamError?.stack || String(streamError) });
          send('ssh:terminal:status', { sessionId: session.id, tabId: session.tabId, state: 'error', message: `交互式终端错误：${streamError.message}` });
        });
        stream.on('close', (code, signal) => {
          const trailingData = terminalDecoder.end();
          if (trailingData) send('ssh:terminal:data', { sessionId: session.id, tabId: session.tabId, data: trailingData });
          if (session.interactiveShell === stream) session.interactiveShell = null;
          writeDebugRecord('main', 'ssh.terminal.stream-closed', { sessionId: session.id, tabId: session.tabId, code: Number.isInteger(code) ? code : null, signal: signal || null, terminalSize: session.terminalSize });
          send('ssh:terminal:status', { sessionId: session.id, tabId: session.tabId, state: 'closed', code: Number.isInteger(code) ? code : null, signal: signal || null, message: '交互式 Shell 已结束。' });
        });
        writeDebugRecord('main', 'ssh.terminal.shell-ready', { sessionId: session.id, tabId: session.tabId, cols, rows, terminalSize: session.terminalSize });
        send('ssh:terminal:status', { sessionId: session.id, tabId: session.tabId, state: 'ready', cols, rows, message: '交互式 Shell 已就绪。' });
        finish(null, { ok: true, cols, rows });
      });
    } catch (error) {
      finish(error);
    }
    });
  });
  session.interactiveShellPending = startPromise;
  return startPromise;
});

ipcMain.on('ssh:terminal:write', (event, sessionId, rawData) => {
  if (!win || event.sender.id !== win.webContents.id) return;
  const session = sessions.get(String(sessionId || ''));
  if (!session?.connected || !session.interactiveShell || session.interactiveShell.destroyed) return;
  const data = typeof rawData === 'string' ? rawData : '';
  if (!data || data.length > 4 * 1024 * 1024) return;
  try { session.interactiveShell.write(data); }
  catch (error) { send('ssh:terminal:status', { sessionId: session.id, tabId: session.tabId, state: 'error', message: `发送终端输入失败：${error.message}` }); }
});

ipcMain.on('ssh:terminal:resize', (event, sessionId, rawCols, rawRows) => {
  if (!win || event.sender.id !== win.webContents.id) return;
  const session = sessions.get(String(sessionId || ''));
  if (!session?.connected) return;
  const cols = Math.max(2, Math.min(500, Math.trunc(Number(rawCols) || 80)));
  const rows = Math.max(2, Math.min(300, Math.trunc(Number(rawRows) || 24)));
  const before = session.terminalSize ? { ...session.terminalSize } : null;
  const changed = !before || before.cols !== cols || before.rows !== rows;
  session.terminalSize = { cols, rows };
  if (changed) writeDebugRecord('main', 'ssh.terminal.pty-resize-request', { sessionId: session.id, tabId: session.tabId, before, requested: { cols, rows }, shellAvailable: !!(session.interactiveShell && !session.interactiveShell.destroyed) });
  if (!session.interactiveShell || session.interactiveShell.destroyed) return;
  try {
    session.interactiveShell.setWindow(rows, cols, 0, 0);
    if (changed) writeDebugRecord('main', 'ssh.terminal.pty-resize-applied', { sessionId: session.id, tabId: session.tabId, before, applied: { cols, rows } });
  } catch (error) {
    writeDebugRecord('main', 'ssh.terminal.pty-resize-error', { sessionId: session.id, tabId: session.tabId, before, requested: { cols, rows }, error: error?.stack || String(error) });
    send('ssh:terminal:status', { sessionId: session.id, tabId: session.tabId, state: 'error', message: `调整终端尺寸失败：${error.message}` });
  }
});

ipcMain.handle('ssh:disconnect', async (_event, sessionId) => {
  const session = sessions.get(String(sessionId || ''));
  if (!session) return { ok: true, message: '会话已不存在' };
  if (!session.connected) { try { session.cancelConnect?.(); } catch {} }
  try { if (session.channel) session.channel.close(); } catch {}
  try { if (session.interactiveShell) session.interactiveShell.close(); } catch {}
  session.interactiveShell = null;
  session.interactiveShellPending = null;
  try { session.proxySocket?.destroy(); } catch {}
  sessions.delete(session.id);
  try { session.client.end(); } catch {}
  session.connected = false;
  send('ssh:status', { sessionId: session.id, tabId: session.tabId, connected: false, state: 'disconnected', host: session.cfg.host, port: session.cfg.port, username: session.cfg.username, message: `已断开 ${session.cfg.host}:${session.cfg.port}` });
  return { ok: true };
});

function withSftp(sessionId, operation) {
  const normalizedSessionId = String(sessionId || '');
  const sshSession = sessions.get(normalizedSessionId);
  if (!sshSession?.connected || !sshSession.client) return Promise.reject(new Error('请先连接 SSH 会话'));
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      writeDebugRecord('sftp', 'channel.open.timeout', { sessionId: normalizedSessionId, elapsedMs: Date.now() - startedAt, timeoutMs: SFTP_CHANNEL_OPEN_TIMEOUT_MS });
      reject(new Error(`等待 SFTP 通道建立超时（${Math.round(SFTP_CHANNEL_OPEN_TIMEOUT_MS / 1000)} 秒）；SSH 主连接仍保留，请检查 DEBUG 日志。`));
    }, SFTP_CHANNEL_OPEN_TIMEOUT_MS);
    try {
      sshSession.client.sftp((err, sftp) => {
        // If the open callback arrives after the timeout, it must not leak a late channel.
        if (settled) { try { sftp?.end(); } catch {} return; }
        settled = true;
        clearTimeout(timer);
        if (err) {
          writeDebugRecord('sftp', 'channel.open.error', { sessionId: normalizedSessionId, elapsedMs: Date.now() - startedAt, error: err?.stack || String(err) });
          reject(err);
          return;
        }
        writeDebugRecord('sftp', 'channel.open.success', { sessionId: normalizedSessionId, elapsedMs: Date.now() - startedAt });
        Promise.resolve().then(() => operation(sftp)).then(resolve, reject).finally(() => {
          try { sftp.end(); } catch {}
        });
      });
    } catch (error) {
      if (!settled) { settled = true; clearTimeout(timer); }
      writeDebugRecord('sftp', 'channel.open.error', { sessionId: normalizedSessionId, elapsedMs: Date.now() - startedAt, error: error?.stack || String(error) });
      reject(error);
    }
  });
}

function normalizeRemotePath(rawPath) {
  const value = String(rawPath || '/').trim();
  if (value.includes('\0')) throw new Error('远程路径包含无效字符');
  return path.posix.resolve('/', value || '/');
}
function sftpStat(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error(`SFTP stat 超时（${Math.round(SFTP_METADATA_TIMEOUT_MS / 1000)} 秒）：${remotePath}`);
      error.code = 'N1PILOT_SFTP_STAT_TIMEOUT';
      writeDebugRecord('sftp', 'request.timeout', { method: 'stat', remotePath, elapsedMs: Date.now() - startedAt, timeoutMs: SFTP_METADATA_TIMEOUT_MS });
      reject(error);
    }, SFTP_METADATA_TIMEOUT_MS);
    try {
      sftp.stat(remotePath, (err, attrs) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!err) return resolve(attrs);
        if (err.code === 2 || /no such file|not found|enoent/i.test(String(err.message || ''))) return resolve(null);
        reject(err);
      });
    } catch (error) {
      if (!settled) { settled = true; clearTimeout(timer); }
      reject(error);
    }
  });
}
function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => sftp[method](...args, (err, value) => err ? reject(err) : resolve(value)));
}
function sftpReadCallWithTimeout(sftp, method, remotePath, timeoutMs = SFTP_METADATA_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error(`SFTP ${method} 超时（${Math.round(timeoutMs / 1000)} 秒）：${remotePath}`);
      error.code = 'N1PILOT_SFTP_READ_REQUEST_TIMEOUT';
      writeDebugRecord('sftp', 'request.timeout', { method, remotePath, elapsedMs: Date.now() - startedAt, timeoutMs });
      reject(error);
    }, timeoutMs);
    try {
      sftp[method](remotePath, (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) return reject(err);
        resolve(value);
      });
    } catch (error) {
      if (!settled) { settled = true; clearTimeout(timer); }
      reject(error);
    }
  });
}
function remoteIsDirectory(attrs) {
  if (!attrs) return false;
  if (typeof attrs.isDirectory === 'function') return attrs.isDirectory();
  return (Number(attrs.mode || 0) & 0o170000) === 0o040000;
}
function remoteIsFile(attrs) {
  if (!attrs) return false;
  if (typeof attrs.isFile === 'function') return attrs.isFile();
  return (Number(attrs.mode || 0) & 0o170000) === 0o100000;
}
function uniqueLocalPath(directory, filename) {
  const parsed = path.parse(filename);
  let candidate = path.join(directory, filename), index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name} (${index++})${parsed.ext}`);
  }
  return candidate;
}

function editorDraftDirectory() { return path.join(app.getPath('userData'), 'editor-drafts'); }
function editorDraftPath(id) {
  const value = String(id || '');
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error('编辑器草稿 ID 无效');
  return path.join(editorDraftDirectory(), `${value}.json`);
}
function editorIdentity(session, remotePath) {
  const cfg = session?.cfg || {};
  return crypto.createHash('sha256').update(JSON.stringify({ host: String(cfg.host || '').toLowerCase(), port: Number(cfg.port || 22), username: String(cfg.username || ''), remotePath })).digest('hex');
}
function editorWindowStatePath() { return path.join(app.getPath('userData'), 'editor-window-state.json'); }
function editorWindowStateKey(identity) { return String(identity || '').slice(0, 64); }
function getSavedEditorWindowState(identity) {
  const all = readJson(editorWindowStatePath(), {});
  const item = all[editorWindowStateKey(identity)];
  if (!item || typeof item !== 'object') return {};
  const width = Math.max(740, Math.min(2400, Math.trunc(Number(item.width) || 1180)));
  const height = Math.max(520, Math.min(1800, Math.trunc(Number(item.height) || 820)));
  let output = { width, height, maximized: item.maximized === true };
  if (Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y))) {
    const rect = { x: Number(item.x), y: Number(item.y), width, height };
    const visible = screen.getAllDisplays().some((display) => {
      const a = display.workArea;
      return rect.x < a.x + a.width - 80 && rect.x + rect.width > a.x + 80 && rect.y < a.y + a.height - 40 && rect.y + rect.height > a.y + 40;
    });
    if (visible) output = { ...output, x: rect.x, y: rect.y };
  }
  return output;
}
function saveEditorWindowState(context) {
  if (!context || context.closed || !context.window || context.window.isDestroyed()) return;
  const window = context.window;
  const key = editorWindowStateKey(context.identity);
  let all = readJson(editorWindowStatePath(), {});
  const prior = all[key] || {};
  const maximized = window.isMaximized();
  const bounds = maximized ? prior : window.getBounds();
  all[key] = {
    width: Math.max(740, Math.min(2400, Math.trunc(Number(bounds.width) || 1180))),
    height: Math.max(520, Math.min(1800, Math.trunc(Number(bounds.height) || 820))),
    x: Number.isFinite(Number(bounds.x)) ? Math.trunc(bounds.x) : undefined,
    y: Number.isFinite(Number(bounds.y)) ? Math.trunc(bounds.y) : undefined,
    maximized, updatedAt: Date.now()
  };
  const sorted = Object.entries(all).sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0)).slice(0, 60);
  all = Object.fromEntries(sorted);
  try { writeJson(editorWindowStatePath(), all); } catch (error) { writeDebugRecord('editor', 'window.state-save-error', { editorId: context.editorId, error: String(error?.message || error) }); }
  writeDebugRecord('editor', 'window.geometry', { editorId: context.editorId, bounds: window.getBounds(), maximized, minWidth: 740, minHeight: 520 });
}
function scheduleEditorWindowStateSave(context) {
  if (!context || context.closed || context.geometryTimer) return;
  const window = context.window;
  context.geometryTimer = setTimeout(() => {
    context.geometryTimer = null;
    if (context.closed || !window || window.isDestroyed()) return;
    try {
      if (!window.isMaximized() && !window.isMinimized()) saveEditorWindowState(context);
    } catch (error) {
      writeDebugRecord('editor', 'window.geometry-timer-error', { editorId: context.editorId, error: String(error?.message || error) });
    }
  }, 400);
  context.geometryTimer.unref?.();
}

function editorContextFor(event) {
  const context = editorWindows.get(event.sender.id);
  if (!context || context.closed || !context.window || context.window.isDestroyed() || context.window.webContents !== event.sender) throw new Error('编辑器窗口上下文已失效');
  return context;
}
function safeEditorDetails(context) { return { editorId: context.editorId, remotePath: context.remotePath, displayName: path.posix.basename(context.remotePath), sessionId: context.sessionId }; }
function remoteReadBuffer(sftp, remotePath, maximum = MAX_EDITOR_BYTES) {
  return new Promise((resolve, reject) => {
    let stream;
    try { stream = sftp.createReadStream(remotePath); } catch (error) { reject(error); return; }
    const startedAt = Date.now();
    const chunks = []; let size = 0; let settled = false;
    const timer = setTimeout(() => {
      const error = new Error(`读取远程文件超时（${Math.round(EDITOR_STREAM_TIMEOUT_MS / 1000)} 秒）：${remotePath}`);
      error.code = 'N1PILOT_SFTP_READ_TIMEOUT';
      fail(error);
    }, EDITOR_STREAM_TIMEOUT_MS);
    const fail = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      writeDebugRecord('sftp', 'stream.read.error', { remotePath, elapsedMs: Date.now() - startedAt, bytesRead: size, error: error?.stack || String(error) });
      try { stream.destroy(); } catch {}
      reject(error);
    };
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximum) { fail(new Error(`文件超过 ${Math.round(maximum / 1024 / 1024)} MiB 文本编辑限制，已停止读取以避免误操作`)); return; }
      chunks.push(Buffer.from(chunk));
    });
    stream.once('error', fail);
    stream.once('end', () => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      writeDebugRecord('sftp', 'stream.read.success', { remotePath, elapsedMs: Date.now() - startedAt, byteLength: size });
      resolve(Buffer.concat(chunks, size));
    });
  });
}
function detectAndDecodeEditorBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
  if (buffer.length > MAX_EDITOR_BYTES) throw new Error('文件超过 2 MiB 文本编辑限制，未打开');
  let encoding = 'utf8', bom = false, body = buffer;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) { encoding = 'utf8'; bom = true; body = buffer.subarray(3); }
  else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) { encoding = 'utf16le'; bom = true; body = buffer.subarray(2); }
  else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) { encoding = 'utf16be'; bom = true; body = buffer.subarray(2); }
  else if (buffer.length >= 4 && buffer.length % 2 === 0) {
    let evenZero = 0, oddZero = 0;
    for (let i = 0; i < Math.min(buffer.length, 4096); i++) if (buffer[i] === 0) (i % 2 ? oddZero++ : evenZero++);
    const half = Math.min(buffer.length, 4096) / 2;
    if (oddZero / half > 0.2 && evenZero / half < 0.05) encoding = 'utf16le';
    else if (evenZero / half > 0.2 && oddZero / half < 0.05) encoding = 'utf16be';
  }
  let content;
  if (encoding === 'utf16be') {
    const even = body.length % 2 ? body.subarray(0, body.length - 1) : body;
    const swapped = Buffer.from(even); swapped.swap16(); content = swapped.toString('utf16le');
  } else if (encoding === 'utf16le') {
    content = body.subarray(0, body.length - (body.length % 2)).toString('utf16le');
  } else {
    let isValidUtf8 = true;
    try { new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { isValidUtf8 = false; }
    if (isValidUtf8) content = body.toString('utf8');
    else { encoding = 'windows1252'; content = iconv.decode(body, 'windows-1252'); }
    const nullCount = (body.toString('latin1').match(/\x00/g) || []).length;
    const controlCount = (body.toString('latin1').match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g) || []).length;
    if (nullCount > 0 || (body.length > 0 && controlCount / body.length > 0.02)) throw new Error('该文件疑似二进制内容，不作为文本打开');
  }
  const eols = [];
  content.replace(/\r\n|\n|\r/g, (ending) => { eols.push(ending); return ending; });
  const counts = { '\n': 0, '\r\n': 0, '\r': 0 };
  for (const ending of eols) counts[ending]++;
  const mostCommon = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const defaultEol = mostCommon && mostCommon[1] ? mostCommon[0] : '\n';
  const used = Object.values(counts).filter((n) => n > 0).length;
  const eolLabel = used > 1 ? 'Mixed' : defaultEol === '\r\n' ? 'CRLF' : defaultEol === '\r' ? 'CR' : 'LF';
  const normalized = content.replace(/\r\n|\r/g, '\n');
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return { content: normalized, hash, encoding, bom, eols, defaultEol, eolLabel, byteLength: buffer.length };
}
async function readRemoteEditorSnapshot(sftp, remotePath) {
  const target = normalizeRemotePath(remotePath);
  const attrs = await sftpStat(sftp, target);
  if (!attrs) throw new Error(`远程文件不存在：${target}`);
  if (remoteIsDirectory(attrs)) throw new Error(`目标是文件夹，不是文本文件：${target}`);
  if (!remoteIsFile(attrs)) throw new Error('该远程项目不是普通文件，未打开');
  if (Number(attrs.size || 0) > MAX_EDITOR_BYTES) throw new Error('文件超过 2 MiB 文本编辑限制，未打开');
  const bytes = await remoteReadBuffer(sftp, target, MAX_EDITOR_BYTES);
  const decoded = detectAndDecodeEditorBuffer(bytes);
  return { ...decoded, metadata: { size: Number(attrs.size || bytes.length), mode: Number(attrs.mode || 0), modeAvailable: attrs.mode != null && Number.isFinite(Number(attrs.mode)), permissions: (Number(attrs.mode || 0) & 0o7777), uid: attrs.uid == null ? null : Number(attrs.uid), gid: attrs.gid == null ? null : Number(attrs.gid), atime: Number(attrs.atime || 0), mtime: Number(attrs.mtime || 0), isDirectory: remoteIsDirectory(attrs) } };
}
function editorEncodingName(encoding) {
  if (encoding === 'utf8') return 'utf8';
  if (encoding === 'windows1252') return 'windows-1252';
  if (encoding === 'latin1') return 'iso-8859-1';
  return null;
}
function encodeEditorContent(content, encoding, bom) {
  const text = String(content ?? ''); let body;
  if (encoding === 'utf8') body = Buffer.from(text, 'utf8');
  else if (encoding === 'utf16le') body = Buffer.from(text, 'utf16le');
  else if (encoding === 'utf16be') { body = Buffer.from(text, 'utf16le'); body.swap16(); }
  else {
    const name = editorEncodingName(encoding);
    if (!name || !iconv.encodingExists(name)) throw new Error(`不支持的编码：${encoding}`);
    body = iconv.encode(text, name);
    const roundTrip = iconv.decode(body, name);
    if (roundTrip !== text) throw new Error('所选编码无法表示部分字符。请改用 UTF-8，防止字符被替换。');
  }
  if (encoding === 'utf8' && bom) return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
  if (encoding === 'utf16le' && bom) return Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  if (encoding === 'utf16be' && bom) return Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
  return body;
}
function formatTextWithLineEndings(originalText, nextText, originalEols, fallbackEol, forcedEol = null) {
  const lines = String(nextText ?? '').split('\n');
  if (forcedEol && ['\n', '\r\n', '\r'].includes(forcedEol)) return lines.join(forcedEol);
  const previousLines = String(originalText ?? '').split('\n');
  const previousEols = Array.isArray(originalEols) ? originalEols : [];
  let oldLine = 0, newLine = 0, result = '';
  const changes = diffArrays(previousLines, lines);
  for (const part of changes) {
    if (part.removed) { oldLine += part.count; continue; }
    for (const line of part.value || []) {
      result += line;
      if (newLine < lines.length - 1) {
        const eol = part.added ? fallbackEol : (previousEols[oldLine] || fallbackEol);
        result += eol;
      }
      newLine++;
      if (!part.added) oldLine++;
    }
  }
  return result;
}
async function writeRemoteEditorBuffer(sftp, remotePath, buffer) {
  await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stream;
    try { stream = sftp.createWriteStream(remotePath, { flags: 'wx', mode: 0o600 }); }
    catch (error) { reject(error); return; }
    let settled = false;
    const timer = setTimeout(() => {
      const error = new Error(`写入远程临时文件超时（${Math.round(EDITOR_STREAM_TIMEOUT_MS / 1000)} 秒）：${remotePath}`);
      error.code = 'N1PILOT_SFTP_WRITE_TIMEOUT';
      fail(error);
    }, EDITOR_STREAM_TIMEOUT_MS);
    const fail = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      writeDebugRecord('sftp', 'stream.write.error', { remotePath, elapsedMs: Date.now() - startedAt, byteLength: buffer.length, error: error?.stack || String(error) });
      try { stream.destroy(); } catch {}
      reject(error);
    };
    stream.once('error', fail);
    stream.once('finish', () => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      writeDebugRecord('sftp', 'stream.write.success', { remotePath, elapsedMs: Date.now() - startedAt, byteLength: buffer.length });
      resolve();
    });
    stream.end(buffer);
  });
}
function editorDraftsFor(context) {
  const root = editorDraftDirectory();
  try { fs.mkdirSync(root, { recursive: true }); } catch {}
  let names = []; try { names = fs.readdirSync(root).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name)); } catch {}
  const found = [];
  for (const name of names) {
    const draftId = name.slice(0, -5);
    if (editorWindowsHasDraftId(draftId)) continue;
    try {
      const envelope = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
      if (envelope.identity !== context.identity || !envelope.data || !safeStorage.isEncryptionAvailable()) continue;
      const payload = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.data, 'base64')));
      if (!payload || typeof payload.content !== 'string' || typeof payload.originalText !== 'string') continue;
      if (payload.content === payload.originalText && payload.baseHash === context.initialHash) { fs.unlinkSync(path.join(root, name)); continue; }
      found.push({ ...payload, draftId, savedAt: envelope.updatedAt || payload.savedAt || null, displayName: path.posix.basename(context.remotePath) });
    } catch (error) { writeDebugRecord('editor', 'draft.recovery-read-error', { draftId, error: String(error?.message || error) }); }
  }
  found.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  return found.slice(0, 8);
}
function editorWindowsHasDraftId(id) { return [...editorWindows.values()].some((context) => context.draftId === id && !context.window.isDestroyed()); }
async function persistEditorDraft(context, raw) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，未将草稿以明文写入磁盘');
  const content = String(raw?.content ?? '');
  if (Buffer.byteLength(content, 'utf8') > MAX_EDITOR_BYTES * 3) throw new Error('草稿内容过大，未保存');
  const payload = {
    version: 1, draftId: context.draftId, identity: context.identity, remotePath: context.remotePath,
    displayName: path.posix.basename(context.remotePath), content, originalText: String(raw?.originalText ?? ''),
    originalEols: Array.isArray(raw?.originalEols) ? raw.originalEols.slice(0, 500000) : [],
    baseHash: String(raw?.baseHash || ''), encoding: String(raw?.encoding || 'utf8'), bom: raw?.bom === true,
    eolChoice: ['preserve', 'LF', 'CRLF', 'CR'].includes(raw?.eolChoice) ? raw.eolChoice : 'preserve',
    originalEncoding: String(raw?.originalEncoding || 'utf8'), originalBom: raw?.originalBom === true,
    cursor: raw?.cursor && Number.isFinite(raw.cursor.line) ? { line: Math.max(0, Math.min(1000000, Math.trunc(raw.cursor.line))), ch: Math.max(0, Math.min(1000000, Math.trunc(raw.cursor.ch || 0))) } : null,
    scrollInfo: raw?.scrollInfo && Number.isFinite(raw.scrollInfo.top) ? { top: Math.max(0, Math.min(100000000, Number(raw.scrollInfo.top) || 0)), left: Math.max(0, Math.min(100000000, Number(raw.scrollInfo.left) || 0)) } : null,
    lineCount: Math.max(0, Math.min(1000000, Math.trunc(Number(raw?.lineCount) || content.split('\n').length))), savedAt: new Date().toISOString()
  };
  const encrypted = safeStorage.encryptString(JSON.stringify(payload)).toString('base64');
  const file = editorDraftPath(context.draftId); const temp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify({ version: 1, identity: context.identity, updatedAt: payload.savedAt, data: encrypted }), { mode: 0o600 });
  fs.renameSync(temp, file);
  writeDebugRecord('editor', 'draft.saved', { editorId: context.editorId, bytes: Buffer.byteLength(content, 'utf8'), lineCount: payload.lineCount, encrypted: true });
  return { ok: true, bytes: Buffer.byteLength(content, 'utf8') };
}
function deleteEditorDraft(context) {
  try { fs.unlinkSync(editorDraftPath(context.draftId)); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  writeDebugRecord('editor', 'draft.deleted', { editorId: context.editorId });
  return { ok: true };
}
function editorExec(client, command, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let channel, stdout = '', stderr = '', done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => { try { channel?.close(); } catch {} finish(new Error('远端语法检查超时')); }, timeoutMs);
    timer.unref?.();
    try {
      client.exec(command, (error, stream) => {
        if (error) { finish(error); return; }
        channel = stream;
        stream.on('data', (chunk) => { if (stdout.length < 65536) stdout += Buffer.from(chunk).toString('utf8').slice(0, 65536 - stdout.length); });
        stream.stderr.on('data', (chunk) => { if (stderr.length < 65536) stderr += Buffer.from(chunk).toString('utf8').slice(0, 65536 - stderr.length); });
        stream.once('error', (e) => finish(e));
        stream.once('close', (code, signal) => finish(null, { code: Number.isInteger(code) ? code : null, signal: signal || null, stdout, stderr }));
      });
    } catch (error) { finish(error); }
  });
}
function shellDiagnosticLocation(output, source) {
  const lines = String(output || '').split(/\r?\n/).filter(Boolean).slice(0, 30);
  return lines.map((message) => {
    const m = message.match(/(?:line|at)\s+(\d+)(?:\s*[: ,]\s*(?:column|col)?\s*(\d+))?/i);
    return { severity: 'error', line: m ? Number(m[1]) : null, column: m?.[2] ? Number(m[2]) : null, message: message.slice(0, 600), source };
  });
}

function createRemoteEditorWindow(event, rawSessionId, rawRemotePath) {
  const sessionId = String(rawSessionId || '');
  const session = sessions.get(sessionId);
  if (!session?.connected || !session.client) throw new Error('请先连接一个可用的 SSH 会话');
  const remotePath = normalizeRemotePath(rawRemotePath);
  if (remotePath === '/') throw new Error('不能直接编辑远程根目录');
  // Keep each editor a true top-level, task-switchable window, like a small Notepad++.
  // It is not a modal or owned child of the main workspace; closing the workspace
  // still runs the app-wide draft-flush flow before all windows are closed.
  const editorId = crypto.randomUUID();
  const context = {
    editorId, draftId: editorId, sessionId, remotePath, identity: editorIdentity(session, remotePath),
    window: null, closed: false, dirty: false, closeAuthorized: false, closePrompting: false, activeSaveOperations: new Set(), initialHash: '', snapshot: null, geometryTimer: null
  };
  const savedBounds = getSavedEditorWindowState(context.identity);
  const { maximized: restoreMaximized, ...windowBounds } = savedBounds;
  const editorWin = new BrowserWindow({
    ...windowBounds, minWidth: 740, minHeight: 520, show: false, resizable: true,
    minimizable: true, maximizable: true, autoHideMenuBar: true, title: `Remote Editor — ${path.posix.basename(remotePath)}`,
    icon: path.join(__dirname, 'assets', 'n1pilot.ico'), backgroundColor: '#0b1020', skipTaskbar: false,
    webPreferences: { preload: path.join(__dirname, 'editor-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false }
  });
  // Capture WebContents and its ID before any close/destroy event. Electron may
  // throw "Object has been destroyed" if editorWin.webContents is dereferenced
  // from the BrowserWindow 'closed' callback.
  const editorWebContents = editorWin.webContents;
  const editorWebContentsId = editorWebContents.id;
  context.window = editorWin;
  editorWindows.set(editorWebContentsId, context);
  writeDebugRecord('editor', 'window.open.requested', { editorId, remotePath, sessionId, size: { width: savedBounds.width, height: savedBounds.height, x: savedBounds.x ?? null, y: savedBounds.y ?? null }, restoreMaximized: savedBounds.maximized === true, independentWindow: true, debugEnabled });
  editorWebContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  editorWebContents.on('will-navigate', (navEvent, url) => {
    if (!String(url || '').startsWith('file:')) navEvent.preventDefault();
  });
  editorWebContents.on('render-process-gone', (_e, details) => writeDebugRecord('editor', 'window.renderer-gone', { editorId, details: details || {} }));
  editorWin.once('ready-to-show', () => { if (!editorWin.isDestroyed()) { if (restoreMaximized) editorWin.maximize(); editorWin.show(); } });
  editorWin.on('resize', () => scheduleEditorWindowStateSave(context));
  editorWin.on('move', () => scheduleEditorWindowStateSave(context));
  editorWin.on('maximize', () => { saveEditorWindowState(context); writeDebugRecord('editor', 'window.maximized', { editorId }); });
  editorWin.on('unmaximize', () => { saveEditorWindowState(context); writeDebugRecord('editor', 'window.restored', { editorId }); });
  editorWin.on('close', (closeEvent) => {
    if (shuttingDown || context.closeAuthorized) return;
    closeEvent.preventDefault();
    if (!context.closePrompting && !editorWin.isDestroyed()) {
      context.closePrompting = true;
      editorWebContents.send('editor:close-request');
      writeDebugRecord('editor', 'window.close-request', { editorId, dirty: context.dirty });
    }
  });
  editorWin.on('closed', () => {
    // After 'closed', do not dereference editorWin or its webContents again.
    context.closed = true;
    if (context.geometryTimer) clearTimeout(context.geometryTimer);
    context.geometryTimer = null;
    editorWindows.delete(editorWebContentsId);
    writeDebugRecord('editor', 'window.closed', { editorId, dirty: context.dirty, draftRetained: context.dirty });
  });
  editorWin.loadFile(path.join(__dirname, 'editor.html')).catch((error) => {
    writeDebugRecord('editor', 'window.load-failed', { editorId, error: error?.stack || String(error) });
    try { editorWin.show(); } catch {}
  });
  return { ok: true, editorId, remotePath, displayName: path.posix.basename(remotePath) };
}

function editorJsonDiagnostics(text) {
  try { JSON.parse(text); return []; }
  catch (error) {
    const msg = String(error?.message || error);
    let position = null;
    const match = msg.match(/position\s+(\d+)/i);
    if (match) position = Number(match[1]);
    let line = null, column = null;
    if (position !== null) {
      const prefix = text.slice(0, position), lines = prefix.split('\n');
      line = lines.length; column = lines[lines.length - 1].length + 1;
    } else {
      const matchLine = msg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
      if (matchLine) { line = Number(matchLine[1]); column = Number(matchLine[2]); }
    }
    return [{ severity: 'error', line, column, message: msg.slice(0, 800), source: 'json' }];
  }
}

ipcMain.handle('editor:open-remote-file', async (event, sessionId, remotePath) => {
  const result = createRemoteEditorWindow(event, sessionId, remotePath);
  return result;
});

ipcMain.handle('editor:initialize', async (event) => {
  const context = editorContextFor(event);
  try {
    const snapshot = await withSftp(context.sessionId, (sftp) => readRemoteEditorSnapshot(sftp, context.remotePath));
    context.initialHash = snapshot.hash;
    context.snapshot = snapshot;
    const session = sessions.get(context.sessionId);
    const drafts = editorDraftsFor(context);
    writeDebugRecord('editor', 'file.load.success', { editorId: context.editorId, remotePath: context.remotePath, bytes: snapshot.byteLength, encoding: snapshot.encoding, bom: snapshot.bom, eol: snapshot.eolLabel, recoveredDraftCount: drafts.length });
    return { ok: true, ...safeEditorDetails(context), language: appLanguage, connected: !!session?.connected, debugEnabled, snapshot, drafts };
  } catch (error) {
    writeDebugRecord('editor', 'file.load.error', { editorId: context.editorId, remotePath: context.remotePath, error: error?.stack || String(error) });
    return { ok: false, ...safeEditorDetails(context), language: appLanguage, connected: !!sessions.get(context.sessionId)?.connected, debugEnabled, message: error.message || String(error) };
  }
});

ipcMain.handle('editor:validate', async (event, rawText, rawSyntax) => {
  editorContextFor(event);
  const text = String(rawText ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_EDITOR_BYTES * 3) throw new Error('待检查内容过大');
  const syntax = String(rawSyntax || '').toLowerCase();
  const diagnostics = [];
  if (syntax === 'json') diagnostics.push(...editorJsonDiagnostics(text));
  else if (syntax === 'yaml') {
    try {
      const doc = YAML.parseDocument(text, { prettyErrors: true, uniqueKeys: true, strict: true, version: '1.2' });
      for (const error of doc.errors || []) {
        const pos = error.linePos?.[0];
        diagnostics.push({ severity: 'error', line: pos?.line || null, column: pos?.col || null, message: String(error.message || error).slice(0, 800), source: 'yaml' });
      }
      for (const warning of doc.warnings || []) {
        const pos = warning.linePos?.[0];
        diagnostics.push({ severity: 'warning', line: pos?.line || null, column: pos?.col || null, message: String(warning.message || warning).slice(0, 800), source: 'yaml' });
      }
    } catch (error) { diagnostics.push({ severity: 'error', line: null, column: null, message: String(error?.message || error).slice(0, 800), source: 'yaml' }); }
  }
  writeDebugRecord('editor', 'validation.request', { editorId: event.sender.id, syntax, textLength: text.length, lineCount: text.split('\n').length, issueCount: diagnostics.length });
  return { diagnostics };
});

ipcMain.handle('editor:diff-lines', async (event, rawLeft, rawRight) => {
  editorContextFor(event);
  const left = String(rawLeft ?? ''), right = String(rawRight ?? '');
  if (Buffer.byteLength(left, 'utf8') > MAX_EDITOR_BYTES * 3 || Buffer.byteLength(right, 'utf8') > MAX_EDITOR_BYTES * 3) throw new Error('差异内容过大');
  const parts = diffLines(left, right).map((part) => ({ value: part.value, added: !!part.added, removed: !!part.removed, count: part.count || 0 }));
  writeDebugRecord('editor', 'diff.preview', { leftLength: left.length, rightLength: right.length, parts: parts.length });
  return { parts };
});

ipcMain.handle('editor:save-draft', async (event, raw) => {
  const context = editorContextFor(event);
  try { return await persistEditorDraft(context, raw || {}); }
  catch (error) { writeDebugRecord('editor', 'draft.save-error', { editorId: context.editorId, error: error?.stack || String(error) }); throw error; }
});
ipcMain.handle('editor:delete-draft', async (event) => {
  const context = editorContextFor(event);
  try { return deleteEditorDraft(context); } catch (error) { writeDebugRecord('editor', 'draft.delete-error', { editorId: context.editorId, error: String(error) }); return { ok: false }; }
});
ipcMain.handle('editor:discard-recovery-draft', async (event, rawDraftId) => {
  editorContextFor(event);
  try { fs.unlinkSync(editorDraftPath(rawDraftId)); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  writeDebugRecord('editor', 'draft.recovery-discarded', { draftId: String(rawDraftId || '') });
  return { ok: true };
});
ipcMain.on('editor:set-dirty', (event, dirty) => {
  const context = editorWindows.get(event.sender.id);
  if (!context || context.window.isDestroyed()) return;
  const next = dirty === true;
  if (context.dirty !== next) writeDebugRecord('editor', 'dirty-state.changed', { editorId: context.editorId, dirty: next });
  context.dirty = next;
});
ipcMain.on('editor:flush-draft-complete', (event, rawResult) => {
  const context = editorWindows.get(event.sender.id);
  if (!context || !appQuitWaitingForDraftFlush || !pendingEditorDraftFlush.has(event.sender.id)) return;
  const ok = rawResult?.ok === true;
  if (!ok) {
    writeDebugRecord('editor', 'app-quit.draft-flush-failed', { editorId: context.editorId, error: String(rawResult?.error || 'Editor draft save failed') });
    finishEditorDraftFlush(false, `${path.posix.basename(context.remotePath)}: ${String(rawResult?.error || 'draft save failed')}`);
    return;
  }
  pendingEditorDraftFlush.delete(event.sender.id);
  writeDebugRecord('editor', 'app-quit.draft-flush-ack', { editorId: context.editorId, remaining: pendingEditorDraftFlush.size });
  if (!pendingEditorDraftFlush.size) finishEditorDraftFlush(true);
});

ipcMain.on('editor:close-decision', async (event, rawDecision) => {
  const context = editorWindows.get(event.sender.id);
  if (!context || context.window.isDestroyed()) return;
  const decision = String(rawDecision || 'cancel');
  writeDebugRecord('editor', 'window.close-decision', { editorId: context.editorId, decision, dirty: context.dirty, closePrompting: context.closePrompting });
  if (!['close', 'discard', 'cancel'].includes(decision)) return;
  if (decision === 'cancel') { context.closePrompting = false; return; }
  if (decision === 'discard') {
    try { deleteEditorDraft(context); } catch (error) { writeDebugRecord('editor', 'draft.delete-on-discard-error', { editorId: context.editorId, error: String(error) }); }
    context.dirty = false;
  }
  if (decision === 'close' && context.dirty) {
    context.closePrompting = false;
    try { context.window.webContents.send('editor:close-request'); } catch {}
    return;
  }
  context.closeAuthorized = true;
  context.closePrompting = false;
  context.window.close();
});

ipcMain.handle('editor:save', async (event, rawPayload) => {
  const context = editorContextFor(event);
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const text = String(payload.content ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_EDITOR_BYTES * 3) throw new Error('保存内容超过安全限制（2 MiB 原文件上限）；未写入远程文件');
  const allowedEncoding = new Set(['utf8', 'utf16le', 'utf16be', 'windows1252', 'latin1']);
  const encoding = String(payload.encoding || 'utf8');
  if (!allowedEncoding.has(encoding)) throw new Error('不支持的文本编码');
  const bom = payload.bom === true;
  const expectedHash = String(payload.baseHash || '');
  const operationId = String(payload.operationId || crypto.randomUUID()).slice(0, 100);
  const stageStarts = new Map();
  const stage = (name, details = {}) => {
    const now = Date.now();
    const parts = String(name).split('.');
    const terminal = parts.pop();
    const base = parts.join('.');
    let elapsedMs = null;
    if (terminal === 'begin') stageStarts.set(base, now);
    else if (stageStarts.has(base)) {
      elapsedMs = Math.max(0, now - stageStarts.get(base));
      stageStarts.delete(base);
    }
    writeDebugRecord('editor', `file.save.stage.${name}`, {
      operationId, editorId: context.editorId, remotePath: context.remotePath,
      elapsedMs, ...details
    });
  };
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
    writeDebugRecord('editor', 'file.save.rejected', { operationId, editorId: context.editorId, reason: 'invalid-base-hash' });
    throw new Error('缺少有效的远程文件基准版本；请重新打开文件后再保存');
  }
  context.activeSaveOperations ||= new Set();
  context.activeSaveOperations.add(operationId);
  writeDebugRecord('editor', 'file.save.begin', { operationId, editorId: context.editorId, remotePath: context.remotePath, textLength: text.length, byteLengthUtf8: Buffer.byteLength(text, 'utf8'), encoding, bom, eolChoice: String(payload.eolChoice || 'preserve'), forceOverwrite: payload.forceOverwrite === true, activeSaveCount: context.activeSaveOperations.size });
  stage('sftp.acquire.begin', { sessionId: context.sessionId });
  return withSftp(context.sessionId, async (sftp) => {
    const remotePath = context.remotePath;
    stage('sftp.acquire.success');
    stage('snapshot.read.begin');
    const current = await readRemoteEditorSnapshot(sftp, remotePath);
    stage('snapshot.read.success', { remoteSize: current.byteLength, remoteHash: current.hash });
    if (current.hash !== expectedHash) {
      stage('snapshot.conflict', { expectedHash, currentHash: current.hash, currentSize: current.byteLength });
      writeDebugRecord('editor', 'file.save.conflict', { operationId, editorId: context.editorId, expectedHash, currentHash: current.hash, currentSize: current.byteLength });
      return { ok: false, conflict: true, currentHash: current.hash, remoteContent: current.content, remoteSize: current.byteLength, remoteEncoding: current.encoding, remoteBom: current.bom, remoteEol: current.eolLabel, metadata: current.metadata };
    }
    const originalText = String(payload.originalText ?? context.snapshot?.content ?? current.content);
    const originalEols = Array.isArray(payload.originalEols) ? payload.originalEols.slice(0, 500000) : (context.snapshot?.eols || []);
    let forcedEol = null;
    if (payload.eolChoice === 'LF') forcedEol = '\n';
    else if (payload.eolChoice === 'CRLF') forcedEol = '\r\n';
    else if (payload.eolChoice === 'CR') forcedEol = '\r';
    const eolForNewLines = current.defaultEol || '\n';
    const formattedText = formatTextWithLineEndings(originalText, text, originalEols, eolForNewLines, forcedEol);
    const bytes = encodeEditorContent(formattedText, encoding, bom);
    if (bytes.length > MAX_EDITOR_BYTES) throw new Error('编码后文件超过 2 MiB 限制；未写入远程文件');
    const folder = path.posix.dirname(remotePath), basename = path.posix.basename(remotePath), token = crypto.randomUUID();
    const tempPath = path.posix.join(folder, `.${basename}.n1pilot-${token}.tmp`);
    const backupPath = path.posix.join(folder, `.${basename}.n1pilot-${token}.bak`);
    let tempExists = false, backupExists = false, replacementCompleted = false, cleanupWarning = '';
    try {
      stage('temp-write.begin', { tempPath, byteLength: bytes.length });
      await writeRemoteEditorBuffer(sftp, tempPath, bytes); tempExists = true;
      stage('temp-write.success', { tempPath, byteLength: bytes.length });
      stage('temp-stat.begin', { tempPath });
      const tempAttrs = await sftpStat(sftp, tempPath);
      stage('temp-stat.success', { tempPath, exists: !!tempAttrs });
      if (!tempAttrs) throw new Error('远程临时文件写入后无法确认其存在；源文件未替换');
      if (!current.metadata?.modeAvailable) throw new Error('无法读取原文件权限信息，为避免保存后改变权限，已取消替换。');
      const originalMode = Number(current.metadata.mode) & 0o7777;
      if (current.metadata?.uid != null && current.metadata?.gid != null && (Number(tempAttrs.uid) !== Number(current.metadata.uid) || Number(tempAttrs.gid) !== Number(current.metadata.gid))) {
        try { await sftpCall(sftp, 'chown', tempPath, Number(current.metadata.uid), Number(current.metadata.gid)); }
        catch (error) { throw new Error(`无法保留原文件所有者/组（UID ${current.metadata.uid}, GID ${current.metadata.gid}），为避免改变文件属性，已取消保存。${error.message || ''}`); }
      }
      await sftpCall(sftp, 'chmod', tempPath, originalMode);
      // Recheck once before moving the original, and again inspect the actual backup
      // after rename to catch an edit that raced the hash check.
      stage('pre-replace-snapshot.begin');
      const preReplace = await readRemoteEditorSnapshot(sftp, remotePath);
      stage('pre-replace-snapshot.success', { remoteHash: preReplace.hash, remoteSize: preReplace.byteLength });
      if (preReplace.hash !== expectedHash) {
        stage('pre-replace-snapshot.conflict', { expectedHash, currentHash: preReplace.hash });
        await sftpCall(sftp, 'unlink', tempPath).catch(() => {}); tempExists = false;
        return { ok: false, conflict: true, currentHash: preReplace.hash, remoteContent: preReplace.content, remoteSize: preReplace.byteLength, remoteEncoding: preReplace.encoding, remoteBom: preReplace.bom, remoteEol: preReplace.eolLabel, metadata: preReplace.metadata };
      }
      stage('backup-rename.begin', { from: remotePath, to: backupPath });
      await sftpCall(sftp, 'rename', remotePath, backupPath); backupExists = true;
      stage('backup-rename.success', { backupPath });
      stage('backup-verify.begin', { backupPath });
      const movedOriginal = await readRemoteEditorSnapshot(sftp, backupPath);
      stage('backup-verify.success', { backupHash: movedOriginal.hash, backupSize: movedOriginal.byteLength });
      if (movedOriginal.hash !== expectedHash) {
        stage('backup-verify.conflict', { expectedHash, currentHash: movedOriginal.hash });
        try { await sftpCall(sftp, 'rename', backupPath, remotePath); backupExists = false; }
        catch (restoreError) { throw new Error(`保存期间远程文件发生变化，原文件被保留在 ${backupPath}，但自动恢复原路径失败：${restoreError.message || restoreError}`); }
        await sftpCall(sftp, 'unlink', tempPath).catch(() => {}); tempExists = false;
        return { ok: false, conflict: true, currentHash: movedOriginal.hash, remoteContent: movedOriginal.content, remoteSize: movedOriginal.byteLength, remoteEncoding: movedOriginal.encoding, remoteBom: movedOriginal.bom, remoteEol: movedOriginal.eolLabel, metadata: movedOriginal.metadata };
      }
      try {
        stage('replacement-rename.begin', { from: tempPath, to: remotePath });
        await sftpCall(sftp, 'rename', tempPath, remotePath);
        tempExists = false; replacementCompleted = true;
        stage('replacement-rename.success', { remotePath });
      }
      catch (replaceError) {
        try { await sftpCall(sftp, 'rename', backupPath, remotePath); backupExists = false; }
        catch (restoreError) { throw new Error(`新文件替换失败，且原文件回滚失败。原文件备份仍保留在 ${backupPath}。替换错误：${replaceError.message || replaceError}；回滚错误：${restoreError.message || restoreError}`); }
        throw new Error(`替换远程文件失败，原文件已恢复：${replaceError.message || replaceError}`);
      }
      try {
        stage('backup-cleanup.begin', { backupPath });
        await sftpCall(sftp, 'unlink', backupPath); backupExists = false;
        stage('backup-cleanup.success', { backupPath });
      } catch (error) {
        cleanupWarning = `保存已成功，但原文件备份清理失败，备份仍在：${backupPath}（${error.message || error}）`;
        stage('backup-cleanup.warning', { backupPath, error: error?.stack || String(error) });
      }
      stage('final-snapshot.begin');
      const saved = await readRemoteEditorSnapshot(sftp, remotePath);
      stage('final-snapshot.success', { remoteHash: saved.hash, remoteSize: saved.byteLength });
      context.snapshot = saved; context.initialHash = saved.hash;
      writeDebugRecord('editor', 'file.save.success', { operationId, editorId: context.editorId, remotePath, byteLength: saved.byteLength, encoding, bom, eol: saved.eolLabel, metadataPreserved: { mode: originalMode, uid: current.metadata?.uid ?? null, gid: current.metadata?.gid ?? null }, backupCleaned: !backupExists });
      return { ok: true, hash: saved.hash, byteLength: saved.byteLength, eols: saved.eols, eolLabel: saved.eolLabel, defaultEol: forcedEol || saved.defaultEol, metadata: saved.metadata, metadataPreserved: { mode: originalMode, uid: saved.metadata?.uid ?? null, gid: saved.metadata?.gid ?? null }, cleanupWarning };
    } catch (caughtError) {
      let error = caughtError;
      if (backupExists && !replacementCompleted) {
        try {
          const targetNow = await sftpStat(sftp, remotePath);
          if (!targetNow) {
            await sftpCall(sftp, 'rename', backupPath, remotePath);
            backupExists = false;
            writeDebugRecord('editor', 'file.save.rollback-restored', { editorId: context.editorId, remotePath });
          } else {
            error = new Error(`${caughtError.message || caughtError}；为避免覆盖期间新出现的远程文件，原文件备份保留在 ${backupPath}，远程目标路径目前已存在。`);
          }
        } catch (rollbackError) {
          error = new Error(`${caughtError.message || caughtError}；原文件自动回滚未能确认成功，原文件备份保留在 ${backupPath}。回滚检查错误：${rollbackError.message || rollbackError}`);
        }
      } else if (replacementCompleted) {
        const suffix = backupExists ? `；新的替换步骤已经完成，原文件备份仍保留在 ${backupPath}。` : '；远程替换步骤已经完成，目标文件可能已包含新内容。请重新读取并对比服务器文件后再重试，避免重复覆盖。';
        error = new Error(`${caughtError.message || caughtError}${suffix}`);
      }
      writeDebugRecord('editor', 'file.save.error', { operationId, editorId: context.editorId, remotePath, error: error?.stack || String(error), tempExists, backupExists, replacementCompleted, tempPath: tempExists ? tempPath : null, backupPath: backupExists ? backupPath : null });
      stage('failed', { tempExists, backupExists, replacementCompleted, error: error?.message || String(error) });
      throw error;
    } finally {
      if (tempExists) {
        stage('temp-cleanup.begin', { tempPath });
        await sftpCall(sftp, 'unlink', tempPath).then(() => stage('temp-cleanup.success', { tempPath })).catch((cleanupError) => stage('temp-cleanup.warning', { tempPath, error: cleanupError?.message || String(cleanupError) }));
      }
    }
  }).catch((error) => {
    writeDebugRecord('editor', 'file.save.handler-error', { operationId, editorId: context.editorId, remotePath: context.remotePath, error: error?.stack || String(error) });
    throw error;
  }).finally(() => {
    context.activeSaveOperations?.delete(operationId);
    writeDebugRecord('editor', 'file.save.handler-settled', { operationId, editorId: context.editorId, remotePath: context.remotePath, activeSaveCount: context.activeSaveOperations?.size || 0 });
  });
});

ipcMain.handle('editor:check-shell-remote', async (event, rawText) => {
  const context = editorContextFor(event);
  const text = String(rawText ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_EDITOR_BYTES) throw new Error('脚本超过 2 MiB 检查限制');
  const session = sessions.get(context.sessionId);
  if (!session?.connected || !session.client) return { ok: false, passed: false, message: 'SSH 会话已断开' };
  const id = crypto.randomUUID(); const tempPath = `/tmp/.n1pilot-sh-check-${id}.sh`;
  writeDebugRecord('editor', 'shell-check.begin', { editorId: context.editorId, bytes: Buffer.byteLength(text, 'utf8'), lineCount: text.split('\n').length, method: 'remote sh -n only' });
  let sftp;
  try {
    sftp = await new Promise((resolve, reject) => session.client.sftp((err, client) => err ? reject(err) : resolve(client)));
    await writeRemoteEditorBuffer(sftp, tempPath, Buffer.from(text, 'utf8'));
    try { await sftpCall(sftp, 'chmod', tempPath, 0o600); } catch {}
    const command = `sh -n '${tempPath}'; rc=$?; rm -f '${tempPath}'; exit "$rc"`;
    const result = await editorExec(session.client, command, 15000);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const passed = result.code === 0;
    const diagnostics = passed ? [] : shellDiagnosticLocation(output || `sh -n exited with code ${result.code ?? 'unknown'}`, 'remote-sh');
    writeDebugRecord('editor', 'shell-check.complete', { editorId: context.editorId, passed, exitCode: result.code, signal: result.signal, outputLength: output.length, issueCount: diagnostics.length, executedScript: false });
    return { ok: true, passed, exitCode: result.code, diagnostics, message: output.slice(0, 5000) };
  } catch (error) {
    writeDebugRecord('editor', 'shell-check.error', { editorId: context.editorId, error: error?.stack || String(error) });
    return { ok: false, passed: false, message: error.message || String(error) };
  } finally {
    if (sftp) { await sftpCall(sftp, 'unlink', tempPath).catch(() => {}); try { sftp.end(); } catch {} }
  }
});

function sendSftpProgress(transferId, data) {
  if (!transferId) return;
  send('sftp:progress', { transferId, ...data });
}
async function localTree(rootPath) {
  const root = path.resolve(String(rootPath || ''));
  const out = [];
  async function walk(abs, rel) {
    const st = await fs.promises.lstat(abs);
    if (st.isSymbolicLink()) throw new Error(`当前不递归传输符号链接：${abs}`);
    if (st.isDirectory()) {
      out.push({ path: abs, relative: rel, isDir: true, size: 0 });
      const names = await fs.promises.readdir(abs);
      for (const name of names) await walk(path.join(abs, name), path.join(rel, name));
    } else if (st.isFile()) out.push({ path: abs, relative: rel, isDir: false, size: st.size });
  }
  await walk(root, '');
  return out;
}
async function remoteTree(sftp, rootPath, options = {}) {
  const root = normalizeRemotePath(rootPath);
  const skipUnsupported = options.skipUnsupported === true;
  const out = [];
  async function walk(abs, rel) {
    const attrs = await sftpStat(sftp, abs);
    if (!attrs) throw new Error(`远程路径不存在：${abs}`);
    if (remoteIsDirectory(attrs)) {
      out.push({ path: abs, relative: rel, isDir: true, size: 0 });
      const entries = await sftpCall(sftp, 'readdir', abs);
      for (const item of entries) {
        if (['.', '..'].includes(String(item.filename))) continue;
        const childAttrs = item.attrs || {};
        const isLink = (Number(childAttrs.mode || 0) & 0o170000) === 0o120000;
        const childPath = path.posix.join(abs, String(item.filename));
        if (isLink && skipUnsupported) { writeDebugRecord('main', 'remote-tree.skip-unsupported', { path: childPath, type: 'symlink', mode: Number(childAttrs.mode || 0) }); continue; }
        if (isLink) throw new Error(`当前不递归传输远程符号链接：${childPath}`);
        await walk(childPath, path.posix.join(rel, String(item.filename)));
      }
    } else if (remoteIsFile(attrs)) out.push({ path: abs, relative: rel, isDir: false, size: Number(attrs.size || 0) });
    else if (skipUnsupported) { writeDebugRecord('main', 'remote-tree.skip-unsupported', { path: abs, type: 'special', mode: Number(attrs.mode || 0) }); }
    else throw new Error(`不支持此远程文件类型：${abs}`);
  }
  await walk(root, '');
  return out;
}
function fastTransfer(sftp, method, source, destination, transferId, context) {
  return new Promise((resolve, reject) => {
    const opts = { step: (transferred, _chunk, total) => {
      const fileBytes = Math.max(0, Number(transferred || 0));
      sendSftpProgress(transferId, {
        direction: context.direction, currentFile: source, fileTransferred: fileBytes,
        fileTotal: Number(total || context.fileSize || 0), transferred: context.completedBytes + fileBytes,
        total: context.totalBytes, destination
      });
    }};
    sftp[method](source, destination, opts, (err) => err ? reject(err) : resolve());
  });
}
async function uploadTree(sftp, rawLocalPath, rawRemoteDir, overwrite, transferId) {
  const localPath = path.resolve(rawLocalPath);
  const remoteDir = normalizeRemotePath(rawRemoteDir || '/tmp');
  const rootStat = await fs.promises.lstat(localPath);
  if (rootStat.isSymbolicLink()) throw new Error(`不支持上传符号链接：${localPath}`);
  const dirStat = await sftpStat(sftp, remoteDir);
  if (!dirStat || !remoteIsDirectory(dirStat)) throw new Error(`远程目标目录不存在或不是文件夹：${remoteDir}`);
  const tree = await localTree(localPath);
  const totalBytes = tree.reduce((sum, item) => sum + (item.isDir ? 0 : item.size), 0);
  const remoteRoot = path.posix.join(remoteDir, path.basename(localPath));
  const existingRoot = await sftpStat(sftp, remoteRoot);
  if (existingRoot && !overwrite) throw new Error(`远程已存在同名文件或目录：${remoteRoot}`);
  if (rootStat.isDirectory()) {
    if (existingRoot && !remoteIsDirectory(existingRoot)) throw new Error(`远程同名目标不是文件夹：${remoteRoot}`);
    if (!existingRoot) await sftpCall(sftp, 'mkdir', remoteRoot);
  }
  let completedBytes = 0;
  const results = [];
  for (const item of tree) {
    const remotePath = item.relative ? path.posix.join(remoteRoot, item.relative.split(path.sep).join('/')) : remoteRoot;
    if (item.isDir) {
      const exists = await sftpStat(sftp, remotePath);
      if (exists && !remoteIsDirectory(exists)) throw new Error(`远程路径已存在且不是文件夹：${remotePath}`);
      if (!exists && remotePath !== remoteRoot) await sftpCall(sftp, 'mkdir', remotePath);
      continue;
    }
    const exists = await sftpStat(sftp, remotePath);
    if (exists && !overwrite) throw new Error(`远程已存在同名文件：${remotePath}`);
    await fastTransfer(sftp, 'fastPut', item.path, remotePath, transferId, { direction: 'upload', completedBytes, totalBytes, fileSize: item.size });
    completedBytes += item.size;
    sendSftpProgress(transferId, { direction: 'upload', currentFile: item.path, fileTransferred: item.size, fileTotal: item.size, transferred: completedBytes, total: totalBytes, destination: remotePath });
    results.push({ localPath: item.path, remotePath, size: item.size });
  }
  return { ok: true, results, message: `已上传到 ${remoteRoot}`, rootPath: remoteRoot };
}
async function downloadTree(sftp, rawRemotePath, rawLocalDir, transferId, options = {}) {
  const remotePath = normalizeRemotePath(rawRemotePath);
  const localDir = path.resolve(String(rawLocalDir || os.homedir()));
  const localStat = await fs.promises.stat(localDir);
  if (!localStat.isDirectory()) throw new Error('下载目标不是本地文件夹');
  const tree = await remoteTree(sftp, remotePath, options);
  if (!tree.length) throw new Error(`远程项目没有可下载的普通文件或文件夹：${remotePath}`);
  const rootName = path.posix.basename(remotePath) || 'download.bin';
  const localRoot = uniqueLocalPath(localDir, rootName);
  const totalBytes = tree.reduce((sum, item) => sum + (item.isDir ? 0 : item.size), 0);
  const rootAttrs = await sftpStat(sftp, remotePath);
  if (remoteIsDirectory(rootAttrs)) await fs.promises.mkdir(localRoot, { recursive: true });
  let completedBytes = 0;
  const results = [];
  for (const item of tree) {
    const localPath = item.relative ? path.join(localRoot, ...item.relative.split('/')) : localRoot;
    if (item.isDir) { await fs.promises.mkdir(localPath, { recursive: true }); continue; }
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fastTransfer(sftp, 'fastGet', item.path, localPath, transferId, { direction: 'download', completedBytes, totalBytes, fileSize: item.size });
    completedBytes += item.size;
    sendSftpProgress(transferId, { direction: 'download', currentFile: item.path, fileTransferred: item.size, fileTotal: item.size, transferred: completedBytes, total: totalBytes, destination: localPath });
    results.push({ remotePath: item.path, localPath, size: item.size });
  }
  return { ok: true, results, message: `已下载到 ${localRoot}`, rootPath: localRoot };
}
async function removeRemoteTree(sftp, remotePath) {
  const attrs = await sftpStat(sftp, remotePath);
  if (!attrs) return;
  if (remoteIsDirectory(attrs)) {
    const entries = await sftpCall(sftp, 'readdir', remotePath);
    for (const item of entries) if (!['.', '..'].includes(String(item.filename))) await removeRemoteTree(sftp, path.posix.join(remotePath, String(item.filename)));
    await sftpCall(sftp, 'rmdir', remotePath);
  } else await sftpCall(sftp, 'unlink', remotePath);
}
async function moveLocal(source, targetDir) {
  const src = path.resolve(source), dir = path.resolve(targetDir);
  const st = await fs.promises.stat(dir); if (!st.isDirectory()) throw new Error('目标路径不是文件夹');
  const target = path.join(dir, path.basename(src));
  if (fs.existsSync(target)) throw new Error(`目标已存在：${target}`);
  try { await fs.promises.rename(src, target); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fs.promises.cp(src, target, { recursive: true, errorOnExist: true, force: false });
    await fs.promises.rm(src, { recursive: true, force: false });
  }
  return { source: src, target };
}
function showWindowsProperties(targetPath) {
  const target = path.resolve(String(targetPath || ''));
  if (!fs.existsSync(target)) return Promise.reject(new Error(`找不到本地项目：${target}`));
  if (process.platform !== 'win32') return shell.openPath(target).then((error) => { if (error) throw new Error(error); return { ok: true, fallback: true }; });
  let hwnd = '0';
  try { if (win && !win.isDestroyed()) hwnd = win.getNativeWindowHandle().readBigUInt64LE(0).toString(); } catch {}
  const nativeHelper = app.isPackaged
    ? path.join(process.resourcesPath, 'N1PilotProperties.exe')
    : path.join(__dirname, 'assets', 'N1PilotProperties.exe');
  if (fs.existsSync(nativeHelper)) {
    const launchedAt = Date.now();
    const helper = spawn(nativeHelper, [hwnd, target], { detached: false, stdio: 'ignore', windowsHide: true });
    helper.once('spawn', () => writeDebugRecord('main', 'local-properties.native-spawned', { target, hwnd, helper: nativeHelper, helperPid: helper.pid }));
    helper.on('error', (error) => { writeDebugRecord('main', 'local-properties.native-launch-error', { target, error: error.stack || error.message || String(error) }); send('app:log', `打开本地 Windows 属性失败：${error.message}`); });
    helper.on('exit', (code, signal) => {
      writeDebugRecord('main', code === 0 ? 'local-properties.native-exit' : 'local-properties.native-exit-error', { target, code, signal, elapsedMs: Date.now() - launchedAt });
      if (code !== 0) send('app:log', `打开本地 Windows 属性失败（native helper exit ${code}${signal ? `, ${signal}` : ''}）。请检查 DEBUG 日志。`);
    });
    helper.unref();
    writeDebugRecord('main', 'local-properties.native-launch', { target, hwnd, helper: nativeHelper });
    return Promise.resolve({ ok: true, launcher: 'native' });
  }
  // Development fallback: call ShellExecuteEx from PowerShell without minimizing/restoring
  // the Electron window; unlike the former helper, this does not wait for the property sheet.
  const encodedPath = Buffer.from(target, 'utf8').toString('base64');
  const ps = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')); $h=[IntPtr]([Int64]${hwnd}); $code=@'
using System;
using System.Runtime.InteropServices;
public static class N1PilotShellExecute {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct SHELLEXECUTEINFO {
  public int cbSize; public uint fMask; public IntPtr hwnd;
  [MarshalAs(UnmanagedType.LPWStr)] public string lpVerb;
  [MarshalAs(UnmanagedType.LPWStr)] public string lpFile;
  [MarshalAs(UnmanagedType.LPWStr)] public string lpParameters;
  [MarshalAs(UnmanagedType.LPWStr)] public string lpDirectory;
  public int nShow; public IntPtr hInstApp; public IntPtr lpIDList;
  [MarshalAs(UnmanagedType.LPWStr)] public string lpClass; public IntPtr hkeyClass;
  public uint dwHotKey; public IntPtr hIconOrMonitor; public IntPtr hProcess;
 }
 [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool ShellExecuteEx(ref SHELLEXECUTEINFO info);
}
'@; Add-Type -TypeDefinition $code; $i=New-Object -TypeName 'N1PilotShellExecute+SHELLEXECUTEINFO'; $i.cbSize=[Runtime.InteropServices.Marshal]::SizeOf($i); $i.fMask=0x0000000C; $i.hwnd=$h; $i.lpVerb='properties'; $i.lpFile=$p; $i.nShow=5; if(-not [N1PilotShellExecute]::ShellExecuteEx([ref]$i)){ $err=[Runtime.InteropServices.Marshal]::GetLastWin32Error(); throw "ShellExecuteEx failed: $err" }`;
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { detached: false, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let helperError = '';
  child.stderr?.on('data', (chunk) => { helperError = (helperError + chunk.toString('utf8')).slice(-2000); });
  child.on('error', (error) => { writeDebugRecord('main', 'local-properties.powershell-launch-error', { target, error: error.stack || error.message || String(error) }); send('app:log', `打开本地 Windows 属性失败：${error.message}`); });
  child.on('exit', (code) => { if (code !== 0) { writeDebugRecord('main', 'local-properties.powershell-exit-error', { target, code, stderr: helperError.trim() }); send('app:log', `打开本地 Windows 属性失败（exit ${code}）：${helperError.trim()}`); } });
  child.unref();
  writeDebugRecord('main', 'local-properties.powershell-fallback', { target, hwnd });
  return Promise.resolve({ ok: true, launcher: 'powershell-fallback' });
}
function normalizeLocalDirectoryInput(rawPath) {
  const value = String(rawPath ?? '').trim();
  if (!value) return os.homedir();
  // On Windows, "Z:" means the process' per-drive current directory, not Z:\.
  // The portable EXE may run from a random extraction directory on Z:, so make
  // a bare drive-letter entry mean the drive root, matching the SFTP path field UX.
  const driveOnly = /^([a-zA-Z]):$/.exec(value);
  if (driveOnly) return `${driveOnly[1]}:\\`;
  return value;
}
ipcMain.handle('sftp:local-home', async () => os.homedir());
ipcMain.handle('sftp:pick-local-directory', async () => {
  const pick = await dialog.showOpenDialog(win, { title: appLanguage === 'en' ? 'Choose Local Folder' : '选择本地文件夹', properties: ['openDirectory', 'createDirectory'] });
  return pick.canceled || !pick.filePaths?.[0] ? { canceled: true } : { canceled: false, path: pick.filePaths[0] };
});
ipcMain.handle('sftp:list-local', async (_event, rawPath) => {
  const normalizedInput = normalizeLocalDirectoryInput(rawPath);
  const localPath = path.resolve(normalizedInput);
  writeDebugRecord('main', 'directory.local.resolve-input', { rawPath: String(rawPath ?? ''), normalizedInput, resolved: localPath });
  const stat = await fs.promises.stat(localPath);
  if (!stat.isDirectory()) throw new Error('本地路径不是文件夹');
  const items = await fs.promises.readdir(localPath, { withFileTypes: true });
  const entries = await Promise.all(items.map(async (item) => {
    const itemPath = path.join(localPath, item.name); let info = null;
    try { info = await fs.promises.lstat(itemPath); } catch {}
    const isDir = item.isDirectory() || Boolean(info?.isDirectory()); const isLink = item.isSymbolicLink();
    return { name: item.name, path: itemPath, isDir, isLink, size: info?.size || 0, mtime: info?.mtimeMs || 0, mode: Number(info?.mode || 0), type: isLink ? 'link' : isDir ? 'dir' : 'file' };
  }));
  entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { path: localPath, parent: path.dirname(localPath), entries };
});
ipcMain.handle('sftp:list-remote', async (_event, sessionId, rawPath) => {
  const remotePath = normalizeRemotePath(rawPath);
  const startedAt = Date.now();
  writeDebugRecord('sftp', 'directory.list.begin', { sessionId: String(sessionId || ''), remotePath });
  try {
    const result = await withSftp(sessionId, async (sftp) => {
      const readStartedAt = Date.now();
      // readdir itself validates that the target exists and is a directory. A
      // separate stat was an unnecessary serialized SFTP round trip per navigation.
      const list = await sftpReadCallWithTimeout(sftp, 'readdir', remotePath, SFTP_METADATA_TIMEOUT_MS);
      const readElapsedMs = Date.now() - readStartedAt;
      const entries = list.filter((item) => !['.', '..'].includes(String(item.filename))).map((item) => {
        const name = String(item.filename), attrs = item.attrs || {}, mode = Number(attrs.mode || 0), isDir = remoteIsDirectory(attrs), modeType = mode & 0o170000;
        return { name, path: path.posix.join(remotePath, name), isDir, isLink: modeType === 0o120000, size: Number(attrs.size || 0), mtime: Number(attrs.mtime || 0) * 1000, mode, permissions: (mode & 0o7777).toString(8).padStart(3, '0'), type: modeType === 0o120000 ? 'link' : isDir ? 'dir' : 'file' };
      }).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      writeDebugRecord('sftp', 'directory.list.readdir-complete', { sessionId: String(sessionId || ''), remotePath, entries: entries.length, readdirElapsedMs: readElapsedMs });
      return { path: remotePath, parent: path.posix.dirname(remotePath), entries };
    });
    writeDebugRecord('sftp', 'directory.list.success', { sessionId: String(sessionId || ''), remotePath, entries: result.entries.length, elapsedMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    writeDebugRecord('sftp', 'directory.list.error', { sessionId: String(sessionId || ''), remotePath, elapsedMs: Date.now() - startedAt, error: error?.stack || String(error) });
    throw error;
  }
});
ipcMain.handle('sftp:upload-files', async (_event, sessionId, rawLocalPaths, rawRemoteDir, overwrite = false, transferId = null) => {
  const localPaths = Array.isArray(rawLocalPaths) ? rawLocalPaths.map((p) => String(p || '')).filter(Boolean) : [];
  if (!localPaths.length) throw new Error('请先选择要上传的本地文件');
  return withSftp(sessionId, async (sftp) => {
    const results = [];
    for (const localPath of localPaths) results.push(await uploadTree(sftp, localPath, rawRemoteDir, overwrite, transferId));
    return { ok: true, results, message: `已上传 ${results.length} 项` };
  });
});
ipcMain.handle('sftp:download-files', async (_event, sessionId, rawRemotePaths, rawLocalDir, transferId = null) => {
  const remotePaths = Array.isArray(rawRemotePaths) ? rawRemotePaths.map((p) => normalizeRemotePath(p)) : [];
  if (!remotePaths.length) throw new Error('请先选择要下载的远程文件');
  return withSftp(sessionId, async (sftp) => {
    const results = [];
    for (const remotePath of remotePaths) results.push(await downloadTree(sftp, remotePath, rawLocalDir, transferId));
    return { ok: true, results, message: `已下载 ${results.length} 项` };
  });
});
ipcMain.handle('sftp:copy-local-files', async (_event, rawPaths, rawTargetDir) => {
  const paths = Array.isArray(rawPaths) ? rawPaths.map((p) => path.resolve(String(p))) : [];
  const targetDir = path.resolve(String(rawTargetDir || os.homedir()));
  if (!(await fs.promises.stat(targetDir)).isDirectory()) throw new Error('本地目标路径不是文件夹');
  const copied = [];
  for (const src of paths) {
    const name = path.basename(src);
    const target = uniqueLocalPath(targetDir, name);
    await fs.promises.cp(src, target, { recursive: true, errorOnExist: true, force: false, dereference: false });
    copied.push({ source: src, target });
  }
  return { ok: true, copied };
});
ipcMain.handle('sftp:local-properties', async (_event, rawPath) => {
  const target = path.resolve(String(rawPath || '')); const st = await fs.promises.lstat(target);
  return { path: target, name: path.basename(target), isDirectory: st.isDirectory(), isSymbolicLink: st.isSymbolicLink(), size: st.size, modifiedAt: st.mtime.toISOString(), createdAt: st.birthtime.toISOString(), mode: (st.mode & 0o777).toString(8), native: process.platform === 'win32' };
});
ipcMain.handle('sftp:show-local-properties', async (_event, rawPath) => showWindowsProperties(path.resolve(String(rawPath || ''))));
ipcMain.handle('sftp:remote-properties', async (_event, sessionId, rawPath) => withSftp(sessionId, async (sftp) => {
  const target = normalizeRemotePath(rawPath), attrs = await sftpStat(sftp, target); if (!attrs) throw new Error(`远程路径不存在：${target}`);
  const mode = Number(attrs.mode || 0);
  return { path: target, name: path.posix.basename(target), isDirectory: remoteIsDirectory(attrs), size: Number(attrs.size || 0), modifiedAt: new Date(Number(attrs.mtime || 0) * 1000).toISOString(), permissions: (mode & 0o7777).toString(8).padStart(3, '0'), mode, mtime: Number(attrs.mtime || 0), atime: Number(attrs.atime || 0), uid: attrs.uid == null ? null : Number(attrs.uid), gid: attrs.gid == null ? null : Number(attrs.gid) };
}));
ipcMain.handle('sftp:mkdir-local', async (_event, rawDir, rawName) => { const parent = path.resolve(String(rawDir)); const name = String(rawName || '').trim(); if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('文件夹名称无效'); const target = path.join(parent, name); await fs.promises.mkdir(target); return { path: target }; });
ipcMain.handle('sftp:mkdir-remote', async (_event, sessionId, rawDir, rawName) => withSftp(sessionId, async (sftp) => { const dir = normalizeRemotePath(rawDir), name = String(rawName || '').trim(); if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('文件夹名称无效'); const target = path.posix.join(dir, name); await sftpCall(sftp, 'mkdir', target); return { path: target }; }));
ipcMain.handle('sftp:rename-local', async (_event, rawPath, rawName) => { const src = path.resolve(String(rawPath)), name = String(rawName || '').trim(); if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('文件名无效'); const target = path.join(path.dirname(src), name); if (fs.existsSync(target)) throw new Error(`目标已存在：${target}`); await fs.promises.rename(src, target); return { path: target }; });
ipcMain.handle('sftp:rename-remote', async (_event, sessionId, rawPath, rawName) => withSftp(sessionId, async (sftp) => { const src = normalizeRemotePath(rawPath), name = String(rawName || '').trim(); if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('文件名无效'); const target = path.posix.join(path.posix.dirname(src), name); if (await sftpStat(sftp, target)) throw new Error(`目标已存在：${target}`); await sftpCall(sftp, 'rename', src, target); return { path: target }; }));
ipcMain.handle('sftp:move-local', async (_event, rawPath, rawDir) => moveLocal(rawPath, rawDir));
ipcMain.handle('sftp:move-remote', async (_event, sessionId, rawPath, rawDir) => withSftp(sessionId, async (sftp) => { const src = normalizeRemotePath(rawPath), dir = normalizeRemotePath(rawDir), target = path.posix.join(dir, path.posix.basename(src)); if (await sftpStat(sftp, target)) throw new Error(`目标已存在：${target}`); await sftpCall(sftp, 'rename', src, target); return { source: src, target }; }));
ipcMain.handle('sftp:delete-local', async (_event, rawPaths) => { const paths = Array.isArray(rawPaths) ? rawPaths : [rawPaths]; for (const p of paths) await fs.promises.rm(path.resolve(String(p)), { recursive: true, force: false }); return { ok: true }; });
ipcMain.handle('sftp:delete-remote', async (_event, sessionId, rawPaths) => withSftp(sessionId, async (sftp) => { const paths = Array.isArray(rawPaths) ? rawPaths : [rawPaths]; for (const p of paths) await removeRemoteTree(sftp, normalizeRemotePath(p)); return { ok: true }; }));
ipcMain.handle('sftp:chmod-remote', async (_event, sessionId, rawPaths, rawMode) => withSftp(sessionId, async (sftp) => {
  const text = String(rawMode || '').trim();
  if (!/^[0-7]{3,4}$/.test(text)) throw new Error('权限请输入三位或四位八进制数字，例如 644 或 0755');
  const mode = parseInt(text, 8);
  const targets = (Array.isArray(rawPaths) ? rawPaths : [rawPaths]).map(normalizeRemotePath);
  if (!targets.length) throw new Error('没有选择远程文件');
  for (const target of targets) await sftpCall(sftp, 'chmod', target, mode);
  return { ok: true, count: targets.length, paths: targets, permissions: text.replace(/^0(?=\d{3}$)/, '') };
}));
ipcMain.handle('sftp:chown-remote', async (_event, sessionId, rawPath, rawUid, rawGid) => {
  const target = normalizeRemotePath(rawPath);
  const uid = Number(rawUid), gid = Number(rawGid);
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) throw new Error('Owner/Group ID 必须是非负整数');
  return withSftp(sessionId, async (sftp) => { await sftpCall(sftp, 'chown', target, uid, gid); return { ok: true, path: target, uid, gid }; });
});
ipcMain.handle('sftp:prepare-remote-drag', async (_event, sessionId, rawPaths) => {
  const paths = Array.isArray(rawPaths) ? rawPaths.map(normalizeRemotePath) : [];
  writeDebugRecord('main', 'remote-drag.prepare.begin', { sessionId, paths });
  if (!paths.length) throw new Error('没有选择远程文件');
  const folder = path.join(app.getPath('temp'), 'N1PilotDesktop-drag', crypto.randomUUID());
  await fs.promises.mkdir(folder, { recursive: true });
  try {
    return await withSftp(sessionId, async (sftp) => {
      const prepared = [];
      for (const remotePath of paths) {
        // Native drag-out tolerates Unix symlinks/sockets inside a directory by omitting those unsupported entries.
        // Ordinary SFTP download behavior remains strict and unchanged.
        const output = await downloadTree(sftp, remotePath, folder, null, { skipUnsupported: true });
        prepared.push(output.rootPath);
      }
      // Keep the cache long enough for Explorer to finish copying the dropped files.
      const timer = setTimeout(() => fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {}), 10 * 60 * 1000);
      timer.unref?.();
      writeDebugRecord('main', 'remote-drag.prepare.success', { sessionId, sourcePaths: paths, preparedPaths: prepared, exists: prepared.map(p => ({ path: p, exists: fs.existsSync(p) })) });
      return { paths: prepared };
    });
  } catch (err) {
    writeDebugRecord('main', 'remote-drag.prepare.error', { sessionId, paths, error: err.stack || err.message || String(err) });
    await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
});
function queueNativeDragCleanup(rawPaths, reason = 'native-drag-finished') {
  const root = path.resolve(app.getPath('temp'), 'N1PilotDesktop-drag');
  const folders = new Set();
  for (const raw of Array.isArray(rawPaths) ? rawPaths : []) {
    const abs = path.resolve(String(raw || ''));
    const rel = path.relative(root, abs);
    // Guard against accidentally deleting arbitrary local files. Only items
    // created inside this app's own remote-drag staging directory are eligible.
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    const parent = path.dirname(abs);
    const parentRel = path.relative(root, parent);
    if (parentRel && parentRel !== '..' && !parentRel.startsWith(`..${path.sep}`) && !path.isAbsolute(parentRel)) folders.add(parent);
  }
  writeDebugRecord('main', 'native-drag.cleanup-scheduled', { reason, folders: [...folders], delayMs: 60 * 1000 });
  // Keep staged items available while Explorer completes the copy after drop.
  const timer = setTimeout(() => {
    for (const folder of folders) fs.promises.rm(folder, { recursive: true, force: true })
      .then(() => writeDebugRecord('main', 'native-drag.cleanup-complete', { folder, reason }))
      .catch((error) => writeDebugRecord('main', 'native-drag.cleanup-error', { folder, reason, error: error.stack || String(error) }));
  }, 60 * 1000);
  timer.unref?.();
  return { ok: true, folders: [...folders] };
}
ipcMain.handle('sftp:cleanup-native-drag', async (_event, rawPaths) => queueNativeDragCleanup(rawPaths, 'renderer-request'));
ipcMain.on('debug:log', (_event, record) => {
  if (!debugEnabled || !record || typeof record !== 'object') return;
  writeDebugRecord('renderer', String(record.action || 'renderer.event'), record);
});
ipcMain.handle('app:get-debug-settings', async () => ({ enabled: debugEnabled, logPath: debugLogPath() }));
ipcMain.handle('app:set-debug-enabled', async (_event, enabled) => {
  const next = enabled === true;
  if (next === debugEnabled) return { enabled: debugEnabled, logPath: debugLogPath() };
  if (debugEnabled) writeDebugRecord('main', 'debug.state', { enabled: next });
  debugEnabled = next;
  writeJson(debugSettingsPath(), { enabled: debugEnabled, updatedAt: new Date().toISOString() });
  if (debugEnabled) writeDebugRecord('main', 'debug.state', { enabled: true });
  return { enabled: debugEnabled, logPath: debugLogPath() };
});
ipcMain.handle('app:open-debug-log-folder', async () => {
  fs.mkdirSync(path.dirname(debugLogPath()), { recursive: true });
  const error = await shell.openPath(path.dirname(debugLogPath()));
  if (error) throw new Error(error);
  return { ok: true, logPath: debugLogPath() };
});

ipcMain.on('app:start-native-drag', (event, rawPaths) => {
  const sender = event.sender;
  if (!sender || sender.isDestroyed()) return;
  writeDebugRecord('main', 'native-drag.request', { rawPaths });
  let files = [];
  try { files = Array.isArray(rawPaths) ? rawPaths.map((p) => path.resolve(String(p))).filter((p) => fs.existsSync(p)) : []; }
  catch (error) { writeDebugRecord('main', 'native-drag.path-validation-error', { error: error.stack || String(error) }); }
  writeDebugRecord('main', 'native-drag.validated', { files, exists: files.map((p) => ({ path: p, exists: fs.existsSync(p) })) });
  if (!files.length) { sender.send('sftp:drag-status', '系统文件拖放失败：没有可用的本地文件路径。'); return; }
  try {
    const icon = path.join(__dirname, 'assets', 'n1pilot.png');
    writeDebugRecord('main', 'native-drag.startDrag.begin', { files, iconExists: fs.existsSync(icon) });
    sender.send('sftp:drag-status', files.length === 1 ? '正在启动系统文件拖放…' : `正在启动 ${files.length} 个文件的系统拖放…`);
    if (files.length === 1) sender.startDrag({ file: files[0], icon });
    else sender.startDrag({ files, icon });
    writeDebugRecord('main', 'native-drag.startDrag.returned', { files });
    queueNativeDragCleanup(files, 'native-drag-returned');
    sender.send('sftp:drag-status', '系统文件拖放已结束；临时文件将在 60 秒后清理。');
  } catch (err) {
    writeDebugRecord('main', 'native-drag.error', { files, error: err.stack || err.message || String(err) });
    sender.send('sftp:drag-status', `系统文件拖放失败：${err.stack || err.message || err}`);
  }
});
ipcMain.handle('app:copy-text', async (_event, rawText) => {
  const { clipboard } = require('electron');
  clipboard.writeText(String(rawText || ''));
  return { ok: true };
});
ipcMain.handle('app:read-clipboard', async () => {
  const { clipboard } = require('electron');
  return clipboard.readText();
});
ipcMain.handle('app:quit', async () => {
  shuttingDown = true;
  for (const session of sessions.values()) { try { if (session.channel) session.channel.close(); } catch {} try { if (session.interactiveShell) session.interactiveShell.close(); } catch {} try { session.client.end(); } catch {} }
  sessions.clear();
  app.quit();
  return { ok: true };
});
