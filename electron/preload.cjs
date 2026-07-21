const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('learnAgent', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  generateNote: (payload) => ipcRenderer.invoke('ai:generate-note', payload),
  chatWithNote: (payload) => ipcRenderer.invoke('ai:chat-with-note', payload),
  getDataFilePath: () => ipcRenderer.invoke('data:path')
});
