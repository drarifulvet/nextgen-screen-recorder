// NextGen Screen Recorder — live streaming (RTMP / RTMPS) through FFmpeg.
// The page records the canvas + mixed sound with a dedicated MediaRecorder and sends the pieces here;
// FFmpeg converts them to what platforms expect (H.264 + AAC, keyframe every 2 s, steady bitrate)
// and sends them to the platform. If the connection drops, it reconnects with a fresh stream.
'use strict';

const { spawn } = require('child_process');

// Server addresses: YouTube and Facebook from OBS Studio's service list; Twitch from ingest.twitch.tv ("Default").
const PLATFORMS = {
  youtube: {
    name: 'YouTube', server: 'rtmps://a.rtmps.youtube.com:443/live2', keyUrl: 'https://studio.youtube.com/',
    keyHelp: ['Open YouTube Studio and click Create → Go live.', 'Choose Stream (streaming software).', 'Copy the Stream key and paste it below.'],
  },
  facebook: {
    name: 'Facebook', server: 'rtmps://rtmp-api.facebook.com:443/rtmp/', keyUrl: 'https://www.facebook.com/live/producer',
    keyHelp: ['Open Facebook Live Producer.', 'Choose Streaming software as the video source.', 'Copy the Stream key and paste it below.'],
    note: 'Facebook only allows live video from accounts at least 60 days old; Pages and professional profiles also need at least 100 followers.',
  },
  twitch: {
    name: 'Twitch', server: 'rtmp://ingest.global-contribute.live-video.net/app', keyUrl: 'https://dashboard.twitch.tv/settings/stream',
    keyHelp: ['Open the Twitch Creator Dashboard → Settings → Stream.', 'Next to Primary Stream key, click Copy.', 'Paste it below.'],
  },
  custom: {
    name: 'Other', server: '', keyUrl: null,
    keyHelp: ['In your platform (LinkedIn Live, X Media Studio, Restream and others), open its streaming-software settings.', 'Copy the Server URL (starts with rtmp:// or rtmps://) and the Stream key.', 'Paste both below.'],
  },
};

// Stream presets (30 fps). Facebook caps 720p30 at 4 Mbps and 1080p30 at 6 Mbps; Twitch caps at 6 Mbps.
const QUALITY = {
  720: { height: 720, kbps: 4000, label: '720p · 4 Mbps' },
  1080: { height: 1080, kbps: 6000, label: '1080p · 6 Mbps' },
};
const FPS = 30;
const AUDIO_KBPS = 128;

function joinUrl(server, key) {
  if (!key) return server;
  return server.replace(/\/+$/, '') + '/' + key.replace(/^\/+/, '');
}

function ffmpegArgs(url, quality, hasAudio) {
  const q = QUALITY[quality] || QUALITY[720];
  const args = [
    '-hide_banner', '-loglevel', 'info', '-stats',
    '-fflags', '+genpts', '-probesize', '2000000', '-analyzeduration', '2000000',
    '-thread_queue_size', '512', '-f', 'matroska', '-i', 'pipe:0',
  ];
  if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  args.push(
    '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0',
    '-vf', `scale=-2:${q.height}:flags=bicubic,format=yuv420p`,
    '-fps_mode', 'cfr', '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main',
    '-b:v', `${q.kbps}k`, '-maxrate', `${q.kbps}k`, '-bufsize', `${q.kbps * 2}k`,
    '-g', String(FPS * 2), '-keyint_min', String(FPS * 2), '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ar', '44100', '-ac', '2',
    ...(hasAudio ? [] : ['-shortest']),
    '-f', 'flv', '-flvflags', 'no_duration_filesize', url,
  );
  return args;
}

function friendlyError(text, platformName, wasLive) {
  const t = text || '';
  if (/Failed to resolve|getaddrinfo|Name or service not known|No such host|Network is unreachable|Temporary failure in name resolution/i.test(t)) {
    return `Can't reach ${platformName}. Check your internet connection.`;
  }
  if (/timed out|Connection timed out|Operation timed out/i.test(t)) return `${platformName} didn't answer in time. Check your internet connection.`;
  if (/Connection refused/i.test(t)) return `${platformName} refused the connection. Check the server address.`;
  if (/Unknown encoder|Encoder not found|No such filter/i.test(t)) return 'The streaming component is missing from this installation. Reinstall the app.';
  if (/Invalid data found when processing input|EBML header parsing failed/i.test(t)) return 'The video could not be prepared for streaming.';
  if (wasLive) return `The connection to ${platformName} was lost.`;
  return `${platformName} didn't accept the stream. Check the stream key, and that a live stream is ready in ${platformName}.`;
}

