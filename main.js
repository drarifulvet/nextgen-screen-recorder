// NextGen Screen Recorder — main process
// Screen + camera bubble + microphone + computer sound in one video, with presenter tools,
// live streaming (RTMP/RTMPS), a recordings library, trimming/GIF/compress (FFmpeg),
// update notices, crash recovery and a portable mode.
'use strict';

const {
  app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, shell, screen,
  protocol, globalShortcut, Tray, Menu, nativeImage, nativeTheme, net, safeStorage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { spawn } = require('child_process');

const APP_ID = 'com.nextgenit.screenrecorder';
const GITHUB_REPO = 'drarifulvet/nextgen-screen-recorder';
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
const APP_VERSION = require('./package.json').version;
const { PLATFORMS, QUALITY, LiveSession } = require('./live');

// ---------- portable mode ----------
// The portable zip contains a 'portable.ini' file next to the app. When it is there, settings,
// stream keys and the Library list are kept in a 'NextGen Recorder Data' folder beside the app.
const IS_PORTABLE = (() => {
  if (!app.isPackaged) return !!process.env.NGR_PORTABLE_DIR;
  return fs.existsSync(path.join(path.dirname(process.execPath), 'portable.ini'));
})();
let portableDataOk = false;
if (IS_PORTABLE) {
  const base = process.env.NGR_PORTABLE_DIR || path.dirname(process.execPath);
  const dataDir = path.join(base, 'NextGen Recorder Data');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    app.setPath('userData', dataDir);
    portableDataOk = true;
  } catch { /* read-only location: fall back to the Windows profile */ }
}

app.setAppUserModelId(APP_ID);
if (!app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ---------- paths ----------
const USER = () => app.getPath('userData');
const SETTINGS_FILE = () => path.join(USER(), 'settings.json');
const LIBRARY_FILE = () => path.join(USER(), 'library.json');
const THUMBS = () => path.join(USER(), 'thumbs');
const RECOVERY = () => path.join(USER(), 'recovery');

function ffmpegPath() {
  if (process.env.NGR_FFMPEG) return process.env.NGR_FFMPEG;
  if (process.platform === 'win32') {
    return app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg.exe') : path.join(__dirname, 'vendor', 'ffmpeg.exe');
  }
  return 'ffmpeg';
}

// ---------- settings ----------
const DEFAULTS = {
  saveDir: '',
  askWhereToSave: false,
  quality: '1080',
  fps: 30,
  countdown: true,
  systemAudio: true,
  standardMp4: true,
  camId: '',
  micId: '',
  camShape: 'circle',
  camSize: 0.27,
  camX: 0.86,
  camY: 0.8,
  blur: false,
  cursorHalo: true,
  clickRipples: true,
  mode: 'screen',
  area: null,
  theme: 'system',
  checkUpdates: true,
  tourDone: false,
  liveOn: false,
  livePlatform: 'youtube',
  liveQuality: '720',
};
let settings = { ...DEFAULTS };

function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; }
  if (!settings.saveDir) settings.saveDir = path.join(app.getPath('videos'), 'NextGen Recorder');
  nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system';
}
function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2)); } catch { /* ignore */ }
}

// ---------- library ----------
let library = [];
function loadLibrary() {
  try { library = JSON.parse(fs.readFileSync(LIBRARY_FILE(), 'utf8')); } catch { library = []; }
  library = library.filter((e) => e && e.path && fs.existsSync(e.path));
}
function saveLibrary() {
  try { fs.writeFileSync(LIBRARY_FILE(), JSON.stringify(library, null, 2)); } catch { /* ignore */ }
}
function publicEntry(e) {
  return { ...e, url: `media://file/${e.id}`, thumbUrl: e.thumb && fs.existsSync(e.thumb) ? `media://thumb/${e.id}?v=${e.updated || 0}` : null };
}
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- state ----------
let mainWin = null;
let barWin = null;
let regionWin = null;
let frameWin = null;
let drawWin = null;
let tray = null;
let selected = { sourceId: null, systemAudio: true, display: null };
let rec = { stream: null, tmpPath: null, metaPath: null, ext: 'mp4' };
let recState = { recording: false, paused: false, muted: false, camOn: true, drawing: false };
let cursorTimer = null;
let hook = null;
let hookOn = false;
const shortcutStatus = {};

// ---------- windows ----------
const PRELOAD = path.join(__dirname, 'preload.js');
const webPrefs = (extra = {}) => ({
  preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true,
  backgroundThrottling: false, ...extra,
});
const page = (name) => `app://bundle/renderer/${name}`;

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1120, height: 760, minWidth: 900, minHeight: 620,
    title: 'NextGen Screen Recorder',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0F2A31' : '#F3F7F6',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: webPrefs({ autoplayPolicy: 'no-user-gesture-required' }),
  });
  mainWin.setMenu(null);
  mainWin.loadURL(page('index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('close', async (e) => {
    if (!recState.recording) return;
    e.preventDefault();
    const r = await dialog.showMessageBox(mainWin, {
      type: 'question', buttons: ['Stop and save', 'Keep recording'], defaultId: 0, cancelId: 1,
      title: 'Recording in progress', message: 'A recording is in progress.',
      detail: 'Stop and save it before closing?',
    });
    if (r.response === 0) toMain('command', 'stop');
  });
  mainWin.on('closed', () => {
    mainWin = null;
    [barWin, regionWin, frameWin, drawWin].forEach((w) => { if (w && !w.isDestroyed()) w.destroy(); });
  });
}

