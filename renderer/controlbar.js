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

document.querySelectorAll('.tool').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('sel', x === b));
    R.barCommand({ tool: b.dataset.tool });
  };
});
document.querySelectorAll('.sw').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.sw').forEach((x) => x.classList.toggle('sel', x === b));
    R.barCommand({ tool: null, color: b.dataset.color });
  };
});

R.onBarTime((t) => { $('time').textContent = t; });
R.onBarState((s) => {
  $('wrap').classList.toggle('paused', !!s.paused);
  $('pause').textContent = s.paused ? 'Resume' : 'Pause';
  $('mic').classList.toggle('off', !!s.muted);
  $('micSlash').style.display = s.muted ? '' : 'none';
  $('cam').classList.toggle('off', !s.camOn);
  $('camSlash').style.display = s.camOn ? 'none' : '';
  $('draw').classList.toggle('on', !!s.drawing);
  if (!!s.drawing !== drawing) {
    drawing = !!s.drawing;
    $('tools').hidden = !drawing;
    R.barCommand(drawing ? 'bar-expand' : 'bar-collapse');
  }
});
let toastTimer = null;
R.onToast((msg) => {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
});
