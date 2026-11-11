// NextGen Screen Recorder v0.2 — main window logic
// Pipeline: screen (optionally cropped to an area) + pointer effects + camera bubble are drawn onto one
// canvas; the canvas video plus mixed microphone and computer sound are recorded straight to disk.
'use strict';

const $ = (id) => document.getElementById(id);
const R = window.recorder;
const BLUR_FPS = 15;

let S = {};               // settings (owned by the main process)
let info = {};            // version, shortcuts, platform
let library = [];

// ---------- media state ----------
const canvas = $('preview');
const ctx = canvas.getContext('2d', { alpha: false });
const screenVid = makeVideo();
const camVid = makeVideo();
let sources = [];
let screenStream = null, camStream = null, micStream = null;
let display = null;       // bounds of the selected screen in DIP
let audioCtx = null, micAnalyser = null, micGain = null, mixNodes = [];
let pointer = null;       // last pointer position (DIP, global)
let ripples = [];
let segmenter = null, segLoading = false, lastSeg = 0;
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d');
const personCanvas = document.createElement('canvas');
const personCtx = personCanvas.getContext('2d');

// recording state
let mr = null, writeQueue = Promise.resolve(), writeFailed = false;
let startedAt = 0, pausedAt = 0, pausedTotal = 0, uiTimer = null;
let muted = false, camOn = true, counting = false;
let lastSaved = null;
let curSourceId = null;  // selected screen or window (not saved between sessions)

// live streaming state
let liveInfo = null;       // platforms, saved-key info (keys themselves stay in the main process)
let liveActive = false;    // a broadcast was started with this recording
let liveSession = 0, liveMr = null, liveQueue = Promise.resolve(), liveState = null;
let onBreak = false;       // "Be right back" screen while live
let sysGain = null, mixedAudioTracks = [];

function makeVideo() { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.autoplay = true; return v; }
function setStatus(msg, isError = false) { const el = $('status'); el.textContent = msg; el.classList.toggle('error', isError); }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function stopStream(s) { if (s) s.getTracks().forEach((t) => t.stop()); }
async function save(patch) { Object.assign(S, patch); S = await R.setSettings(patch); }
function getAudioCtx() { if (!audioCtx) audioCtx = new AudioContext(); if (audioCtx.state === 'suspended') audioCtx.resume(); return audioCtx; }
const recording = () => !!mr;

// ---------- clock (a worker keeps ticking while the window is minimised) ----------
let ticker = new Worker('ticker.js');
ticker.onmessage = draw;
function startTicker() { ticker.postMessage({ start: true, fps: Number(S.fps) || 30 }); }

// ---------- geometry ----------
function sourceRect() {
  const vw = screenVid.videoWidth, vh = screenVid.videoHeight;
  if (!vw || !vh) return null;
  if (S.mode === 'area' && S.area && display) {
    const k = vw / display.width;
    const x = Math.max(0, Math.round(S.area.x * k)), y = Math.max(0, Math.round(S.area.y * k));
    return { x, y, w: Math.min(vw - x, Math.round(S.area.w * k)), h: Math.min(vh - y, Math.round(S.area.h * k)), k };
  }
  return { x: 0, y: 0, w: vw, h: vh, k: display ? vw / display.width : 1 };
}
function fitCanvas(src) {
  const maxH = Number(S.quality), maxW = Math.round(maxH * 16 / 9);
  const scale = Math.min(1, maxH / src.h, maxW / src.w);
  const w = Math.max(2, Math.round(src.w * scale / 2) * 2), h = Math.max(2, Math.round(src.h * scale / 2) * 2);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function bubbleRect() {
  const w = canvas.width, h = canvas.height, short = Math.min(w, h);
  const d = Math.round(short * S.camSize);
  let cx = S.camX * w, cy = S.camY * h;
  cx = Math.min(w - d / 2, Math.max(d / 2, cx));
  cy = Math.min(h - d / 2, Math.max(d / 2, cy));
  return { x: cx - d / 2, y: cy - d / 2, d };
}

// ---------- drawing ----------
function drawBreakSlate() {
  const w = canvas.width, h = canvas.height;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#12313A'); g.addColorStop(1, '#1A434E');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const u = h / 720;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#C3F44D';
  ctx.font = `700 ${Math.round(72 * u)}px Segoe UI, sans-serif`;
  ctx.fillText('Be right back', w / 2, h / 2);
  ctx.fillStyle = '#A8C3C2';
  ctx.font = `${Math.round(28 * u)}px Segoe UI, sans-serif`;
  ctx.fillText('The broadcast will continue shortly', w / 2, h / 2 + 56 * u);
  const t = performance.now() / 600;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(w / 2 + (i - 1) * 28 * u, h / 2 + 110 * u, 7 * u, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(195, 244, 77, ${0.3 + 0.7 * Math.max(0, Math.sin(t - i * 0.6))})`;
    ctx.fill();
  }
}

function draw() {
  if (onBreak) { if (micAnalyser) updateMicMeter(); return drawBreakSlate(); }
  const src = screenStream && screenVid.readyState >= 2 ? sourceRect() : null;
  if (src && src.w > 0 && src.h > 0) {
    fitCanvas(src);
    ctx.drawImage(screenVid, src.x, src.y, src.w, src.h, 0, 0, canvas.width, canvas.height);
    if (S.mode !== 'window' && display) drawPointerEffects(src);
  } else {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--well') || '#0A1E23';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#7C9A9C';
    ctx.font = `${Math.round(canvas.height / 24)}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(S.mode === 'area' && !S.area ? 'Click “Select area” to choose what to record' : 'Pick a screen or window on the right', canvas.width / 2, canvas.height / 2);
  }
  if (camStream && camOn && camVid.readyState >= 2) drawBubble();
  if (micAnalyser) updateMicMeter();
}

function toCanvas(p, src) {
  const sc = canvas.width / src.w;
  return { x: ((p.x - display.x) * src.k - src.x) * sc, y: ((p.y - display.y) * src.k - src.y) * sc, s: src.k * sc };
}
function drawPointerEffects(src) {
  const now = performance.now();
  if (S.cursorHalo && pointer) {
    const c = toCanvas(pointer, src);
    if (c.x > -40 && c.y > -40 && c.x < canvas.width + 40 && c.y < canvas.height + 40) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 22 * c.s, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 214, 10, 0.28)';
      ctx.fill();
    }
  }
  ripples = ripples.filter((r) => now - r.t < 550);
  if (S.clickRipples) {
    for (const r of ripples) {
      const a = (now - r.t) / 550;
      const c = toCanvas(r, src);
      ctx.beginPath();
      ctx.arc(c.x, c.y, (10 + 34 * a) * c.s, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, 4 * c.s);
      ctx.strokeStyle = r.button === 2 ? `rgba(10, 132, 255, ${1 - a})` : `rgba(195, 244, 77, ${1 - a})`;
      ctx.stroke();
    }
  }
}

