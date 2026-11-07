// Fetches the large files the app needs but the repository does not store:
//  - FFmpeg for Windows (trim, GIF, smaller copies, standard MP4)  -> vendor/ffmpeg.exe
//  - MediaPipe runtime + selfie model (background blur)            -> renderer/vendor/mediapipe/
// Runs automatically before `npm run dist`. Safe to run again: existing files are kept.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const FFMPEG_URL = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64.gz';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

function get(url, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'nextgen-recorder-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), hops + 1));
      } else if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`${url} answered ${res.statusCode}`));
      } else resolve(res);
    }).on('error', reject);
  });
}

async function download(url, dest, gunzip) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { console.log('  ✓ already present', path.relative(ROOT, dest)); return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log('  ↓', url);
  const res = await get(url);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest + '.part');
    (gunzip ? res.pipe(zlib.createGunzip()) : res).pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });
  fs.renameSync(dest + '.part', dest);
  console.log('  ✓ saved', path.relative(ROOT, dest));
}

(async () => {
  console.log('Preparing build files…');
  const mp = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision');
  const outMp = path.join(ROOT, 'renderer', 'vendor', 'mediapipe');
  fs.mkdirSync(outMp, { recursive: true });
  for (const [from, to] of [
    ['vision_bundle.mjs', 'vision_bundle.mjs'],
    ['wasm/vision_wasm_internal.js', 'vision_wasm_internal.js'],
    ['wasm/vision_wasm_internal.wasm', 'vision_wasm_internal.wasm'],
  ]) {
    fs.copyFileSync(path.join(mp, from), path.join(outMp, to));
  }
  console.log('  ✓ copied MediaPipe runtime');
  await download(MODEL_URL, path.join(outMp, 'selfie_segmenter.tflite'), false);
  await download(FFMPEG_URL, path.join(ROOT, 'vendor', 'ffmpeg.exe'), true);
  console.log('Done.');
})().catch((e) => { console.error('Prepare failed:', e.message); process.exit(1); });
