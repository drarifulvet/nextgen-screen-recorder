'use strict';
const $ = (id) => document.getElementById(id);
const R = window.recorder;
let drawing = false;

$('pause').onclick = () => R.barCommand('pause');
$('mic').onclick = () => R.barCommand('mute');
$('cam').onclick = () => R.barCommand('camera');
$('draw').onclick = () => R.barCommand('draw');
$('stop').onclick = () => {
  $('stop').disabled = true;
  $('stop').textContent = 'Saving…';
  R.barCommand('stop');
};
$('undo').onclick = () => R.barCommand('undo');
$('clear').onclick = () => R.barCommand('clear');
$('done').onclick = () => R.barCommand('draw');
$('mouse').onclick = () => R.barCommand('mouse');
document.querySelectorAll('.tool').forEach((b) => { b.onclick = () => R.barCommand({ tool: b.dataset.tool }); });
document.querySelectorAll('.sw').forEach((b) => { b.onclick = () => R.barCommand({ color: b.dataset.color }); });

R.onBarTime((t) => { $('time').textContent = t; });
R.onBarState((s) => {
  $('wrap').classList.toggle('paused', !!s.paused);
  $('pause').textContent = s.liveActive ? (s.onBreak ? 'Back live' : 'Break') : (s.paused ? 'Resume' : 'Pause');
  $('pause').title = s.liveActive ? 'Show viewers “Be right back” and turn off your sound (Alt+Shift+P)' : 'Pause or resume (Alt+Shift+P)';
  $('mic').classList.toggle('off', !!s.muted);
  $('micSlash').style.display = s.muted ? '' : 'none';
  $('cam').classList.toggle('off', !s.camOn);
  $('camSlash').style.display = s.camOn ? 'none' : '';
  $('draw').classList.toggle('on', !!s.drawing);
  // pen settings: highlight the active tool, colour and mouse mode (also when changed by shortcut)
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('sel', !s.mouse && b.dataset.tool === s.tool));
  document.querySelectorAll('.sw').forEach((b) => b.classList.toggle('sel', b.dataset.color === s.color));
  $('mouse').classList.toggle('on', !!s.mouse);
  if (!!s.drawing !== drawing) {
    drawing = !!s.drawing;
    $('tools').hidden = !drawing;
  }
});

// short messages appear in place of the drag handle for a moment
let msgTimer = null;
R.onToast((msg) => {
  const g = $('grip');
  g.textContent = msg;
  g.classList.add('msg');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { g.textContent = '⋮⋮'; g.classList.remove('msg'); }, 2500);
});

// Size the window to the bar itself (plus its margins), whenever the bar changes size.
const wrap = $('wrap');
let lastSize = '';
function reportSize() {
  const r = wrap.getBoundingClientRect();
  const cs = getComputedStyle(wrap);
  // page pixels -> window pixels (differs when Windows text size or zoom is enlarged)
  const k = window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : 1;
  const w = Math.ceil((r.width + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight)) * k);
  const h = Math.ceil((r.height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)) * k);
  const key = `${w}x${h}`;
  if (key === lastSize) return;
  lastSize = key;
  R.barCommand({ size: { w, h } });
}
new ResizeObserver(reportSize).observe(wrap);
window.addEventListener('resize', reportSize);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(reportSize);
reportSize();

// live status pill
R.onBarLive((st) => {
  const lv = $('lv');
  if (!st || st.state === 'ended') { lv.hidden = true; return; }
  lv.hidden = false;
  lv.className = 'lv' + (st.state === 'live' ? '' : st.state === 'failed' ? ' off' : ' wait');
  lv.textContent = { connecting: 'CONNECTING', reconnecting: 'RECONNECTING', live: 'LIVE', failed: 'OFFLINE' }[st.state] || '';
  lv.title = st.message || (st.state === 'live' ? `Live on ${st.platform}` : '');
});
