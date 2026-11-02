const { contextBridge, ipcRenderer } = require('electron');

const testHooks = process.env.YREN_TEST ? {
  testAnswer: (a) => ipcRenderer.invoke('yren:test-answer', a),
  testClose: () => ipcRenderer.invoke('yren:test-close'),
} : {};

contextBridge.exposeInMainWorld('yren', {
  ...testHooks,
  askMic: () => ipcRenderer.invoke('yren:ask-mic'),
  setPlaying: (v) => ipcRenderer.send('yren:playing', !!v),
  platform: process.platform,
});