function shapePath(c, x, y, d) {
  c.beginPath();
  if (S.camShape === 'rounded') {
    const r = d * 0.18;
    c.moveTo(x + r, y);
    c.arcTo(x + d, y, x + d, y + d, r);
    c.arcTo(x + d, y + d, x, y + d, r);
    c.arcTo(x, y + d, x, y, r);
    c.arcTo(x, y, x + d, y, r);
    c.closePath();
  } else {
    c.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  }
}

function drawBubble() {
  const { x, y, d } = bubbleRect();
  const cw = camVid.videoWidth, ch = camVid.videoHeight, side = Math.min(cw, ch);
  const sx = (cw - side) / 2, sy = (ch - side) / 2;
  const useBlur = S.blur && segmenter && maskCanvas.width > 0;
  if (S.blur && !segmenter && !segLoading) loadSegmenter();
  if (useBlur) runSegmentation();

  ctx.save();
  shapePath(ctx, x, y, d);
  ctx.clip();
  ctx.translate(x + d, y);
  ctx.scale(-1, 1); // mirrored, like a selfie view
  if (useBlur) {
    ctx.filter = `blur(${Math.max(6, Math.round(d / 22))}px)`;
    ctx.drawImage(camVid, sx, sy, side, side, -8, -8, d + 16, d + 16);
    ctx.filter = 'none';
    if (personCanvas.width !== d) { personCanvas.width = d; personCanvas.height = d; }
    personCtx.globalCompositeOperation = 'source-over';
    personCtx.clearRect(0, 0, d, d);
    personCtx.drawImage(camVid, sx, sy, side, side, 0, 0, d, d);
    personCtx.globalCompositeOperation = 'destination-in';
    const mw = maskCanvas.width, mh = maskCanvas.height;
    personCtx.filter = 'blur(2px)';
    personCtx.drawImage(maskCanvas, sx / cw * mw, sy / ch * mh, side / cw * mw, side / ch * mh, 0, 0, d, d);
    personCtx.filter = 'none';
    ctx.drawImage(personCanvas, 0, 0, d, d);
  } else {
    ctx.drawImage(camVid, sx, sy, side, side, 0, 0, d, d);
  }
  ctx.restore();

  shapePath(ctx, x + 1, y + 1, d - 2);
  ctx.lineWidth = Math.max(3, Math.round(d * 0.025));
  ctx.strokeStyle = '#C3F44D';
  ctx.stroke();
}

// ---------- background blur (MediaPipe selfie segmentation, runs on this PC) ----------
async function loadSegmenter() {
  segLoading = true;
  $('blurHint').hidden = false;
  $('blurHint').textContent = 'Loading background blur…';
  try {
    const vision = await import('./vendor/mediapipe/vision_bundle.mjs');
    const base = new URL('vendor/mediapipe/', location.href).href;
    const files = { wasmLoaderPath: base + 'vision_wasm_internal.js', wasmBinaryPath: base + 'vision_wasm_internal.wasm' };
    for (const delegate of ['GPU', 'CPU']) {
      try {
        segmenter = await vision.ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: base + 'selfie_segmenter.tflite', delegate },
          runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true,
        });
        break;
      } catch { segmenter = null; }
    }
    $('blurHint').textContent = segmenter ? 'Background blur is on. It uses more processing power.' : 'Background blur could not start on this PC.';
  } catch {
    $('blurHint').textContent = 'Background blur could not start on this PC.';
  }
  segLoading = false;
}
let maskData = null;
function runSegmentation() {
  const now = performance.now();
  if (now - lastSeg < 1000 / BLUR_FPS) return;
  lastSeg = now;
  try {
    segmenter.segmentForVideo(camVid, now, (res) => {
      const m = res.confidenceMasks && res.confidenceMasks[0];
      if (!m) return;
      const f = m.getAsFloat32Array();
      if (maskCanvas.width !== m.width || maskCanvas.height !== m.height) {
        maskCanvas.width = m.width; maskCanvas.height = m.height;
        maskData = maskCtx.createImageData(m.width, m.height);
      }
      const px = maskData.data;
      for (let i = 0, j = 3; i < f.length; i++, j += 4) px[j] = f[i] * 255;
      maskCtx.putImageData(maskData, 0, 0);
    });
  } catch { /* skip a frame */ }
}

const meterBuf = new Uint8Array(1024);
function updateMicMeter() {
  micAnalyser.getByteTimeDomainData(meterBuf);
  let peak = 0;
  for (let i = 0; i < meterBuf.length; i += 4) peak = Math.max(peak, Math.abs(meterBuf[i] - 128));
  $('micLevel').style.width = muted ? '0%' : `${Math.min(100, (peak / 128) * 160)}%`;
}

// ---------- camera drag + resize on the preview ----------
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
}
function overBubble(p) {
  if (!camStream || !camOn) return false;
  const b = bubbleRect();
  return p.x >= b.x && p.x <= b.x + b.d && p.y >= b.y && p.y <= b.y + b.d;
}
let dragOff = null;
canvas.addEventListener('pointerdown', (e) => {
  const p = canvasPoint(e);
  if (!overBubble(p)) return;
  const b = bubbleRect();
  dragOff = { dx: p.x - (b.x + b.d / 2), dy: p.y - (b.y + b.d / 2) };
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', (e) => {
  const p = canvasPoint(e);
  if (dragOff) {
    S.camX = Math.min(1, Math.max(0, (p.x - dragOff.dx) / canvas.width));
    S.camY = Math.min(1, Math.max(0, (p.y - dragOff.dy) / canvas.height));
  } else {
    canvas.style.cursor = overBubble(p) ? 'grab' : 'default';
  }
});
canvas.addEventListener('pointerup', () => {
  if (!dragOff) return;
  dragOff = null;
  canvas.style.cursor = 'grab';
  save({ camX: S.camX, camY: S.camY });
});
canvas.addEventListener('wheel', (e) => {
  if (!overBubble(canvasPoint(e))) return;
  e.preventDefault();
  setCamSize(S.camSize + (e.deltaY < 0 ? 0.02 : -0.02));
}, { passive: false });
let sizeSaveTimer = null;
function setCamSize(v) {
  S.camSize = Math.min(0.5, Math.max(0.12, v));
  $('sizeRange').value = Math.round(S.camSize * 100);
  clearTimeout(sizeSaveTimer);
  sizeSaveTimer = setTimeout(() => save({ camSize: S.camSize }), 300);
}

// ---------- sources ----------
async function loadSources() {
  try { sources = await R.getSources(); } catch { sources = []; setStatus('Could not list screens and windows.', true); }
  renderSources();
}
function renderSources() {
  const box = $('sources');
  box.innerHTML = '';
  $('areaRow').hidden = S.mode !== 'area';
  const wantScreens = S.mode !== 'window';
  const list = sources.filter((s) => (wantScreens ? s.isScreen : !s.isScreen));
  if (!list.length) {
    box.innerHTML = `<div class="empty">${wantScreens ? 'No screens found.' : 'No open windows found. Open the app you want to record, then press ⟳.'}</div>`;
    return;
  }
  list.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'src' + (s.id === curSourceId ? ' active' : '');
    b.title = s.name;
    const thumb = document.createElement('img');
    thumb.className = 'thumb'; thumb.alt = '';
    if (s.thumb) thumb.src = s.thumb;
    const name = document.createElement('div');
    name.className = 'name';
    if (s.icon) { const ic = document.createElement('img'); ic.src = s.icon; ic.alt = ''; name.appendChild(ic); }
    const label = document.createElement('span');
    label.textContent = s.isScreen ? (list.length > 1 ? `Screen ${i + 1}${s.display && s.display.primary ? ' (main)' : ''}` : 'Entire screen') : s.name;
    name.appendChild(label);
    b.append(thumb, name);
    b.onclick = () => chooseSource(s.id);
    box.appendChild(b);
  });
  if (S.mode === 'area') {
    $('areaLabel').textContent = S.area ? `Area ${S.area.w} × ${S.area.h}` : 'No area selected';
    $('areaBtn').textContent = S.area ? 'Change area' : 'Select area';
  }
}

