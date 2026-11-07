/* QR Scanner · region selector overlay (injected into the active tab, isolated world) */
'use strict';

self.qrSelectRegion = function qrSelectRegion() {
  return new Promise((resolve) => {
    if (window.__qrRegionActive) { resolve(null); return; }
    window.__qrRegionActive = true;

    const host = document.createElement('div');
    host.id = 'qr-region-select-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .scrim { position: absolute; inset: 0; background: rgba(3, 6, 13, 0.55); }
        .sel {
          position: absolute; display: none;
          border: 1.5px solid #22d3ee;
          box-shadow: 0 0 0 9999px rgba(3, 6, 13, 0.55), 0 0 24px rgba(34, 211, 238, 0.35);
          border-radius: 4px;
        }
        .sel i { position: absolute; width: 16px; height: 16px; border: 0 solid #67e8f9; }
        .sel .tl { top: -2px; left: -2px; border-top-width: 3px; border-left-width: 3px; border-top-left-radius: 4px; }
        .sel .tr { top: -2px; right: -2px; border-top-width: 3px; border-right-width: 3px; border-top-right-radius: 4px; }
        .sel .bl { bottom: -2px; left: -2px; border-bottom-width: 3px; border-left-width: 3px; border-bottom-left-radius: 4px; }
        .sel .br { bottom: -2px; right: -2px; border-bottom-width: 3px; border-right-width: 3px; border-bottom-right-radius: 4px; }
        .size {
          position: absolute; top: calc(100% + 8px); right: -1.5px;
          font: 600 11px/1 'Inter', system-ui, sans-serif; letter-spacing: 0.04em;
          color: #a5f3fc; background: rgba(5, 9, 18, 0.85);
          border: 1px solid rgba(34, 211, 238, 0.35);
          padding: 5px 8px; border-radius: 6px; white-space: nowrap;
        }
        .size.above { top: auto; bottom: calc(100% + 8px); }
        .hint {
          position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
          display: flex; align-items: center; gap: 10px;
          font: 500 12.5px/1 'Inter', system-ui, sans-serif; color: #e9edf9;
          background: rgba(5, 9, 18, 0.88); backdrop-filter: blur(10px);
          border: 1px solid rgba(148, 163, 255, 0.25);
          padding: 10px 16px; border-radius: 12px;
          box-shadow: 0 12px 32px rgba(2, 4, 12, 0.55);
          pointer-events: none; white-space: nowrap;
        }
        .hint .dot { width: 7px; height: 7px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 8px #22d3ee; }
        .hint kbd {
          font: 600 10.5px/1 'Inter', system-ui, sans-serif; color: #9aa5c4;
          border: 1px solid rgba(148, 163, 255, 0.3); border-bottom-width: 2px;
          border-radius: 5px; padding: 3px 6px; background: rgba(148, 163, 255, 0.08);
        }
        .hint span.sep { color: #3b4a73; }
      </style>
      <div class="scrim"></div>
      <div class="sel"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><div class="size"></div></div>
      <div class="hint"><span class="dot"></span>Drag around the QR code<span class="sep">·</span><kbd>Enter</kbd> full screen<span class="sep">·</span><kbd>Esc</kbd> cancel</div>`;
    document.documentElement.appendChild(host);

    const scrim = root.querySelector('.scrim');
    const sel = root.querySelector('.sel');
    const sizeEl = root.querySelector('.size');
    const scrollX = window.scrollX, scrollY = window.scrollY;
    let start = null;
    let done = false;

    const cleanup = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', lockScroll, true);
      host.remove();
      window.__qrRegionActive = false;
      resolve(value);
    };
    const timeout = setTimeout(() => cleanup(null), 90000);
    const lockScroll = () => window.scrollTo(scrollX, scrollY);
    window.addEventListener('scroll', lockScroll, true);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        cleanup(null);
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        cleanup({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1, viewW: window.innerWidth });
      } else {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);

    host.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      host.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
      scrim.style.display = 'none';
      sel.style.display = 'block';
      update(e);
    });
    host.addEventListener('pointermove', (e) => { if (start) update(e); });
    host.addEventListener('pointerup', (e) => {
      if (!start) return;
      const r = rectFrom(start, e);
      start = null;
      if (r.width > 8 && r.height > 8) {
        cleanup({ x: r.x, y: r.y, width: r.width, height: r.height, dpr: window.devicePixelRatio || 1, viewW: window.innerWidth });
      } else {
        sel.style.display = 'none';
        scrim.style.display = 'block';
      }
    });
    host.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    host.addEventListener('contextmenu', (e) => e.preventDefault());

    function rectFrom(a, e) {
      return {
        x: Math.max(0, Math.min(a.x, e.clientX)),
        y: Math.max(0, Math.min(a.y, e.clientY)),
        width: Math.min(window.innerWidth, Math.abs(e.clientX - a.x)),
        height: Math.min(window.innerHeight, Math.abs(e.clientY - a.y)),
      };
    }
    function update(e) {
      const r = rectFrom(start, e);
      sel.style.left = r.x + 'px';
      sel.style.top = r.y + 'px';
      sel.style.width = r.width + 'px';
      sel.style.height = r.height + 'px';
      sizeEl.textContent = Math.round(r.width) + ' × ' + Math.round(r.height);
      sizeEl.classList.toggle('above', r.y + r.height > window.innerHeight - 44);
    }
  });
};