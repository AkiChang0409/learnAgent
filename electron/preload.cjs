const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('learnAgent', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  searchNotes: (query) => ipcRenderer.invoke('data:search-notes', query),
  retrieveContext: (payload) => ipcRenderer.invoke('data:retrieve-context', payload),
  exportSyncPackage: () => ipcRenderer.invoke('sync:export-package'),
  importSyncPackage: () => ipcRenderer.invoke('sync:import-package'),
  generateNote: (payload) => ipcRenderer.invoke('ai:generate-note', payload),
  importMarkdown: (payload) => ipcRenderer.invoke('ai:import-markdown', payload),
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
