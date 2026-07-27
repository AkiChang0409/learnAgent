// The preload remains a narrow, typed-build capability bridge with no Node API exposure.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('learnAgent', {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  loadSnapshot: () => ipcRenderer.invoke('data:load-snapshot'),
  applyChanges: (payload) => ipcRenderer.invoke('data:apply-changes', payload),
  flushData: () => ipcRenderer.invoke('data:flush'),
  setApiKey: (value) => ipcRenderer.invoke('settings:set-api-key', value),
  clearApiKey: () => ipcRenderer.invoke('settings:clear-api-key'),
  searchNotes: (query) => ipcRenderer.invoke('data:search-notes', query),
  retrieveContext: (payload) => ipcRenderer.invoke('data:retrieve-context', payload),
  exportSyncPackage: () => ipcRenderer.invoke('sync:export-package'),
  importSyncPackage: () => ipcRenderer.invoke('sync:import-package'),
  startNoteGeneration: (payload) => ipcRenderer.invoke('ai:start-note-generation', payload),
  onNoteGenerationProgress: (handler) => {
    const listener = (_event, progress) => handler(progress);
    ipcRenderer.on('ai:note-generation-progress', listener);
    return () => ipcRenderer.removeListener('ai:note-generation-progress', listener);
  },
  startEmphasisAnalysis: (payload) => ipcRenderer.invoke('ai:start-emphasis-analysis', payload),
  onEmphasisAnalysisProgress: (handler) => {
    const listener = (_event, progress) => handler(progress);
    ipcRenderer.on('ai:emphasis-analysis-progress', listener);
    return () => ipcRenderer.removeListener('ai:emphasis-analysis-progress', listener);
  },
  selectMarkdownSource: () => ipcRenderer.invoke('ai:select-markdown-source'),
  startMarkdownImport: (payload) => ipcRenderer.invoke('ai:start-markdown-import', payload),
  cancelMarkdownImport: (payload) => ipcRenderer.invoke('ai:cancel-markdown-import', payload),
  onMarkdownImportProgress: (handler) => {
    const listener = (_event, progress) => handler(progress);
    ipcRenderer.on('ai:import-markdown-progress', listener);
    return () => ipcRenderer.removeListener('ai:import-markdown-progress', listener);
  },
  chatWithNote: (payload) => ipcRenderer.invoke('ai:chat-with-note', payload),
  summarizeConversation: (payload) => ipcRenderer.invoke('ai:summarize-conversation', payload),
  distillConversationToNote: (payload) => ipcRenderer.invoke('ai:distill-conversation-to-note', payload),
  testConnection: (payload) => ipcRenderer.invoke('ai:test-connection', payload),
  getDataFilePath: () => ipcRenderer.invoke('data:path')
});