function toMain(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}
function toBar(channel, payload) {
  if (barWin && !barWin.isDestroyed()) barWin.webContents.send(channel, payload);
}

function displayForSelection() {
  return selected.display || screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
}

function createBar() {
  if (barWin) return;
  const b = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const w = 640; const h = 80; // replaced by the bar's measured size before it is shown
  barWin = new BrowserWindow({
    width: w, height: h, x: Math.round(b.x + (b.width - w) / 2), y: b.y + 10, show: false,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, transparent: true,
    // focusable: false = clicking the bar never takes the keyboard away from PowerPoint or other apps
    hasShadow: false, focusable: false, webPreferences: webPrefs(),
  });
  barWin.setAlwaysOnTop(true, 'screen-saver');
  barWin.setContentProtection(true); // excluded from the recording on Windows 10 2004+ / 11
  barWin.loadURL(page('controlbar.html'));
  barWin.on('closed', () => { barWin = null; });
  setTimeout(() => { if (barWin && !barWin.isDestroyed() && !barWin.isVisible()) barWin.showInactive(); }, 1500);
}

// Resize the bar window to exactly fit the bar (it reports its own size), keeping it centred where it is.
function fitBar(size) {
  if (!barWin || barWin.isDestroyed()) return;
  const w = Math.max(200, Math.min(1600, Math.ceil(size.w)));
  const h = Math.max(40, Math.min(400, Math.ceil(size.h)));
  const b = barWin.getBounds();
  const x = barWin.isVisible() ? Math.round(b.x + (b.width - w) / 2) : b.x + Math.round((b.width - w) / 2);
  barWin.setResizable(true);
  barWin.setBounds({ x, y: b.y, width: w, height: h });
  barWin.setResizable(false);
  if (!barWin.isVisible()) barWin.showInactive();
  liftBar();
}

function createAreaFrame(area) {
  closeAreaFrame();
  const d = displayForSelection();
  const pad = 4;
  frameWin = new BrowserWindow({
    x: Math.round(d.x + area.x - pad), y: Math.round(d.y + area.y - pad),
    width: Math.round(area.w + pad * 2), height: Math.round(area.h + pad * 2),
    frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, webPreferences: webPrefs(),
  });
  frameWin.setIgnoreMouseEvents(true);
  frameWin.setAlwaysOnTop(true, 'screen-saver');
  frameWin.setContentProtection(true);
  frameWin.loadURL(page('frame.html'));
}
function closeAreaFrame() { if (frameWin && !frameWin.isDestroyed()) frameWin.destroy(); frameWin = null; }

function createDrawOverlay() {
  if (drawWin) return;
  const d = displayForSelection();
  drawWin = new BrowserWindow({
    x: d.x, y: d.y, width: d.width, height: d.height,
    frame: false, transparent: true, resizable: false, movable: false, alwaysOnTop: true,
    // focusable: false = the pen takes the mouse but never the keyboard,
    // so arrow keys / Page Down keep changing slides while drawing
    skipTaskbar: true, hasShadow: false, show: false, focusable: false, webPreferences: webPrefs(),
  });
  drawWin.setAlwaysOnTop(true, 'pop-up-menu');
  drawWin.loadURL(page('draw.html'));
  drawWin.on('closed', () => { drawWin = null; });
}

// Windows ignores always-on-top "levels": the most recently shown top-most window wins.
// While drawing, keep lifting the control bar above the drawing layer so its buttons stay clickable.
let barLiftTimer = null;
function liftBar() {
  if (!barWin || barWin.isDestroyed()) return;
  barWin.setAlwaysOnTop(true, 'screen-saver');
  barWin.moveTop();
}
function startBarLift() { stopBarLift(); liftBar(); barLiftTimer = setInterval(liftBar, 400); }
function stopBarLift() { if (barLiftTimer) clearInterval(barLiftTimer); barLiftTimer = null; }

const COLORS = [['#FF3B30', 'Red'], ['#FFD60A', 'Yellow'], ['#C3F44D', 'Lime'], ['#0A84FF', 'Blue']];
const TOOL_NAMES = { pen: 'Pen', highlighter: 'Highlighter', arrow: 'Arrow', box: 'Box' };
let drawState = { tool: 'pen', color: COLORS[0][0], mouse: false };

function sendDraw(msg) { if (drawWin && !drawWin.isDestroyed()) drawWin.webContents.send('draw', msg); }

