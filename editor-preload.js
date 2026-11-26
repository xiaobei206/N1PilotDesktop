const { contextBridge, ipcRenderer } = require('electron');

const allowedEvents = new Set(['editor:language', 'editor:close-request', 'editor:flush-draft-and-quit']);
contextBridge.exposeInMainWorld('remoteEditor', {
  initialize: () => ipcRenderer.invoke('editor:initialize'),
  validate: (text, language) => ipcRenderer.invoke('editor:validate', text, language),
  save: (payload) => ipcRenderer.invoke('editor:save', payload),
  checkShellRemote: (text) => ipcRenderer.invoke('editor:check-shell-remote', text),
  saveDraft: (payload) => ipcRenderer.invoke('editor:save-draft', payload),
  deleteDraft: () => ipcRenderer.invoke('editor:delete-draft'),
  discardRecoveryDraft: (draftId) => ipcRenderer.invoke('editor:discard-recovery-draft', draftId),
  diffLines: (left, right) => ipcRenderer.invoke('editor:diff-lines', left, right),
  setDirty: (dirty) => ipcRenderer.send('editor:set-dirty', dirty === true),
  closeDecision: (decision) => ipcRenderer.send('editor:close-decision', String(decision || 'cancel')),
  flushDraftComplete: (result) => ipcRenderer.send('editor:flush-draft-complete', { ok: result?.ok === true, error: String(result?.error || '') }),
  setLanguage: (language) => ipcRenderer.invoke('app:set-language', language),
  getDebugSettings: () => ipcRenderer.invoke('app:get-debug-settings'),
  setDebugEnabled: (enabled) => ipcRenderer.invoke('app:set-debug-enabled', enabled === true),
  openDebugLogFolder: () => ipcRenderer.invoke('app:open-debug-log-folder'),
  copyText: (text) => ipcRenderer.invoke('app:copy-text', String(text ?? '')),
  debugLog: (record) => ipcRenderer.send('debug:log', record),
  on: (channel, callback) => {
    if (!allowedEvents.has(channel)) return;
    ipcRenderer.on(channel, (_event, data) => callback(data));
  }
});