async function chooseSource(id) {
  if (recording()) return;
  curSourceId = id;
  renderSources();
  await startScreen();
}

async function startScreen() {
  stopStream(screenStream);
  screenStream = null;
  const src = sources.find((s) => s.id === curSourceId);
  display = src && src.display ? src.display : null;
  if (!src) { updateReady(); return; }
  try {
    const { platform } = await R.selectSource({ sourceId: src.id, systemAudio: S.systemAudio, display, kind: S.mode === 'window' ? 'window' : 'screen' });
    if (platform !== 'win32') $('sysHint').textContent = 'Computer sound can only be recorded on Windows.';
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: Number(S.fps) || 30 } }, audio: S.systemAudio });
    screenVid.srcObject = screenStream;
    await screenVid.play().catch(() => {});
    screenStream.getVideoTracks()[0].addEventListener('ended', onScreenEnded);
    const hasSys = screenStream.getAudioTracks().length > 0;
    setStatus(S.mode === 'area' && !S.area ? 'Now click “Select area”.' : (S.systemAudio && !hasSys ? 'Ready. Computer sound is not available for this source.' : 'Ready to record.'));
  } catch {
    screenStream = null;
    setStatus('Could not capture that screen or window. Try another one, or press ⟳.', true);
  }
  R.pointerTracking(!!screenStream && S.mode !== 'window' && (S.cursorHalo || S.clickRipples));
  updateReady();
}

function onScreenEnded() {
  if (recording()) stopRecording();
  screenStream = null;
  curSourceId = null;
  loadSources();
  setStatus('The screen or window you chose is no longer available.', true);
  updateReady();
}

async function selectArea() {
  if (!curSourceId || !sources.find((s) => s.id === curSourceId && s.isScreen)) {
    const first = sources.find((s) => s.isScreen);
    if (first) await chooseSource(first.id);
  }
  const rect = await R.selectArea();
  if (rect) {
    await save({ area: rect });
    setStatus(`Area ${rect.w} × ${rect.h} selected. Ready to record.`);
  }
  renderSources();
  updateReady();
}

function setMode(mode) {
  if (recording()) return;
  save({ mode });
  markActive('modeSeg', 'mode', mode);
  const cur = sources.find((s) => s.id === curSourceId);
  const fits = cur && (mode === 'window' ? !cur.isScreen : cur.isScreen);
  if (!fits) {
    curSourceId = null;
    stopStream(screenStream); screenStream = null;
    const first = mode !== 'window' ? sources.find((s) => s.isScreen) : null;
    renderSources();
    if (first) chooseSource(first.id); else updateReady();
  } else {
    renderSources();
    R.pointerTracking(!!screenStream && mode !== 'window' && (S.cursorHalo || S.clickRipples));
    updateReady();
  }
  if (mode === 'area' && !S.area) setStatus('Click “Select area”, then drag over the part of the screen to record.');
}

// ---------- camera and microphone ----------
async function unlockDeviceNames() {
  for (const c of [{ audio: true, video: true }, { audio: true }, { video: true }]) {
    try { const s = await navigator.mediaDevices.getUserMedia(c); stopStream(s); return; } catch { /* next */ }
  }
}
async function loadDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  fillSelect($('camSelect'), devices.filter((d) => d.kind === 'videoinput'), 'camId', 'No camera', 'Camera');
  fillSelect($('micSelect'), devices.filter((d) => d.kind === 'audioinput'), 'micId', 'No microphone', 'Microphone');
}
function fillSelect(sel, list, key, noneLabel, fallback) {
  sel.innerHTML = '';
  sel.add(new Option(noneLabel, 'none'));
  list.forEach((d, i) => sel.add(new Option(d.label || `${fallback} ${i + 1}`, d.deviceId)));
  const ids = list.map((d) => d.deviceId);
  if (S[key] === 'none') sel.value = 'none';
  else if (ids.includes(S[key])) sel.value = S[key];
  else sel.value = list.length ? (ids.includes('default') ? 'default' : ids[0]) : 'none';
  S[key] = sel.value;
}
async function startCamera() {
  stopStream(camStream);
  camStream = null;
  if (!S.camId || S.camId === 'none') return;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: S.camId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
    camVid.srcObject = camStream;
    await camVid.play().catch(() => {});
  } catch {
    camStream = null;
    setStatus('Camera could not start. It may be in use by another app (Zoom, Teams…).', true);
  }
}
async function startMic() {
  stopStream(micStream);
  micStream = null; micAnalyser = null;
  $('micLevel').style.width = '0';
  if (!S.micId || S.micId === 'none') return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: S.micId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ac = getAudioCtx();
    micAnalyser = ac.createAnalyser();
    micAnalyser.fftSize = 2048;
    ac.createMediaStreamSource(micStream).connect(micAnalyser);
  } catch {
    micStream = null;
    setStatus('Microphone could not start. Check Windows privacy settings for the microphone.', true);
  }
}

// ---------- recording ----------
function pickFormat() {
  const options = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,opus', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ];
  return options.find(([m]) => MediaRecorder.isTypeSupported(m)) || ['', 'webm'];
}
function buildMixedAudio() {
  const ac = getAudioCtx();
  const dest = ac.createMediaStreamDestination();
  let count = 0;
  const add = (stream, gainValue) => {
    if (!stream || !stream.getAudioTracks().length) return null;
    const src = ac.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const g = ac.createGain();
    g.gain.value = gainValue;
    src.connect(g).connect(dest);
    mixNodes.push(src, g);
    count++;
    return g;
  };
  micGain = add(micStream, muted ? 0 : 1.0);
  sysGain = add(screenStream, 0.9);
  mixedAudioTracks = count ? dest.stream.getAudioTracks() : [];
  return mixedAudioTracks;
}

