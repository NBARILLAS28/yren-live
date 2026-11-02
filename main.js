// YREN LIVE — proceso principal de Electron
const { app, BrowserWindow, Menu, protocol, session, systemPreferences, ipcMain, powerSaveBlocker, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// La app se sirve por un esquema propio (yren://app/...) para que los módulos ES y el AudioWorklet
// carguen sin problemas de CORS y para que IndexedDB tenga un origen estable.
protocol.registerSchemesAsPrivileged([
  { scheme: 'yren', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Audio en vivo: nada de pausas automáticas ni recortes de timers cuando la ventana está detrás.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let win = null;
let isPlaying = false;     // lo informa la ventana (hay una canción sonando)
let allowClose = false;    // el usuario ya confirmó que quiere cerrar
let quitRequested = false; // ⌘Q en lugar de cerrar solo la ventana

/** Pregunta antes de cerrar si hay música sonando. En pruebas automáticas responde YREN_TEST_ANSWER=close|stay. */
function confirmClose() {
  if (process.env.YREN_TEST_ANSWER) return process.env.YREN_TEST_ANSWER === 'close';
  const r = dialog.showMessageBoxSync(win, {
    type: 'warning', title: 'YREN LIVE', buttons: ['Seguir reproduciendo', 'Cerrar de todos modos'], defaultId: 0, cancelId: 0,
    message: 'Hay una canción sonando',
    detail: 'Si cierras YREN LIVE ahora, la música se detendrá de golpe.',
  });
  return r === 1;
}

function createWindow() {
  allowClose = false; isPlaying = false;
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#050b1a',
    title: 'YREN LIVE',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.loadURL('yren://app/index.html');
  win.on('close', (e) => {
    if (allowClose || !isPlaying) return;
    e.preventDefault();
    if (confirmClose()) { allowClose = true; if (quitRequested) app.quit(); else win.close(); }
    else quitRequested = false;
  });
  win.on('closed', () => { win = null; isPlaying = false; });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Sirve /src por yren://app/
  const root = path.join(__dirname, 'src');
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  };
  protocol.handle('yren', async (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      const data = await fs.promises.readFile(file);
      // Tipo MIME explícito: los módulos ES y el AudioWorklet exigen "text/javascript".
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  // Único permiso que se concede: "media" (solo para leer los nombres de las salidas de audio).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  ipcMain.on('yren:playing', (_e, v) => { isPlaying = !!v; });
  if (process.env.YREN_TEST) { // ganchos solo para pruebas automáticas
    ipcMain.handle('yren:test-answer', (_e, a) => { process.env.YREN_TEST_ANSWER = a; return true; });
    ipcMain.handle('yren:test-close', () => { if (win) win.close(); return !!(win && !win.isDestroyed()); });
  }
  ipcMain.handle('yren:ask-mic', async () => {
    if (process.platform !== 'darwin') return true;
    try { return await systemPreferences.askForMediaAccess('microphone'); } catch { return false; }
  });

  // Evita que el Mac se duerma o suspenda la app durante el servicio.
  powerSaveBlocker.start('prevent-app-suspension');

  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', (e) => {
  quitRequested = true;
  if (isPlaying && !allowClose && win) { e.preventDefault(); win.close(); }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