function setDrawing(on) {
  if (on && selected.kind === 'window') {
    toBar('toast', 'Pen needs Screen or Area');
    return;
  }
  recState.drawing = on;
  if (on) {
    drawState.mouse = false;
    createDrawOverlay();
    const wc = drawWin.webContents;
    const reveal = () => {
      if (!drawWin) return;
      drawWin.setIgnoreMouseEvents(false);
      drawWin.showInactive();
      sendDraw({ cmd: 'show' });
      sendDraw({ cmd: 'tool', tool: drawState.tool, color: drawState.color, mouse: false });
      startBarLift();
    };
    if (wc.isLoading()) wc.once('did-finish-load', reveal); else reveal();
    registerDrawShortcuts();
  } else {
    unregisterDrawShortcuts();
    stopBarLift();
    drawState.mouse = false;
    if (drawWin) {
      sendDraw({ cmd: 'clear' });
      drawWin.setIgnoreMouseEvents(false);
      drawWin.hide();
    }
  }
  pushState();
}

function setDrawTool(tool) {
  if (!recState.drawing) return;
  drawState.tool = tool;
  if (drawState.mouse) setMouseMode(false, true);
  sendDraw({ cmd: 'tool', tool });
  pushState();
}
function setDrawColor(color) {
  if (!recState.drawing) return;
  drawState.color = color;
  if (drawState.mouse) setMouseMode(false, true);
  sendDraw({ cmd: 'tool', color });
  pushState();
  const name = (COLORS.find((c) => c[0] === color) || [])[1];
  if (name) toBar('toast', `${name} ${TOOL_NAMES[drawState.tool].toLowerCase()}`);
}
// Mouse mode: drawings stay on screen but clicks pass through to the app underneath.
function setMouseMode(on, quiet) {
  if (!recState.drawing || !drawWin) return;
  drawState.mouse = on;
  drawWin.setIgnoreMouseEvents(on, { forward: true });
  sendDraw({ cmd: 'mouse', on });
  if (!quiet) toBar('toast', on ? 'Mouse mode: click slides' : 'Pen ready');
  liftBar();
  pushState();
}

const DRAW_SHORTCUTS = [
  ['Alt+Shift+1', () => setDrawColor(COLORS[0][0]), 'Red pen'],
  ['Alt+Shift+2', () => setDrawColor(COLORS[1][0]), 'Yellow pen'],
  ['Alt+Shift+3', () => setDrawColor(COLORS[2][0]), 'Lime pen'],
  ['Alt+Shift+4', () => setDrawColor(COLORS[3][0]), 'Blue pen'],
  ['Alt+Shift+Z', () => sendDraw({ cmd: 'undo' }), 'Undo last drawing'],
  ['Alt+Shift+X', () => sendDraw({ cmd: 'clear' }), 'Clear all drawings'],
  ['Alt+Shift+F', () => setMouseMode(!drawState.mouse), 'Switch between pen and mouse'],
];
function registerDrawShortcuts() {
  for (const [acc, fn] of DRAW_SHORTCUTS) {
    try { if (!globalShortcut.isRegistered(acc)) globalShortcut.register(acc, fn); } catch { /* in use elsewhere */ }
  }
}
function unregisterDrawShortcuts() {
  for (const [acc] of DRAW_SHORTCUTS) { try { globalShortcut.unregister(acc); } catch { /* ignore */ } }
}

// ---------- cursor + clicks (for the cursor halo and click ripples) ----------
function startPointerTracking() {
  stopPointerTracking();
  cursorTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    toMain('pointer', { x: p.x, y: p.y });
  }, 33);
  if (!hook) {
    try { hook = require('uiohook-napi').uIOhook; } catch { hook = null; }
    if (hook) {
      hook.on('mousedown', (e) => {
        let p = { x: e.x, y: e.y };
        if (process.platform === 'win32') p = screen.screenToDipPoint(p);
        toMain('click', { x: p.x, y: p.y, button: e.button });
      });
    }
  }
  if (hook && !hookOn) { try { hook.start(); hookOn = true; } catch { hookOn = false; } }
}
function stopPointerTracking() {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = null;
  if (hook && hookOn) { try { hook.stop(); } catch { /* ignore */ } hookOn = false; }
}

// ---------- shortcuts + tray ----------
const SHORTCUTS = [
  ['Alt+Shift+R', 'toggle', 'Start or stop recording'],
  ['Alt+Shift+P', 'pause', 'Pause or resume'],
  ['Alt+Shift+M', 'mute', 'Mute or unmute microphone'],
  ['Alt+Shift+C', 'camera', 'Show or hide camera'],
  ['Alt+Shift+D', 'draw', 'Draw on screen'],
];
function registerShortcuts() {
  for (const [acc, cmd] of SHORTCUTS) {
    let ok = false;
    try { ok = globalShortcut.register(acc, () => runCommand(cmd)); } catch { ok = false; }
    shortcutStatus[acc] = ok;
  }
}
function runCommand(cmd) {
  if (cmd === 'draw') return recState.recording ? setDrawing(!recState.drawing) : null;
  toMain('command', cmd);
}

function buildTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', process.platform === 'win32' ? 'tray16.png' : 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('NextGen Screen Recorder');
  tray.on('click', showMain);
  refreshTray();
}
function refreshTray() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: recState.recording ? 'Stop and save' : 'Start recording', click: () => runCommand('toggle') },
    { label: recState.paused ? 'Resume' : 'Pause', enabled: recState.recording, click: () => runCommand('pause') },
    { type: 'separator' },
    { label: 'Open NextGen Recorder', click: showMain },
    { label: 'Open recordings folder', click: () => { fs.mkdirSync(settings.saveDir, { recursive: true }); shell.openPath(settings.saveDir); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(recState.live === 'live' ? 'NextGen Screen Recorder — LIVE' : recState.recording ? 'NextGen Screen Recorder — recording' : 'NextGen Screen Recorder');
}
function showMain() {
  if (!mainWin) return createMainWindow();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}
function pushState() {
  toBar('state', { ...recState, tool: drawState.tool, color: drawState.color, mouse: drawState.mouse });
  toMain('rec-state', recState);
  refreshTray();
}

// ---------- protocols ----------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json',
  '.tflite': 'application/octet-stream', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif',
};

function registerProtocols() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(__dirname, rel));
    if (!file.startsWith(__dirname)) return new Response('Forbidden', { status: 403 });
    try {
      const buf = await fsp.readFile(file);
      return new Response(buf, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  // media://file/<id> and media://thumb/<id> — only files that are in the library.
  protocol.handle('media', async (req) => {
    const u = new URL(req.url);
    const id = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    const entry = library.find((e) => e.id === id);
    const file = entry ? (u.host === 'thumb' ? entry.thumb : entry.path) : null;
    if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    const size = (await fsp.stat(file)).size;
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.get('range');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      if (!m || !m[1]) { start = Math.max(0, size - (parseInt(m && m[2], 10) || 0)); end = size - 1; }
      end = Math.min(end, size - 1);
      if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      const fh = await fsp.open(file, 'r');
      const len = end - start + 1;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      await fh.close();
      return new Response(buf, {
        status: 206,
        headers: { 'content-type': type, 'content-length': String(len), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' },
      });
    }
    const buf = await fsp.readFile(file);
    return new Response(buf, { headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } });
  });
}

// ---------- app lifecycle ----------
app.whenReady().then(() => {
  loadSettings();
  loadLibrary();
  fs.mkdirSync(THUMBS(), { recursive: true });
  fs.mkdirSync(RECOVERY(), { recursive: true });
  registerProtocols();

  const ses = session.defaultSession;
  const ours = (u) => String(u || '').startsWith('app://bundle');
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(['media', 'display-capture'].includes(permission) && ours(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => ['media', 'display-capture'].includes(permission) && (ours(origin) || origin === ''));
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const src = sources.find((s) => s.id === selected.sourceId) || sources[0];
      const answer = { video: src };
      if (selected.systemAudio && process.platform === 'win32') answer.audio = 'loopback';
      callback(answer);
    } catch {
      callback({});
    }
  });

  createMainWindow();
  registerShortcuts();
  try { buildTray(); } catch { tray = null; }
  nativeTheme.on('updated', () => toMain('theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
});

app.on('second-instance', showMain);
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopPointerTracking(); });
app.on('window-all-closed', () => app.quit());

// ---------- IPC: settings, info ----------
ipcMain.handle('init', () => ({
  settings,
  version: APP_VERSION,
  platform: process.platform,
  shortcuts: SHORTCUTS.map(([acc, cmd, label]) => ({ acc, cmd, label, ok: shortcutStatus[acc] !== false })),
  drawShortcuts: DRAW_SHORTCUTS.map(([acc, , label]) => ({ acc, label })),
  hasClickHook: (() => { try { require.resolve('uiohook-napi'); return true; } catch { return false; } })(),
  portable: IS_PORTABLE ? { dataDir: portableDataOk ? USER() : null } : null,
  live: liveInfo(),
  dark: nativeTheme.shouldUseDarkColors,
  library: library.map(publicEntry),
  recovery: listRecovery(),
}));
ipcMain.handle('set-settings', (e, patch) => {
  settings = { ...settings, ...patch };
  if ('theme' in patch) nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system';
  saveSettings();
  return settings;
});
ipcMain.handle('choose-save-dir', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Choose where recordings are saved', defaultPath: settings.saveDir, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  settings.saveDir = r.filePaths[0];
  saveSettings();
  return settings.saveDir;
});
ipcMain.handle('open-save-dir', () => { fs.mkdirSync(settings.saveDir, { recursive: true }); return shell.openPath(settings.saveDir); });
ipcMain.handle('open-external', (e, url) => {
  const allowed = [/^https:\/\/(github\.com|api\.github\.com)\//, ...Object.values(PLATFORMS).filter((p) => p.keyUrl).map((p) => new RegExp('^' + p.keyUrl.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')))];
  if (allowed.some((r) => r.test(url))) shell.openExternal(url);
  return true;
});

// ---------- IPC: sources ----------
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
  const displays = screen.getAllDisplays();
  return sources
    .filter((s) => !/NextGen Screen Recorder/i.test(s.name))
    .map((s, i) => {
      const disp = s.id.startsWith('screen:') ? (displays.find((d) => String(d.id) === String(s.display_id)) || displays[i] || displays[0]) : null;
      return {
        id: s.id, name: s.name, isScreen: s.id.startsWith('screen:'),
        thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        display: disp ? { ...disp.bounds, scaleFactor: disp.scaleFactor, primary: disp.id === screen.getPrimaryDisplay().id } : null,
      };
    });
});