async function startRecording() {
  if (recording() || counting || !screenStream) return;
  if (S.mode === 'area' && !S.area) { setStatus('Select an area first.', true); return; }
  if (S.liveOn && !liveReady()) { openLiveDialog(); setStatus('Add your stream key to go live.', true); return; }
  $('saved').hidden = true;
  counting = true;
  setControls('countdown');
  getAudioCtx();
  if (S.countdown) {
    const cd = $('countdown');
    cd.hidden = false;
    for (let n = 3; n > 0; n--) { cd.textContent = n; await wait(1000); }
    cd.hidden = true;
  }
  camOn = true;
  await R.started({ area: S.mode === 'area' ? S.area : null, muted, camOn });
  await wait(400);

  const fps = Number(S.fps) || 30;
  const [mimeType, ext] = pickFormat();
  const stream = new MediaStream([canvas.captureStream(fps).getVideoTracks()[0], ...buildMixedAudio()]);
  const px = canvas.width * canvas.height;
  const bitrate = Math.round((px >= 1920 * 1000 ? 6_000_000 : px >= 1280 * 700 ? 3_500_000 : 2_500_000) * (fps >= 60 ? 1.5 : 1));
  try {
    mr = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: bitrate, audioBitsPerSecond: 160_000 });
  } catch {
    mr = null; counting = false;
    await R.finished();
    setControls('idle');
    setStatus('This PC could not start the video encoder.', true);
    return;
  }
  await R.begin({ ext, startedAt: Date.now() });
  writeQueue = Promise.resolve();
  writeFailed = false;
  mr.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    writeQueue = writeQueue.then(() => e.data.arrayBuffer()).then((buf) => R.chunk(buf)).catch(() => { writeFailed = true; });
  };
  mr.onstop = finishRecording;
  mr.start(1000);
  counting = false;
  startedAt = performance.now(); pausedTotal = 0; pausedAt = 0;
  document.body.classList.add('recording');
  setControls('recording');
  setStatus('Recording…');
  if (S.liveOn) startLive();
  uiTimer = setInterval(tickUi, 500);
  tickUi();
}

function togglePause() {
  if (!mr) return;
  if (liveActive) return toggleBreak();
  if (mr.state === 'recording') { mr.pause(); pausedAt = performance.now(); setStatus('Paused.'); }
  else if (mr.state === 'paused') { mr.resume(); pausedTotal += performance.now() - pausedAt; pausedAt = 0; setStatus('Recording…'); }
  pushState();
  tickUi();
}
function toggleMute() {
  muted = !muted;
  if (micGain) micGain.gain.value = muted || onBreak ? 0 : 1;
  $('muteBtn').textContent = muted ? 'Unmute mic' : 'Mute mic';
  if (recording()) setStatus(muted ? 'Microphone muted.' : 'Microphone on.');
  pushState();
}
function toggleCamera() {
  camOn = !camOn;
  pushState();
}
function pushState() {
  R.sendState({ paused: !!(mr && mr.state === 'paused'), muted, camOn, liveActive, onBreak });
  $('pauseBtn').textContent = liveActive ? (onBreak ? 'Back live' : 'Break') : (mr && mr.state === 'paused' ? 'Resume' : 'Pause');
}
function stopRecording() {
  if (liveActive) stopLive();
  if (mr && mr.state !== 'inactive') {
    if (mr.state === 'paused') { mr.resume(); pausedTotal += performance.now() - pausedAt; pausedAt = 0; }
    setStatus('Finishing the video…');
    mr.stop();
  }
}

// ---------- live streaming ----------
function liveReady() {
  if (!liveInfo) return false;
  const k = liveInfo.keyInfo[S.livePlatform] || {};
  if (S.livePlatform === 'custom') return !!liveInfo.customServer;
  return !!k.saved;
}
function pickLiveFormat() {
  const options = ['video/x-matroska;codecs=avc1,opus', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}
async function startLive() {
  liveActive = true;
  onBreak = false;
  const res = await R.liveStart({ platform: S.livePlatform, quality: S.liveQuality, hasAudio: mixedAudioTracks.length > 0 });
  if (!res.ok) {
    liveActive = false;
    setStatus(`Not live: ${res.error} Recording continues.`, true);
    pushState();
    return;
  }
  liveSession = res.session;
  startLiveRecorder(liveSession);
  pushState();
}
function startLiveRecorder(session) {
  stopLiveRecorder();
  const mime = pickLiveFormat();
  const tracks = [canvas.captureStream(30).getVideoTracks()[0], ...mixedAudioTracks];
  const highBits = S.liveQuality === '1080' ? 12_000_000 : 8_000_000; // high, so the stream copy stays sharp
  try {
    liveMr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime || undefined, videoBitsPerSecond: highBits, audioBitsPerSecond: 192_000 });
  } catch {
    setStatus('This PC could not start the stream encoder. Recording continues.', true);
    R.liveStop();
    liveActive = false;
    return;
  }
  const rec = liveMr;
  liveQueue = Promise.resolve();
  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size || rec !== liveMr) return;
    liveQueue = liveQueue.then(() => e.data.arrayBuffer()).then((buf) => { if (rec === liveMr) R.liveChunk(session, buf); }).catch(() => {});
  };
  rec.start(250);
}
function stopLiveRecorder() {
  const rec = liveMr;
  liveMr = null;
  if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* ignore */ } }
  if (rec && rec.stream) rec.stream.getVideoTracks().forEach((t) => t.stop());
}
async function stopLive() {
  stopLiveRecorder();
  liveActive = false;
  if (onBreak) setBreak(false);
  await R.liveStop();
  showLivePill(null);
  pushState();
}
function setBreak(on) {
  onBreak = on;
  if (micGain) micGain.gain.value = on || muted ? 0 : 1;
  if (sysGain) sysGain.gain.value = on ? 0 : 0.9;
  // the saved copy skips the break; the broadcast shows "Be right back"
  if (mr) {
    if (on && mr.state === 'recording') { mr.pause(); pausedAt = performance.now(); }
    else if (!on && mr.state === 'paused') { mr.resume(); pausedTotal += performance.now() - pausedAt; pausedAt = 0; }
  }
}
function toggleBreak() {
  setBreak(!onBreak);
  setStatus(onBreak ? 'On a break: viewers see “Be right back”. Your mic and computer sound are off.' : 'Back live.');
  pushState();
  tickUi();
}
function showLivePill(st) {
  const pill = $('livePill');
  if (!st || st.state === 'ended') { pill.hidden = true; return; }
  pill.hidden = false;
  pill.className = 'live-pill' + (st.state === 'live' ? '' : st.state === 'failed' ? ' off' : ' wait');
  pill.textContent = { connecting: 'CONNECTING', reconnecting: 'RECONNECTING', live: 'LIVE', failed: 'OFFLINE' }[st.state] || '';
}
R.onLiveState((st) => {
  liveState = st;
  showLivePill(st);
  const el = $('status');
  if (st.state === 'connecting') setStatus(`Connecting to ${st.platform}…`);
  else if (st.state === 'live' && !st.health) setStatus(`Live on ${st.platform}. Recording a copy.`);
  else if (st.state === 'live' && st.health && !onBreak) { el.textContent = `Live on ${st.platform} · ${(st.kbps / 1000).toFixed(1)} Mbps`; el.classList.remove('error'); }
  else if (st.state === 'reconnecting') {
    setStatus(st.retryInMs
      ? `${st.message} Reconnecting in ${Math.round(st.retryInMs / 1000)} s… Recording continues.`
      : `Reconnecting to ${st.platform} (try ${st.attempt})… Recording continues.`, true);
  }
  else if (st.state === 'failed') {
    setStatus(`Live stopped: ${st.message} Recording continues.`, true);
    stopLiveRecorder();
    liveActive = false;
    if (onBreak) setBreak(false);
    pushState();
  }
  if (st.warn) setStatus(st.warn, true);
  el.classList.toggle('live', st.state === 'live');
});
R.onLiveRestart((session) => {
  if (!liveActive) return;
  liveSession = session;
  startLiveRecorder(session);
});

