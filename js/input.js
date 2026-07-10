// Pointer & keyboard input: click-to-select, drag-to-pan, wheel/pinch zoom.

export function setupInput(canvas, renderer, callbacks) {
  const pointers = new Map();
  let dragging = false;
  let downPos = null;
  let pinchDist = 0;

  const pos = (e) => ({ x: e.clientX, y: e.clientY });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, pos(e));
    if (pointers.size === 1) {
      downPos = pos(e);
      dragging = false;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const cur = pos(e);
    pointers.set(e.pointerId, cur);

    if (pointers.size === 1 && downPos) {
      if (!dragging && Math.hypot(cur.x - downPos.x, cur.y - downPos.y) > 6) dragging = true;
      if (dragging) {
        renderer.cam.x += cur.x - prev.x;
        renderer.cam.y += cur.y - prev.y;
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
      }
      pinchDist = d;
    }
  });

  const endPointer = (e) => {
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (wasSingle && !dragging && downPos) {
      const t = renderer.tileAt(e.clientX, e.clientY);
      if (t) callbacks.onTileClick(t.x, t.y);
      else callbacks.onMissClick?.();
    }
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) { downPos = null; dragging = false; }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  function zoomAt(px, py, factor) {
    const cam = renderer.cam;
    const next = Math.min(2.5, Math.max(0.45, cam.zoom * factor));
    const real = next / cam.zoom;
    cam.x = px - (px - cam.x) * real;
    cam.y = py - (py - cam.y) * real;
    cam.zoom = next;
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.repeat) callbacks.onEndTurnKey?.();
    if (e.key === 'Escape') callbacks.onMissClick?.();
  });

  window.addEventListener('resize', () => renderer.resize());
}
