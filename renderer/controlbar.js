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
  $('pause').textContent = s.paused ? 'Resume' : 'Pause';
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
    R.barCommand(drawing ? 'bar-expand' : 'bar-collapse');
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