// key dialog
function refreshLiveUi() {
  if (!liveInfo) return;
  $('liveChk').checked = !!S.liveOn;
  $('liveBody').hidden = !S.liveOn;
  $('livePlatform').value = S.livePlatform;
  markActive('liveQualitySeg', 'lq', S.liveQuality);
  const k = liveInfo.keyInfo[S.livePlatform] || {};
  const name = liveInfo.platforms[S.livePlatform].name;
  if (S.livePlatform === 'custom') {
    $('liveKeyLabel').textContent = liveInfo.customServer ? `Server: ${liveInfo.customServer.replace(/^rtmps?:\/\//, '').split('/')[0]}` : 'No server yet';
    $('liveKeyBtn').textContent = liveInfo.customServer ? 'Change' : 'Set up';
  } else if (k.saved) {
    $('liveKeyLabel').textContent = `${name} key saved (…${k.tail})`;
    $('liveKeyBtn').textContent = 'Change key';
  } else {
    $('liveKeyLabel').textContent = k.unreadable ? 'Saved key can\'t be read on this PC' : 'No stream key yet';
    $('liveKeyBtn').textContent = 'Add stream key';
  }
  setControls(recording() ? 'recording' : 'idle');
}
function openLiveDialog() {
  const id = S.livePlatform;
  const p = liveInfo.platforms[id];
  const k = liveInfo.keyInfo[id] || {};
  $('lvTitle').textContent = id === 'custom' ? 'Stream to another platform' : `Stream to ${p.name}`;
  $('lvSteps').innerHTML = '';
  p.keyHelp.forEach((t) => { const li = document.createElement('li'); li.textContent = t; $('lvSteps').appendChild(li); });
  $('lvOpen').hidden = !p.keyUrl;
  $('lvOpen').textContent = { youtube: 'Open YouTube Studio', facebook: 'Open Facebook Live Producer', twitch: 'Open Twitch dashboard' }[id] || 'Open';
  $('lvNote').hidden = !p.note;
  $('lvNote').textContent = p.note || '';
  $('lvServerRow').hidden = id !== 'custom';
  $('lvServer').value = id === 'custom' ? liveInfo.customServer : '';
  $('lvKey').value = '';
  $('lvKey').type = 'password';
  $('lvShow').textContent = 'Show';
  $('lvKey').placeholder = id === 'custom' ? 'Stream key (leave empty if it is part of the server URL)' : 'Paste your stream key';
  $('lvSaved').textContent = k.saved ? `A key is saved (ends in …${k.tail}). Paste a new one to replace it.` : '';
  $('lvRemove').hidden = !k.saved;
  $('lvErr').hidden = true;
  $('liveDlg').hidden = false;
  $(id === 'custom' ? 'lvServer' : 'lvKey').focus();
}
async function saveLiveDialog() {
  const id = S.livePlatform;
  const payload = { platform: id, key: $('lvKey').value };
  if (id === 'custom') payload.server = $('lvServer').value;
  else if (!$('lvKey').value.trim() && !(liveInfo.keyInfo[id] || {}).saved) { $('lvErr').textContent = 'Paste your stream key first.'; $('lvErr').hidden = false; return; }
  const r = await R.liveSave(payload);
  if (!r.ok) { $('lvErr').textContent = r.error; $('lvErr').hidden = false; return; }
  liveInfo = r.info;
  $('lvKey').value = '';
  $('liveDlg').hidden = true;
  refreshLiveUi();
  setStatus(`${liveInfo.platforms[id].name} is ready. Press Go live to start.`);
}

async function finishRecording() {
  clearInterval(uiTimer);
  if (liveActive) await stopLive();
  onBreak = false;
  sysGain = null; mixedAudioTracks = [];
  const durationMs = elapsedMs();
  mixNodes.forEach((n) => { try { n.disconnect(); } catch { /* ignore */ } });
  mixNodes = []; micGain = null;
  await writeQueue;
  mr = null;
  camOn = true;
  document.body.classList.remove('recording');
  await R.finished();
  setControls('idle');
  $('timer').textContent = '00:00';
  setStatus('Saving…');
  const res = await R.end({ durationMs });
  if (res && res.ok) {
    lastSaved = res.entry;
    showSaved(res.entry);
    setStatus(writeFailed ? 'Saved, but part of the video could not be written. Check free disk space.' : 'Saved to your Library.', writeFailed);
  } else {
    setStatus((res && res.error) || 'Could not save the recording.', true);
  }
}

function showSaved(e) {
  $('savedTitle').textContent = 'Recording saved';
  $('savedMeta').textContent = `${e.name} · ${fmtDur(e.durationMs)} · ${fmtSize(e.size)}`;
  $('savedThumb').src = e.thumbUrl || '';
  $('savedThumb').hidden = !e.thumbUrl;
  $('saved').hidden = false;
}

function elapsedMs() { if (!startedAt) return 0; return (pausedAt || performance.now()) - startedAt - pausedTotal; }
function fmt(ms) {
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
function fmtDur(ms) { return fmt(ms || 0); }
function fmtSize(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(1) + ' MB'; }
function fmtTenth(sec) { const m = Math.floor(sec / 60); const s = (sec - m * 60).toFixed(1).padStart(4, '0'); return `${m}:${s}`; }
function tickUi() { const t = fmt(elapsedMs()); $('timer').textContent = t; R.sendTime(t); }

function setControls(mode) {
  const rec = $('recordBtn');
  rec.hidden = mode === 'recording';
  rec.disabled = mode !== 'idle' || !canRecord();
  $('recordLabel').textContent = mode === 'countdown' ? 'Get ready…' : (S.liveOn ? 'Go live' : 'Start recording');
  $('pauseBtn').hidden = $('muteBtn').hidden = $('stopBtn').hidden = mode !== 'recording';
  $('timer').classList.toggle('live', mode === 'recording');
}
function canRecord() { return !!screenStream && !(S.mode === 'area' && !S.area); }
function updateReady() { if (!recording() && !counting) $('recordBtn').disabled = !canRecord(); }

// ---------- library ----------
function renderLibrary() {
  $('libCount').textContent = library.length ? String(library.length) : '';
  $('libFolder').textContent = `Saved in ${S.saveDir}`;
  const grid = $('libGrid');
  grid.innerHTML = '';
  $('libEmpty').hidden = library.length > 0;
  for (const e of library) {
    const card = document.createElement('article');
    card.className = 'lib-card';
    const th = document.createElement('button');
    th.className = 'lib-thumb';
    th.title = 'Play';
    th.innerHTML = `${e.thumbUrl ? `<img alt="" src="${e.thumbUrl}">` : ''}<span class="dur">${fmtDur(e.durationMs)}</span><span class="play">▶</span>`;
    th.onclick = () => R.libOpen(e.id);
    const body = document.createElement('div');
    body.className = 'lib-body';
    const nm = document.createElement('div'); nm.className = 'lib-name'; nm.textContent = e.name; nm.title = e.name;
    const meta = document.createElement('div'); meta.className = 'lib-meta';
    meta.textContent = `${new Date(e.created).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${fmtSize(e.size)}${e.width ? ` · ${e.width}×${e.height}` : ''}`;
    body.append(nm, meta);
    const btns = document.createElement('div');
    btns.className = 'lib-btns';
    const mk = (label, fn, cls = 'btn-ghost') => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; btns.appendChild(b); };
    mk('Trim / GIF / Smaller', () => openEditor(e));
    mk('Rename', () => openRename(e));
    mk('Show in folder', () => R.libShow(e.id));
    mk('Delete', () => openDelete(e));
    card.append(th, body, btns);
    grid.appendChild(card);
  }
}