class LiveSession {
  // opts: { ffmpeg, platform, server, key, quality, hasAudio, onState, onRestart, log }
  constructor(opts) {
    this.o = opts;
    this.p = PLATFORMS[opts.platform] || PLATFORMS.custom;
    this.name = opts.platform === 'custom' ? (hostName(opts.server) || 'the server') : this.p.name;
    this.session = 0;
    this.child = null;
    this.stopped = false;
    this.everLive = false;
    this.attempt = 0;
    this.retryTimer = null;
    this.state = 'idle';
    this.kbps = 0;
    this.backlogWarned = false;
  }

  emit(state, extra = {}) {
    this.state = state;
    this.o.onState({ state, platform: this.name, attempt: this.attempt, kbps: this.kbps, ...extra });
  }

  scrub(s) {
    let out = String(s || '');
    if (this.o.key) out = out.split(this.o.key).join('••••');
    return out;
  }

  start() {
    this.stopped = false;
    this.spawn();
    return this.session;
  }

  spawn() {
    this.session += 1;
    const session = this.session;
    const url = joinUrl(this.o.server, this.o.key);
    let tail = '';
    let connected = false;
    this.kbps = 0;
    this.backlogWarned = false;
    this.emit(this.attempt ? 'reconnecting' : 'connecting');
    let child;
    try {
      child = spawn(this.o.ffmpeg, ffmpegArgs(url, this.o.quality, this.o.hasAudio), { windowsHide: true });
    } catch (e) {
      this.emit('failed', { message: 'The streaming component could not start.' });
      return;
    }
    this.child = child;
    child.stdin.on('error', () => { /* handled on exit */ });
    child.on('error', () => {
      if (this.child === child) this.emit('failed', { message: 'The streaming component is missing. Reinstall the app.' });
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-6000);
      if (!connected && /Output #0, flv/.test(tail)) connected = true;
      const m = /bitrate=\s*([\d.]+)kbits\/s/.exec(s);
      if (m) this.kbps = Math.round(parseFloat(m[1]));
      if (connected && /frame=\s*\d+/.test(s) && this.child === child) {
        if (this.state !== 'live') {
          this.everLive = true;
          this.attempt = 0;
          this.emit('live');
        } else {
          this.o.onState({ state: 'live', platform: this.name, kbps: this.kbps, health: true });
        }
      }
    });
    child.on('close', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopped) { this.emit('ended'); return; }
      const msg = friendlyError(this.scrub(tail), this.name, connected);
      if (this.o.log) this.o.log(`ffmpeg exited ${code}: ${this.scrub(tail).split('\n').slice(-4).join(' | ')}`);
      // Connection never worked: give up after 2 quick retries. Dropped mid-stream: keep trying for a while.
      const limit = this.everLive ? 10 : 2;
      if (this.attempt >= limit) { this.emit('failed', { message: msg }); return; }
      this.attempt += 1;
      const delay = [2, 4, 8, 15, 30][Math.min(this.attempt - 1, 4)] * 1000;
      this.emit('reconnecting', { message: msg, retryInMs: delay });
      this.retryTimer = setTimeout(() => {
        if (this.stopped) return;
        this.spawn();
        this.o.onRestart(this.session); // the page starts a fresh recorder (a new stream needs a new header)
      }, delay);
    });
  }

  write(session, buf) {
    const c = this.child;
    if (!c || session !== this.session || !c.stdin.writable) return false;
    c.stdin.write(Buffer.from(buf));
    // If the internet can't keep up, data piles up here.
    const backlog = c.stdin.writableLength;
    if (backlog > 6 * 1024 * 1024 && !this.backlogWarned) {
      this.backlogWarned = true;
      this.o.onState({ state: this.state, platform: this.name, warn: 'Your internet upload is too slow for this quality. Try 720p.' });
    }
    if (backlog > 80 * 1024 * 1024) c.kill(); // far behind: reconnect with a fresh stream
    return true;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const c = this.child;
    if (!c) { this.emit('ended'); return; }
    try { c.stdin.end(); } catch { /* ignore */ }
    setTimeout(() => { try { c.kill(); } catch { /* ignore */ } }, 5000);
  }
}

function hostName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

module.exports = { PLATFORMS, QUALITY, LiveSession, joinUrl, ffmpegArgs, friendlyError };