ipcMain.handle('select-source', (e, { sourceId, systemAudio, display, kind }) => {
  selected = { sourceId, systemAudio: !!systemAudio, display: display || null, kind: kind || 'screen' };
  if (drawWin) { drawWin.destroy(); drawWin = null; }
  return { platform: process.platform };
});

ipcMain.handle('pointer-tracking', (e, on) => { if (on) startPointerTracking(); else stopPointerTracking(); return true; });

// ---------- IPC: area selection ----------
ipcMain.handle('select-area', async () => {
  const d = displayForSelection();
  if (regionWin) regionWin.destroy();
  return new Promise((resolve) => {
    regionWin = new BrowserWindow({
      x: d.x, y: d.y, width: d.width, height: d.height, frame: false, transparent: true,
      resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
      fullscreenable: false, webPreferences: webPrefs(),
    });
    regionWin.setAlwaysOnTop(true, 'screen-saver');
    regionWin.loadURL(page('region.html'));
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      ipcMain.removeHandler('region-done');
      if (regionWin && !regionWin.isDestroyed()) regionWin.destroy();
      regionWin = null;
      if (mainWin) { mainWin.show(); mainWin.focus(); }
      resolve(val);
    };
    ipcMain.removeHandler('region-done');
    ipcMain.handle('region-done', (ev, rect) => { finish(rect && rect.w >= 40 && rect.h >= 40 ? rect : null); return true; });
    regionWin.on('closed', () => finish(null));
    if (mainWin) mainWin.hide();
  });
});

// ---------- IPC: recording to disk (crash-safe) ----------
ipcMain.handle('rec-begin', (e, { ext, startedAt }) => {
  rec.ext = ext === 'webm' ? 'webm' : 'mp4';
  const base = `rec-${Date.now()}`;
  rec.tmpPath = path.join(RECOVERY(), `${base}.${rec.ext}`);
  rec.metaPath = path.join(RECOVERY(), `${base}.json`);
  fs.writeFileSync(rec.metaPath, JSON.stringify({ ext: rec.ext, startedAt: startedAt || Date.now() }));
  rec.stream = fs.createWriteStream(rec.tmpPath);
  return true;
});
ipcMain.handle('rec-chunk', (e, buf) => {
  if (!rec.stream) return false;
  return new Promise((resolve) => rec.stream.write(Buffer.from(buf), () => resolve(true)));
});
ipcMain.handle('rec-end', async (e, { durationMs }) => {
  if (!rec.stream) return { ok: false, error: 'No recording in progress.' };
  await new Promise((r) => rec.stream.end(r));
  rec.stream = null;
  const out = await finalizeRecording(rec.tmpPath, rec.metaPath, durationMs);
  rec.tmpPath = null; rec.metaPath = null;
  return out;
});
ipcMain.handle('rec-discard', () => {
  if (rec.stream) { rec.stream.destroy(); rec.stream = null; }
  for (const p of [rec.tmpPath, rec.metaPath]) { try { if (p) fs.unlinkSync(p); } catch { /* ignore */ } }
  rec.tmpPath = null; rec.metaPath = null;
  return true;
});