// rename
let renaming = null;
function openRename(e) {
  renaming = e;
  $('rnInput').value = e.name.replace(/\.[^.]+$/, '');
  $('rnErr').hidden = true;
  $('renameDlg').hidden = false;
  $('rnInput').focus();
  $('rnInput').select();
}
async function doRename() {
  const r = await R.libRename({ id: renaming.id, name: $('rnInput').value });
  if (!r.ok) { $('rnErr').textContent = r.error; $('rnErr').hidden = false; return; }
  library = r.list; renderLibrary();
  $('renameDlg').hidden = true;
}
// delete
let deleting = null;
function openDelete(e) {
  deleting = e;
  $('cfText').textContent = `“${e.name}” will be moved to the Recycle Bin. You can restore it from there.`;
  $('confirmDlg').hidden = false;
}
async function doDelete() {
  const r = await R.libDelete(deleting.id);
  $('confirmDlg').hidden = true;
  if (!r.ok) { setStatus(r.error || 'Could not delete.', true); return; }
  library = r.list; renderLibrary();
}

// editor (trim, GIF, smaller copy)
let editing = null;
let previewStop = null;
function openEditor(e) {
  editing = e;
  $('edTitle').textContent = e.name;
  const v = $('edVideo');
  v.src = e.url;
  $('edProgress').hidden = true;
  setBusy(false);
  v.onloadedmetadata = () => {
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : (e.durationMs || 0) / 1000;
    for (const id of ['trimStart', 'trimEnd']) $(id).max = dur.toFixed(1);
    $('trimStart').value = 0;
    $('trimEnd').value = dur.toFixed(1);
    updateTrim();
  };
  $('editor').hidden = false;
}
function trimVals() {
  let s = parseFloat($('trimStart').value) || 0, en = parseFloat($('trimEnd').value) || 0;
  if (en - s < 0.5) { if (document.activeElement === $('trimStart')) s = Math.max(0, en - 0.5); else en = Math.min(parseFloat($('trimEnd').max), s + 0.5); }
  return { s, en };
}
function updateTrim() {
  const { s, en } = trimVals();
  $('trimStart').value = s; $('trimEnd').value = en;
  const max = parseFloat($('trimEnd').max) || 1;
  $('trimSel').style.left = (s / max * 100) + '%';
  $('trimSel').style.width = ((en - s) / max * 100) + '%';
  $('tsLabel').textContent = fmtTenth(s);
  $('teLabel').textContent = fmtTenth(en);
  $('lenLabel').textContent = fmtTenth(en - s);
  const len = en - s;
  $('edNote').textContent = len > 30
    ? 'GIFs longer than 30 seconds get very large; shorten the selection for a GIF.'
    : 'Your original is never changed: each action saves a new file next to it.';
}
function setBusy(b) { ['edTrim', 'edGif', 'edSmall'].forEach((id) => { $(id).disabled = b; }); }
async function runJob(action) {
  const { s, en } = trimVals();
  setBusy(true);
  $('edProgress').hidden = false;
  $('edBar').style.width = '0%';
  $('edPct').textContent = action === 'gif' ? 'Making GIF… 0%' : 'Exporting… 0%';
  const r = await R.libProcess({ id: editing.id, action, start: s, end: en });
  setBusy(false);
  if (!r.ok) { $('edPct').textContent = r.error || 'Export failed.'; return; }
  $('edBar').style.width = '100%';
  if (action === 'gif') {
    $('edPct').textContent = `GIF saved (${fmtSize(r.size)}) — opened in its folder.`;
  } else {
    library = r.list; renderLibrary();
    $('edPct').textContent = `Saved “${r.entry.name}” (${fmtSize(r.entry.size)}) to your Library.`;
  }
}
R.onJobProgress((p) => {
  if (!editing || p.id !== editing.id) return;
  $('edBar').style.width = p.pct + '%';
  $('edPct').textContent = `${p.action === 'gif' ? 'Making GIF…' : 'Exporting…'} ${p.pct}%`;
});

