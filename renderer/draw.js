'use strict';
// Draw-on-screen overlay. Strokes are drawn on a transparent window that sits above everything,
// so they appear in whole-screen and area recordings.
const c = document.getElementById('c');
const ctx = c.getContext('2d');
let tool = 'pen';
let color = '#FF3B30';
let shapes = [];
let current = null;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(innerWidth * dpr);
  c.height = Math.round(innerHeight * dpr);
  c.style.width = innerWidth + 'px';
  c.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}
window.addEventListener('resize', resize);

function styleFor(s) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
  ctx.lineWidth = s.tool === 'highlighter' ? 22 : 5;
}

function drawShape(s) {
  styleFor(s);
  const p = s.points;
  if (!p.length) return;
  if (s.tool === 'pen' || s.tool === 'highlighter') {
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i++) {
      const mx = (p[i - 1].x + p[i].x) / 2;
      const my = (p[i - 1].y + p[i].y) / 2;
      ctx.quadraticCurveTo(p[i - 1].x, p[i - 1].y, mx, my);
    }
    ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
    ctx.stroke();
  } else if (p.length > 1) {
    const a = p[0];
    const b = p[p.length - 1];
    if (s.tool === 'box') {
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (s.tool === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 20;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x - Math.cos(ang) * head * 0.6, b.y - Math.sin(ang) * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
      ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  shapes.forEach(drawShape);
  if (current) drawShape(current);
}

c.addEventListener('pointerdown', (e) => {
  c.setPointerCapture(e.pointerId);
  current = { tool, color, points: [{ x: e.clientX, y: e.clientY }] };
});
c.addEventListener('pointermove', (e) => {
  if (!current) return;
  if (current.tool === 'pen' || current.tool === 'highlighter') current.points.push({ x: e.clientX, y: e.clientY });
  else current.points[1] = { x: e.clientX, y: e.clientY };
  render();
});
c.addEventListener('pointerup', () => {
  if (current && current.points.length > 1) shapes.push(current);
  current = null;
  render();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.recorder.drawExit();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { shapes.pop(); render(); }
});

window.recorder.onDraw((m) => {
  if (m.cmd === 'tool') { if (m.tool) tool = m.tool; if (m.color) color = m.color; }
  else if (m.cmd === 'undo') { shapes.pop(); render(); }
  else if (m.cmd === 'clear') { shapes = []; current = null; render(); }
  else if (m.cmd === 'show') { resize(); }
});
resize();
