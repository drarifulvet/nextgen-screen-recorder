'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (e, v) => fn(v));
const call = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld('recorder', {
  // setup
  init: call('init'),
  setSettings: call('set-settings'),
  chooseSaveDir: call('choose-save-dir'),
  openSaveDir: call('open-save-dir'),
  getSources: call('get-sources'),
  selectSource: call('select-source'),
  selectArea: call('select-area'),
  pointerTracking: call('pointer-tracking'),
  // recording
  begin: call('rec-begin'),
  chunk: call('rec-chunk'),
  end: call('rec-end'),
  discard: call('rec-discard'),
  started: call('recording-started'),
  finished: call('recording-finished'),
  sendState: (s) => ipcRenderer.send('rec-state', s),
  sendTime: (t) => ipcRenderer.send('bar-time', t),
  recover: call('recover'),
  // library
  libList: call('lib-list'),
  libOpen: call('lib-open'),
  libShow: call('lib-show'),
  libRename: call('lib-rename'),
  libDelete: call('lib-delete'),
  libProcess: call('lib-process'),
  libCancel: call('lib-cancel'),
  // live streaming
  liveInfo: call('live-info'),
  liveSave: call('live-save'),
  liveStart: call('live-start'),
  liveStop: call('live-stop'),
  liveChunk: (session, buf) => ipcRenderer.send('live-chunk', { session, buf }),
  onLiveState: on('live-state'),
  onLiveRestart: on('live-restart'),
  onBarLive: on('live'),
  // updates + links
  checkUpdates: call('check-updates'),
  releasesPage: call('releases-page'),
  openExternal: call('open-external'),
  // events from main
  onCommand: on('command'),
  onPointer: on('pointer'),
  onClick: on('click'),
  onLibrary: on('library'),
  onBusy: on('busy'),
  onJobProgress: on('job-progress'),
  onRecState: on('rec-state'),
  onTheme: on('theme'),
  // control bar
  barCommand: (cmd) => ipcRenderer.send('bar-command', cmd),
  onBarState: on('state'),
  onBarTime: on('time'),
  onToast: on('toast'),
  // area selector + draw overlay
  regionDone: call('region-done'),
  onDraw: on('draw'),
  drawExit: () => ipcRenderer.send('draw-exit'),
});