// ---------- settings view ----------
function renderSettings() {
  $('saveDirLabel').textContent = S.saveDir;
  if (info.portable) {
    $('portableNote').hidden = false;
    $('portableNote').textContent = info.portable.dataDir
      ? `Portable version: settings, stream keys and the Library list are kept in ${info.portable.dataDir}.`
      : 'Portable version: the app folder is read-only, so settings are kept in your Windows profile instead.';
  }
  $('askSaveChk').checked = !!S.askWhereToSave;
  $('standardChk').checked = S.standardMp4 !== false;
  markActive('themeSeg', 'theme', S.theme);
  $('autoUpdChk').checked = S.checkUpdates !== false;
  $('verLabel').textContent = info.version;
  const t = $('keysTable');
  t.innerHTML = '';
  for (const k of info.shortcuts) {
    const tr = document.createElement('tr');
    const keys = k.acc.split('+').map((x) => `<kbd>${x}</kbd>`).join('+');
    tr.innerHTML = `<td>${keys}</td><td>${k.label}${k.ok ? '' : ' <span class="bad">(in use by another app)</span>'}</td>`;
    t.appendChild(tr);
  }
  if (info.drawShortcuts && info.drawShortcuts.length) {
    const head = document.createElement('tr');
    head.innerHTML = '<td colspan="2" class="keys-sub">While drawing</td>';
    t.appendChild(head);
    for (const k of info.drawShortcuts) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${k.acc.split('+').map((x) => `<kbd>${x}</kbd>`).join('+')}</td><td>${k.label}</td>`;
      t.appendChild(tr);
    }
  }
}
function applyTheme(dark) { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }

// ---------- updates ----------
let updateUrl = null;
async function checkUpdates(manual) {
  if (manual) $('updStatus').textContent = 'Checking…';
  const r = await R.checkUpdates();
  if (!r.ok) { if (manual) $('updStatus').textContent = r.error; return; }
  const when = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (r.update) {
    updateUrl = r.url;
    $('updTitle').textContent = `Version ${String(r.latest).replace(/^v/, '')} is available.`;
    $('updText').textContent = `You have ${r.current}.`;
    $('updateBanner').hidden = false;
    $('updStatus').textContent = `Version ${String(r.latest).replace(/^v/, '')} is available (checked ${when}).`;
  } else {
    $('updStatus').textContent = `You have the latest version (checked ${when}).`;
  }
}

// ---------- recovery ----------
let recoveryItems = [];
function showRecovery() {
  if (!recoveryItems.length) { $('recoveryBanner').hidden = true; return; }
  const r = recoveryItems[0];
  $('recText').textContent = `Unsaved video from ${new Date(r.when).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (${fmtSize(r.size)}).`;
  $('recoveryBanner').hidden = false;
}
async function handleRecovery(keep) {
  const r = recoveryItems.shift();
  $('recoveryBanner').hidden = true;
  if (keep) setStatus('Recovering the interrupted recording…');
  const res = await R.recover({ file: r.file, keep });
  if (keep) {
    if (res && res.ok && res.entry) { showSaved(res.entry); setStatus('Recovered and saved to your Library.'); }
    else setStatus('That recording could not be recovered.', true);
  }
  showRecovery();
}

// ---------- tour ----------
const TOUR = [
  ['cardSource', 'Choose what to record', 'Pick a whole screen, one window, or drag out an area.'],
  ['cardCamera', 'Set up your camera', 'Pick your webcam. Drag the bubble on the preview to move it; scroll over it to resize.'],
  ['cardSound', 'Check your sound', 'Speak and watch the green bar. Turn on computer sound to capture videos and apps.'],
  ['recordBtn', 'Start recording', 'Click here, or press Alt+Shift+R from any app. A small bar lets you pause, mute, draw and stop.'],
  ['navLibrary', 'Find your videos', 'Every recording appears in Library, where you can trim it, make a GIF or a smaller copy.'],
];
let tourIdx = 0;
function startTour() { switchView('record'); tourIdx = 0; $('tour').hidden = false; showTourStep(); }
function showTourStep() {
  const [id, title, text] = TOUR[tourIdx];
  const el = $(id);
  const r = el.getBoundingClientRect();
  const pad = 6;
  Object.assign($('tourRing').style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
  $('tourStep').textContent = `Step ${tourIdx + 1} of ${TOUR.length}`;
  $('tourTitle').textContent = title;
  $('tourText').textContent = text;
  $('tourBack').disabled = tourIdx === 0;
  $('tourNext').textContent = tourIdx === TOUR.length - 1 ? 'Finish' : 'Next';
  const tip = $('tourTip');
  const tw = 300, th = tip.offsetHeight || 150;
  let left = r.left - tw - 16;
  if (left < 12) left = Math.min(window.innerWidth - tw - 12, r.right + 16);
  if (left + tw > window.innerWidth - 12) left = Math.max(12, r.left);
  let top = Math.min(window.innerHeight - th - 12, Math.max(12, r.top));
  if (r.bottom + th + 16 < window.innerHeight && (r.width > window.innerWidth - 400)) { top = r.bottom + 16; left = Math.max(12, Math.min(r.left, window.innerWidth - tw - 12)); }
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
}
function endTour() { $('tour').hidden = true; if (!S.tourDone) save({ tourDone: true }); }

// ---------- views ----------
function switchView(v) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  for (const name of ['record', 'library', 'settings']) $(`view-${name}`).hidden = name !== v;
  if (v === 'library') R.libList().then((l) => { library = l; renderLibrary(); });
  if (v === 'settings') renderSettings();
}
function markActive(containerId, attr, value) {
  document.querySelectorAll(`#${containerId} button`).forEach((b) => b.classList.toggle('active', String(b.dataset[attr]) === String(value)));
}

// ---------- commands (shortcuts, tray, control bar) ----------
R.onCommand((cmd) => {
  if (cmd === 'toggle') { if (recording()) stopRecording(); else startRecording(); }
  else if (cmd === 'stop') stopRecording();
  else if (cmd === 'pause') togglePause();
  else if (cmd === 'mute') toggleMute();
  else if (cmd === 'camera') { if (recording()) toggleCamera(); }
});
R.onPointer((p) => { pointer = p; });
R.onClick((c) => { ripples.push({ x: c.x, y: c.y, button: c.button, t: performance.now() }); });
R.onLibrary((l) => { library = l; renderLibrary(); });
R.onBusy((msg) => { if (msg) setStatus(msg); });
R.onTheme((t) => { if (S.theme === 'system') applyTheme(t === 'dark'); });

function bindUi() {
  document.querySelectorAll('.nav-btn').forEach((b) => { b.onclick = () => switchView(b.dataset.view); });
  $('refreshBtn').onclick = loadSources;
  document.querySelectorAll('#modeSeg button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $('areaBtn').onclick = selectArea;

  $('camSelect').onchange = async (e) => { await save({ camId: e.target.value }); await startCamera(); };
  $('micSelect').onchange = async (e) => { await save({ micId: e.target.value }); await startMic(); };
  document.querySelectorAll('#shapeSeg button').forEach((b) => { b.onclick = () => { save({ camShape: b.dataset.shape }); markActive('shapeSeg', 'shape', b.dataset.shape); }; });
  $('sizeRange').oninput = (e) => setCamSize(Number(e.target.value) / 100);
  $('blurChk').onchange = (e) => { save({ blur: e.target.checked }); if (!e.target.checked) $('blurHint').hidden = true; else if (segmenter) { $('blurHint').hidden = false; $('blurHint').textContent = 'Background blur is on. It uses more processing power.'; } };
  $('sysAudio').onchange = async (e) => { await save({ systemAudio: e.target.checked }); await startScreen(); };
  $('haloChk').onchange = (e) => { save({ cursorHalo: e.target.checked }); R.pointerTracking(!!screenStream && S.mode !== 'window' && (S.cursorHalo || S.clickRipples)); };
  $('rippleChk').onchange = (e) => { save({ clickRipples: e.target.checked }); R.pointerTracking(!!screenStream && S.mode !== 'window' && (S.cursorHalo || S.clickRipples)); };
  if (!info.hasClickHook) { $('rippleChk').disabled = true; }
  document.querySelectorAll('#qualitySeg button').forEach((b) => { b.onclick = () => { if (recording()) return; save({ quality: b.dataset.q }); markActive('qualitySeg', 'q', b.dataset.q); }; });
  document.querySelectorAll('#fpsSeg button').forEach((b) => { b.onclick = () => { if (recording()) return; save({ fps: Number(b.dataset.fps) }); markActive('fpsSeg', 'fps', b.dataset.fps); startTicker(); startScreen(); }; });
  $('countdownChk').onchange = (e) => save({ countdown: e.target.checked });

  $('liveChk').onchange = async (e) => {
    await save({ liveOn: e.target.checked });
    refreshLiveUi();
    if (S.liveOn && !liveReady()) openLiveDialog();
  };
  $('livePlatform').onchange = async (e) => { await save({ livePlatform: e.target.value }); refreshLiveUi(); if (!liveReady()) openLiveDialog(); };
  document.querySelectorAll('#liveQualitySeg button').forEach((b) => { b.onclick = async () => { if (recording()) return; await save({ liveQuality: b.dataset.lq }); refreshLiveUi(); }; });
  $('liveKeyBtn').onclick = openLiveDialog;
  $('lvSave').onclick = saveLiveDialog;
  $('lvCancel').onclick = () => { $('lvKey').value = ''; $('liveDlg').hidden = true; };
  $('lvClose').onclick = () => { $('lvKey').value = ''; $('liveDlg').hidden = true; };
  $('lvShow').onclick = () => { const k = $('lvKey'); k.type = k.type === 'password' ? 'text' : 'password'; $('lvShow').textContent = k.type === 'password' ? 'Show' : 'Hide'; };
  $('lvOpen').onclick = () => { const p = liveInfo.platforms[S.livePlatform]; if (p.keyUrl) R.openExternal(p.keyUrl); };
  $('lvRemove').onclick = async () => { const r = await R.liveSave({ platform: S.livePlatform, remove: true }); if (r.ok) { liveInfo = r.info; refreshLiveUi(); openLiveDialog(); } };
  $('lvKey').onkeydown = (e) => { if (e.key === 'Enter') saveLiveDialog(); };

  $('recordBtn').onclick = startRecording;
  $('pauseBtn').onclick = togglePause;
  $('muteBtn').onclick = toggleMute;
  $('stopBtn').onclick = stopRecording;
  $('savedPlay').onclick = () => lastSaved && R.libOpen(lastSaved.id);
  $('savedEdit').onclick = () => lastSaved && openEditor(lastSaved);
  $('savedFolder').onclick = () => lastSaved && R.libShow(lastSaved.id);
  $('savedClose').onclick = () => { $('saved').hidden = true; };

  $('libOpenFolder').onclick = () => R.openSaveDir();
  $('libRefresh').onclick = () => R.libList().then((l) => { library = l; renderLibrary(); });

  $('rnSave').onclick = doRename;
  $('rnCancel').onclick = () => { $('renameDlg').hidden = true; };
  $('rnInput').onkeydown = (e) => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') $('renameDlg').hidden = true; };
  $('cfOk').onclick = doDelete;
  $('cfCancel').onclick = () => { $('confirmDlg').hidden = true; };

  $('trimStart').oninput = () => { updateTrim(); $('edVideo').currentTime = parseFloat($('trimStart').value); };
  $('trimEnd').oninput = () => { updateTrim(); $('edVideo').currentTime = parseFloat($('trimEnd').value); };
  $('setStart').onclick = () => { $('trimStart').value = $('edVideo').currentTime.toFixed(1); updateTrim(); };
  $('setEnd').onclick = () => { $('trimEnd').value = $('edVideo').currentTime.toFixed(1); updateTrim(); };
  $('edPreview').onclick = () => {
    const v = $('edVideo');
    const { s, en } = trimVals();
    v.currentTime = s;
    v.play();
    if (previewStop) v.removeEventListener('timeupdate', previewStop);
    previewStop = () => { if (v.currentTime >= en) { v.pause(); v.removeEventListener('timeupdate', previewStop); } };
    v.addEventListener('timeupdate', previewStop);
  };
  $('edTrim').onclick = () => runJob('trim');
  $('edGif').onclick = () => runJob('gif');
  $('edSmall').onclick = () => runJob('compress');
  $('edCancel').onclick = () => R.libCancel();
  $('edClose').onclick = () => { $('edVideo').pause(); $('edVideo').removeAttribute('src'); $('editor').hidden = true; };

  $('saveDirBtn').onclick = async () => { const d = await R.chooseSaveDir(); if (d) { S.saveDir = d; renderSettings(); } };
  $('askSaveChk').onchange = (e) => save({ askWhereToSave: e.target.checked });
  $('standardChk').onchange = (e) => save({ standardMp4: e.target.checked });
  document.querySelectorAll('#themeSeg button').forEach((b) => {
    b.onclick = async () => {
      await save({ theme: b.dataset.theme });
      markActive('themeSeg', 'theme', b.dataset.theme);
      applyTheme(b.dataset.theme === 'dark' || (b.dataset.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));
    };
  });
  $('autoUpdChk').onchange = (e) => save({ checkUpdates: e.target.checked });
  $('checkBtn').onclick = () => checkUpdates(true);
  $('ghBtn').onclick = () => R.releasesPage();
  $('tourBtn').onclick = startTour;
  $('updGet').onclick = () => { if (updateUrl) R.openExternal(updateUrl); $('updateBanner').hidden = true; };
  $('updLater').onclick = () => { $('updateBanner').hidden = true; };
  $('recKeep').onclick = () => handleRecovery(true);
  $('recDiscard').onclick = () => handleRecovery(false);

  $('tourNext').onclick = () => { if (tourIdx < TOUR.length - 1) { tourIdx++; showTourStep(); } else endTour(); };
  $('tourBack').onclick = () => { if (tourIdx > 0) { tourIdx--; showTourStep(); } };
  $('tourSkip').onclick = endTour;
  window.addEventListener('resize', () => { if (!$('tour').hidden) showTourStep(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('tour').hidden) endTour();
    else if (!$('editor').hidden) $('edClose').click();
    else { $('renameDlg').hidden = true; $('confirmDlg').hidden = true; $('lvKey').value = ''; $('liveDlg').hidden = true; }
  });

  navigator.mediaDevices.addEventListener('devicechange', async () => {
    if (recording()) return;
    const before = [S.camId, S.micId].join('|');
    await loadDevices();
    if ([S.camId, S.micId].join('|') !== before) { await startCamera(); await startMic(); }
  });
}

function applySettingsToUi() {
  markActive('modeSeg', 'mode', S.mode);
  markActive('shapeSeg', 'shape', S.camShape);
  $('sizeRange').value = Math.round(S.camSize * 100);
  $('blurChk').checked = !!S.blur;
  $('sysAudio').checked = !!S.systemAudio;
  $('haloChk').checked = !!S.cursorHalo;
  $('rippleChk').checked = !!S.clickRipples;
  markActive('qualitySeg', 'q', S.quality);
  markActive('fpsSeg', 'fps', S.fps);
  $('countdownChk').checked = !!S.countdown;
}

// ---------- start ----------
(async function init() {
  info = await R.init();
  S = info.settings;
  library = info.library || [];
  liveInfo = info.live;
  refreshLiveUi();
  applyTheme(S.theme === 'dark' || (S.theme === 'system' && info.dark));
  applySettingsToUi();
  bindUi();
  setControls('idle');
  renderLibrary();
  startTicker();
  recoveryItems = info.recovery || [];
  showRecovery();
  await unlockDeviceNames();
  await loadDevices();
  await Promise.all([startCamera(), startMic(), loadSources()]);
  const firstScreen = sources.find((s) => s.isScreen && s.display && s.display.primary) || sources.find((s) => s.isScreen);
  if (S.mode !== 'window' && firstScreen) await chooseSource(firstScreen.id);
  else setStatus('Pick what to record.');
  if (S.mode === 'area' && !S.area) setStatus('Click “Select area”, then drag over the part of the screen to record.');
  if (!S.tourDone) setTimeout(startTour, 600);
  if (S.checkUpdates !== false) checkUpdates(false);
})();
