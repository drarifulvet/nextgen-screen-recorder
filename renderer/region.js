'use strict';
const sel = document.getElementById('sel');
const size = document.getElementById('size');
const actions = document.getElementById('actions');
let start = null;
let rect = null;

const even = (n) => Math.max(0, Math.round(n / 2) * 2);

function show(r) {
  sel.style.display = 'block';
  sel.style.left = r.x + 'px';
  sel.style.top = r.y + 'px';
  sel.style.width = r.w + 'px';
  sel.style.height = r.h + 'px';
  size.textContent = `${r.w} × ${r.h}`;
  size.style.top = r.y < 34 ? '6px' : '-30px';
  size.style.left = r.y < 34 ? '6px' : '0';
  document.body.classList.add('has-sel');
}

window.addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) return;
  start = { x: e.clientX, y: e.clientY };
  actions.style.display = 'none';
});
window.addEventListener('mousemove', (e) => {
  if (!start) return;
  rect = {
    x: even(Math.min(start.x, e.clientX)), y: even(Math.min(start.y, e.clientY)),
    w: even(Math.abs(e.clientX - start.x)), h: even(Math.abs(e.clientY - start.y)),
  };
  show(rect);
});
window.addEventListener('mouseup', () => {
  if (!start) return;
  start = null;
  if (!rect || rect.w < 40 || rect.h < 40) { rect = null; sel.style.display = 'none'; document.body.classList.remove('has-sel'); return; }
  const below = rect.y + rect.h + 50 < window.innerHeight;
  actions.style.display = 'flex';
  actions.style.left = Math.min(rect.x, window.innerWidth - 340) + 'px';
  actions.style.top = (below ? rect.y + rect.h + 10 : Math.max(10, rect.y - 50)) + 'px';
});
window.addEventListener('dblclick', () => { if (rect) done(rect); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') done(null);
  if (e.key === 'Enter' && rect) done(rect);
});
document.getElementById('ok').onclick = () => done(rect);
document.getElementById('redo').onclick = () => {
  rect = null; sel.style.display = 'none'; actions.style.display = 'none'; document.body.classList.remove('has-sel');
};
document.getElementById('cancel').onclick = () => done(null);

function done(r) { window.recorder.regionDone(r); }
