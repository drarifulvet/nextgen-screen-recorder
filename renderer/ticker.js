// Steady 30 fps clock. Timers inside a worker keep running when the window is minimised.
let id = null;
self.onmessage = (e) => {
  if (e.data && e.data.start) {
    clearInterval(id);
    id = setInterval(() => self.postMessage(0), 1000 / (e.data.fps || 30));
  } else if (e.data && e.data.stop) {
    clearInterval(id);
  }
};