function stampName(d = new Date(), ext = 'mp4') {
  const p = (n) => String(n).padStart(2, '0');
  return `Recording ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
}
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; i < 1000; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
  return path.join(dir, `${name}-${Date.now()}${ext}`);
}

async function finalizeRecording(tmpPath, metaPath, durationMs, when) {
  const ext = path.extname(tmpPath).slice(1);
  let target;
  if (settings.askWhereToSave && !when) {
    if (mainWin) { mainWin.restore(); mainWin.focus(); }
    const r = await dialog.showSaveDialog(mainWin, { title: 'Save recording', defaultPath: path.join(settings.saveDir, stampName(new Date(), 'mp4')), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    target = r.canceled || !r.filePath ? null : r.filePath;
  }
  fs.mkdirSync(settings.saveDir, { recursive: true });
  if (!target) target = uniquePath(path.join(settings.saveDir, stampName(when || new Date(), 'mp4')));
  if (!target.toLowerCase().endsWith('.mp4')) target += '.mp4';

  // Convert to the most compatible MP4 (H.264 + AAC, fast start). Falls back to the raw file.
  let converted = false;
  if (settings.standardMp4) {
    toMain('busy', 'Making the video play everywhere…');
    const r = await runFfmpeg(['-y', '-i', tmpPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', target]);
    converted = r.ok && fs.existsSync(target) && fs.statSync(target).size > 0;
  }
  if (!converted) {
    if (ext !== 'mp4') target = target.replace(/\.mp4$/i, `.${ext}`);
    moveFile(tmpPath, target);
  } else {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
  try { if (metaPath) fs.unlinkSync(metaPath); } catch { /* ignore */ }
  const entry = await addToLibrary(target, durationMs);
  toMain('busy', null);
  return { ok: true, entry: publicEntry(entry) };
}

async function addToLibrary(file, durationMs) {
  const id = newId();
  const thumb = path.join(THUMBS(), `${id}.jpg`);
  const probe = await probeVideo(file);
  const seek = Math.min(1, Math.max(0, ((probe.duration || durationMs / 1000 || 2) / 2)));
  await runFfmpeg(['-y', '-ss', String(seek), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', thumb]);
  const entry = {
    id, path: file, name: path.basename(file), created: Date.now(), updated: Date.now(),
    durationMs: probe.duration ? Math.round(probe.duration * 1000) : (durationMs || 0),
    size: fs.statSync(file).size, width: probe.width || 0, height: probe.height || 0,
    thumb: fs.existsSync(thumb) ? thumb : null,
  };
  library.unshift(entry);
  saveLibrary();
  toMain('library', library.map(publicEntry));
  return entry;
}

// ---------- crash recovery ----------
function listRecovery() {
  try {
    return fs.readdirSync(RECOVERY())
      .filter((f) => /\.(mp4|webm)$/.test(f))
      .map((f) => {
        const p = path.join(RECOVERY(), f);
        const st = fs.statSync(p);
        return { file: f, size: st.size, when: st.mtimeMs };
      })
      .filter((r) => r.size > 0 && (!rec.tmpPath || path.basename(rec.tmpPath) !== r.file));
  } catch { return []; }
}
ipcMain.handle('recover', async (e, { file, keep }) => {
  const p = path.join(RECOVERY(), path.basename(file));
  const meta = p.replace(/\.(mp4|webm)$/, '.json');
  if (!fs.existsSync(p)) return { ok: false };
  if (!keep) {
    for (const f of [p, meta]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    return { ok: true };
  }
  let when = new Date();
  try { when = new Date(JSON.parse(fs.readFileSync(meta, 'utf8')).startedAt); } catch { /* ignore */ }
  return finalizeRecording(p, meta, 0, when);
});

// ---------- IPC: library actions ----------
const findEntry = (id) => library.find((e) => e.id === id);

ipcMain.handle('lib-list', () => { loadLibrary(); return library.map(publicEntry); });
ipcMain.handle('lib-open', (e, id) => { const x = findEntry(id); return x ? shell.openPath(x.path) : 'missing'; });
ipcMain.handle('lib-show', (e, id) => { const x = findEntry(id); if (x) shell.showItemInFolder(x.path); return true; });
ipcMain.handle('lib-rename', (e, { id, name }) => {
  const x = findEntry(id);
  if (!x) return { ok: false, error: 'Recording not found.' };
  const ext = path.extname(x.path);
  const clean = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim().replace(/\.(mp4|webm|gif)$/i, '');
  if (!clean) return { ok: false, error: 'Please type a name.' };
  const target = path.join(path.dirname(x.path), clean + ext);
  if (target !== x.path && fs.existsSync(target)) return { ok: false, error: 'A file with that name already exists.' };
  fs.renameSync(x.path, target);
  x.path = target; x.name = path.basename(target); x.updated = Date.now();
  saveLibrary();
  return { ok: true, list: library.map(publicEntry) };
});
ipcMain.handle('lib-delete', async (e, id) => {
  const x = findEntry(id);
  if (!x) return { ok: false };
  try { await shell.trashItem(x.path); } catch { return { ok: false, error: 'Could not move the file to the Recycle Bin.' }; }
  try { if (x.thumb) fs.unlinkSync(x.thumb); } catch { /* ignore */ }
  library = library.filter((y) => y.id !== id);
  saveLibrary();
  return { ok: true, list: library.map(publicEntry) };
});
ipcMain.handle('lib-forget-missing', () => { loadLibrary(); saveLibrary(); return library.map(publicEntry); });

let currentJob = null;
ipcMain.handle('lib-process', async (e, { id, action, start, end }) => {
  const x = findEntry(id);
  if (!x) return { ok: false, error: 'Recording not found.' };
  if (currentJob) return { ok: false, error: 'Another export is still running.' };
  const { dir, name } = path.parse(x.path);
  const dur = (x.durationMs || 0) / 1000;
  const s = Math.max(0, Number(start) || 0);
  const en = end && Number(end) > s ? Number(end) : dur;
  const len = Math.max(0.1, en - s);
  const range = s > 0 || (dur && en < dur - 0.05) ? ['-ss', s.toFixed(3), '-t', len.toFixed(3)] : [];
  let out; let args;
  if (action === 'trim') {
    out = uniquePath(path.join(dir, `${name} (trimmed).mp4`));
    args = ['-y', ...range, '-i', x.path, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out];
  } else if (action === 'gif') {
    out = uniquePath(path.join(dir, `${name}.gif`));
    args = ['-y', ...range, '-i', x.path, '-vf', 'fps=12,scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', out];
  } else if (action === 'compress') {
    out = uniquePath(path.join(dir, `${name} (smaller).mp4`));
    args = ['-y', ...range, '-i', x.path, '-vf', "scale=-2:'min(720,ih)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out];
  } else {
    return { ok: false, error: 'Unknown action.' };
  }
  currentJob = { id, action };
  const r = await runFfmpeg(args, len, (pct) => toMain('job-progress', { id, action, pct }));
  currentJob = null;
  if (!r.ok || !fs.existsSync(out)) return { ok: false, error: 'The export failed. ' + (r.error || '') };
  if (action === 'gif') {
    shell.showItemInFolder(out);
    return { ok: true, file: out, size: fs.statSync(out).size };
  }
  const entry = await addToLibrary(out, len * 1000);
  return { ok: true, entry: publicEntry(entry), list: library.map(publicEntry) };
});
ipcMain.handle('lib-cancel', () => { if (ffmpegChild) ffmpegChild.kill(); return true; });

// ---------- FFmpeg ----------
let ffmpegChild = null;
function runFfmpeg(args, totalSec, onProgress) {
  return new Promise((resolve) => {
    let err = '';
    let child;
    try {
      child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, error: 'FFmpeg could not start.' });
    }
    ffmpegChild = child;
    child.on('error', () => { ffmpegChild = null; resolve({ ok: false, error: 'FFmpeg is missing.' }); });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      err = (err + s).slice(-4000);
      if (onProgress && totalSec) {
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
        if (m) onProgress(Math.min(99, Math.round(((+m[1] * 3600) + (+m[2] * 60) + parseFloat(m[3])) / totalSec * 100)));
      }
    });
    child.on('close', (code) => {
      ffmpegChild = null;
      resolve({ ok: code === 0, error: code === 0 ? '' : err.split('\n').filter(Boolean).slice(-2).join(' ') });
    });
  });
}
function probeVideo(file) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try { child = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true }); } catch { return resolve({}); }
    child.on('error', () => resolve({}));
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', () => {
      const d = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(out);
      const v = /Video:.*?, (\d{2,5})x(\d{2,5})/.exec(out);
      resolve({
        duration: d ? (+d[1] * 3600) + (+d[2] * 60) + parseFloat(d[3]) : 0,
        width: v ? +v[1] : 0, height: v ? +v[2] : 0,
      });
    });
  });
}

// ---------- IPC: recording session (windows, bar, draw) ----------
ipcMain.handle('recording-started', (e, info) => {
  recState = { recording: true, paused: false, muted: !!info.muted, camOn: info.camOn !== false, drawing: false };
  createBar();
  if (info.area) createAreaFrame(info.area);
  if (mainWin) mainWin.minimize();
  pushState();
  return true;
});
ipcMain.handle('recording-finished', () => {
  recState = { recording: false, paused: false, muted: false, camOn: true, drawing: false };
  if (barWin && !barWin.isDestroyed()) barWin.destroy();
  barWin = null;
  closeAreaFrame();
  unregisterDrawShortcuts();
  stopBarLift();
  drawState.mouse = false;
  if (drawWin) { sendDraw({ cmd: 'clear' }); drawWin.setIgnoreMouseEvents(false); drawWin.hide(); }
  pushState();
  return true;
});
ipcMain.on('rec-state', (e, s) => { recState = { ...recState, ...s }; pushState(); });
ipcMain.on('bar-time', (e, t) => toBar('time', t));

// control bar -> main window / draw overlay
ipcMain.on('bar-command', (e, cmd) => {
  if (cmd === 'draw') return setDrawing(!recState.drawing);
  if (cmd && typeof cmd === 'object') {
    if (cmd.size) return fitBar(cmd.size);
    if (cmd.tool) setDrawTool(cmd.tool);
    if (cmd.color) setDrawColor(cmd.color);
    return;
  }
  if (cmd === 'mouse') return setMouseMode(!drawState.mouse);
  if (cmd === 'undo' || cmd === 'clear') { sendDraw({ cmd }); return; }
  if (cmd === 'bar-expand' || cmd === 'bar-collapse') {
    if (barWin) { const b = barWin.getBounds(); barWin.setBounds({ ...b, height: cmd === 'bar-expand' ? 112 : 62 }); liftBar(); }
    return;
  }
  toMain('command', cmd);
});
ipcMain.on('draw-exit', () => setDrawing(false));

// ---------- live streaming ----------
// Stream keys are encrypted with Windows' own protection (DPAPI) for this Windows account.
function encKey(plain) {
  if (!plain) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  return 'b64:' + Buffer.from(plain, 'utf8').toString('base64');
}
function decKey(stored) {
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    if (stored.startsWith('b64:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8');
  } catch { return ''; }
  return '';
}
function liveInfo() {
  const keys = settings.liveKeys || {};
  const keyInfo = {};
  for (const id of Object.keys(PLATFORMS)) {
    const k = decKey(keys[id]);
    keyInfo[id] = keys[id] ? (k ? { saved: true, tail: k.slice(-4) } : { saved: false, unreadable: true }) : { saved: false };
  }
  return {
    platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([id, p]) => [id, { name: p.name, server: p.server, keyUrl: p.keyUrl, keyHelp: p.keyHelp, note: p.note || null }])),
    quality: Object.fromEntries(Object.entries(QUALITY).map(([id, q]) => [id, q.label])),
    keyInfo,
    customServer: settings.liveCustomServer || '',
  };
}
ipcMain.handle('live-info', () => liveInfo());
ipcMain.handle('live-save', (e, { platform, key, server, remove }) => {
  if (!PLATFORMS[platform]) return { ok: false, error: 'Unknown platform.' };
  const keys = { ...(settings.liveKeys || {}) };
  if (platform === 'custom' && server !== undefined) {
    const sv = String(server || '').trim();
    if (sv && !/^rtmps?:\/\/[^\s]+$/i.test(sv)) return { ok: false, error: 'The server address must start with rtmp:// or rtmps://' };
    settings.liveCustomServer = sv;
  }
  if (remove) delete keys[platform];
  else if (key !== undefined && key !== null && String(key).trim()) {
    const k = String(key).trim();
    if (/\s/.test(k)) return { ok: false, error: 'A stream key has no spaces. Copy it again.' };
    keys[platform] = encKey(k);
  }
  settings.liveKeys = keys;
  saveSettings();
  return { ok: true, info: liveInfo() };
});

let live = null;
ipcMain.handle('live-start', (e, { platform, quality, hasAudio }) => {
  if (live) { live.stop(); live = null; }
  const p = PLATFORMS[platform];
  if (!p) return { ok: false, error: 'Unknown platform.' };
  const key = decKey((settings.liveKeys || {})[platform]);
  const server = platform === 'custom' ? (settings.liveCustomServer || '') : p.server;
  if (!server) return { ok: false, error: 'Add the server address for your platform first.' };
  if (!key && platform !== 'custom') return { ok: false, error: `Add your ${p.name} stream key first.` };
  live = new LiveSession({
    ffmpeg: ffmpegPath(), platform, server, key, quality: String(quality || '720'), hasAudio: !!hasAudio,
    onState: (st) => {
      recState.live = st.state;
      toMain('live-state', st);
      toBar('live', st);
      if (st.message && (st.state === 'failed' || st.state === 'reconnecting')) toBar('toast', st.state === 'failed' ? 'Live stopped' : 'Reconnecting…');
      if (st.warn) toBar('toast', 'Internet too slow');
      refreshTray();
    },
    onRestart: (session) => toMain('live-restart', session),
  });
  const session = live.start();
  return { ok: true, session, platform: live.name };
});
ipcMain.on('live-chunk', (e, { session, buf }) => { if (live) live.write(session, buf); });
ipcMain.handle('live-stop', () => { if (live) { live.stop(); live = null; } recState.live = null; return true; });
app.on('before-quit', () => { if (live) live.stop(); });

// ---------- updates (GitHub releases) ----------
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
ipcMain.handle('check-updates', async () => {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'NextGen-Screen-Recorder', Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) return { ok: true, latest: null, current: APP_VERSION, update: false };
    if (!res.ok) return { ok: false, error: `GitHub answered ${res.status}.` };
    const j = await res.json();
    const assets = j.assets || [];
    const asset = assets.find((a) => (IS_PORTABLE ? /portable.*\.zip$/i : /setup.*\.(zip|exe)$/i).test(a.name))
      || assets.find((a) => /\.(zip|exe)$/i.test(a.name));
    return {
      ok: true, current: APP_VERSION, latest: j.tag_name, update: newer(j.tag_name, APP_VERSION),
      url: asset ? asset.browser_download_url : (j.html_url || RELEASES_URL), notes: (j.body || '').slice(0, 600),
    };
  } catch (e) {
    return { ok: false, error: 'No internet connection, or GitHub could not be reached.' };
  }
});
ipcMain.handle('releases-page', () => { shell.openExternal(RELEASES_URL); return true; });

// ---------- helpers ----------
function moveFile(from, to) {
  try { fs.renameSync(from, to); } catch { fs.copyFileSync(from, to); fs.unlinkSync(from); }
}

// For automated tests only.
module.exports = { _test: { runCommand, setDrawing, setDrawTool, setDrawColor, setMouseMode, getDrawState: () => drawState, wins: () => ({ barWin, drawWin }) } };
