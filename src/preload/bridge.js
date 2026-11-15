'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('auralis', {
  win: (action) => ipcRenderer.invoke('win', action),
  audioStart: () => ipcRenderer.invoke('audio:start'),
  audioStop: () => ipcRenderer.invoke('audio:stop'),
  audioPaused: (p) => ipcRenderer.invoke('audio:paused', p),
  audioSources: () => ipcRenderer.invoke('audio:sources'),
  audioSetSource: (src) => ipcRenderer.invoke('audio:set-source', src),
  audioSource: () => ipcRenderer.invoke('audio:source'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  fetchArt: (url) => ipcRenderer.invoke('art:fetch', url),
  fanSync: (payload) => ipcRenderer.invoke('fansync', payload),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data)),
});
