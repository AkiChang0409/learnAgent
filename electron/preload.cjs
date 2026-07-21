const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('learnAgent', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  searchNotes: (query) => ipcRenderer.invoke('data:search-notes', query),
  generateNote: (payload) => ipcRenderer.invoke('ai:generate-note', payload),
  chatWithNote: (payload) => ipcRenderer.invoke('ai:chat-with-note', payload),
  testConnection: (payload) => ipcRenderer.invoke('ai:test-connection', payload),
  getDataFilePath: () => ipcRenderer.invoke('data:path')
});
