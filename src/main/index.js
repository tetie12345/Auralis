'use strict';
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const AudioCapture = require('./audio');

let win = null;
let audio = null;

const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/130.0.0.0 Safari/537.36';

function isAppleUrl(u) {
  try {
    const h = new URL(u).hostname;
    return h === 'apple.com' || h.endsWith('.apple.com') || h.endsWith('.icloud.com');
  } catch {
    return false;
  }
}

function openChild(parent, url) {
  const child = new BrowserWindow({
    width: 520,
    height: 760,
    parent,
    modal: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f7',
    title: 'Apple Account',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  child.loadURL(url);
  child.on('closed', () => parent.webContents.focus());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1080,
    minHeight: 660,
    frame: false,
    show: false,
    backgroundColor: '#0a0c12',
    autoHideMenuBar: true,
    title: 'Auralis',
    webPreferences: {
      preload: path.join(__dirname, '../preload/bridge.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win.show());

  // popups opened by the embedded Apple player (Apple ID sign-in etc.)
  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      if (isAppleUrl(url)) openChild(win, url);
      else shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppleUrl(url)) openChild(win, url);
    else shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  const appleSession = session.fromPartition('persist:apple');
  appleSession.setUserAgent(CHROME_UA, 'en-US');
  appleSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));

  audio = new AudioCapture(null);
  createWindow();
  audio.win = win; // window must exist before chunks can be forwarded

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (audio) audio.stop();
  app.quit();
});

// ---------------------------------------------------------------- IPC: window
ipcMain.handle('win', (_e, action) => {
  if (!win) return false;
  switch (action) {
    case 'minimize': win.minimize(); return true;
    case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); return win.isMaximized();
    case 'close': win.close(); return true;
    case 'is-maximized': return win.isMaximized();
    default: return false;
  }
});

// ---------------------------------------------------------------- IPC: audio
ipcMain.handle('audio:start', () => audio.start());
ipcMain.handle('audio:stop', () => audio.stop());
ipcMain.handle('audio:paused', (_e, p) => audio.setPaused(!!p));
ipcMain.handle('audio:sources', () => audio.listSources());
ipcMain.handle('audio:set-source', (_e, src) => audio.useSource(src));
ipcMain.handle('audio:source', () => audio.source);

// ---------------------------------------------------------------- IPC: misc
ipcMain.handle('open-external', (_e, url) => {
  if (/^https?:\/\//.test(url) && !isAppleUrl(url)) shell.openExternal(url);
});

ipcMain.handle('art:fetch', async (_e, url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || 'image/jpeg';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
});
