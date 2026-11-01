const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yren', {
  askMic: () => ipcRenderer.invoke('yren:ask-mic'),
  platform: process.platform,
});
