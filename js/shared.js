/* QR Scanner · shared logic (storage, decoding, types, result card, toast, sound) */
'use strict';

window.QR = (() => {
  const IS_EXT = typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;

  /* ---------------- icons (static, trusted markup) ---------------- */
  const P = {
    qr: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z"/>',
    upload: '<path d="M12 16V4m0 0l-4 4m4-4l4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    camera: '<path d="M4 8h2l1.5-2.5h9L18 8h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 18l5-5 3.5 3.5L17 12l2.5 2.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    open: '<path d="M14 4h6v6"/><path d="M20 4L11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 12a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l1-12"/><path d="M10 11v6M14 11v6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
    sound: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 1 2.5 6"/><path d="M3.5 12H7M3.5 12V8.5"/><path d="M12 7.5V12l3 2"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path d="M14 10a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>',
    wifi: '<path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    phone: '<path d="M5 4h4l1.5 4.5L8 10a12 12 0 0 0 6 6l1.5-2.5L20 15v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    sms: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z"/><path d="M8 10h8M8 13h5"/>',
    geo: '<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    contact: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    event: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    text: '<path d="M5 6h14M5 10h14M5 14h9M5 18h6"/>',
    shield: '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"/><path d="M9.5 12l2 2 3.5-4"/>',
    flip: '<path d="M4 9a8 8 0 0 1 14-3l2 2M20 4v4h-4"/><path d="M20 15a8 8 0 0 1-14 3l-2-2M4 20v-4h4"/>',
    zap: '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V13"/><circle cx="12" cy="16.5" r="0.5" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.5" r="0.5" fill="currentColor"/>',
    scan: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M4 12h16"/>',
    float: '<rect x="2.5" y="4.5" width="13" height="12" rx="2"/><rect x="10.5" y="10.5" width="11" height="9" rx="2" fill="var(--bg1)"/>',
    back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>',
  };

  function icon(name, size = 18, sw = 1.7) {
    const span = document.createElement('span');
    span.style.display = 'inline-flex';
    span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.text}</svg>`;
    return span;
  }
  function iconHTML(name, size = 18, sw = 1.7) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.text}</svg>`;
  }

  const LOGO_HTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="2.5" y="2.5" width="8" height="8" rx="1.8" stroke="#22d3ee" stroke-width="1.8"/>
    <rect x="5.1" y="5.1" width="2.8" height="2.8" rx="0.7" fill="#67e8f9"/>
    <rect x="13.5" y="2.5" width="8" height="8" rx="1.8" stroke="#22d3ee" stroke-width="1.8"/>
    <rect x="16.1" y="5.1" width="2.8" height="2.8" rx="0.7" fill="#67e8f9"/>
    <rect x="2.5" y="13.5" width="8" height="8" rx="1.8" stroke="#22d3ee" stroke-width="1.8"/>
    <rect x="5.1" y="16.1" width="2.8" height="2.8" rx="0.7" fill="#67e8f9"/>
    <rect x="13.5" y="13.5" width="3.4" height="3.4" rx="0.8" fill="#a78bfa"/>
    <rect x="18.1" y="18.1" width="3.4" height="3.4" rx="0.8" fill="#22d3ee"/>
    <rect x="18.1" y="13.5" width="3.4" height="3.4" rx="0.8" fill="#3b4a73"/>
    <rect x="13.5" y="18.1" width="3.4" height="3.4" rx="0.8" fill="#3b4a73"/>
  </svg>`;

  /* ---------------- payload types ---------------- */
  const { TYPES, detectType, makeEntry } = self.QRPayload;

  function openPayload(text, type) {
    const t = text.trim();
    let url = null;
    if (type === 'url' && /^https?:\/\//i.test(t)) url = t;
    else if (type === 'email') url = /^mailto:/i.test(t) ? t : 'mailto:' + t;
    else if (type === 'phone') url = t;
    else if (type === 'geo') {
      const m = t.match(/^geo:(-?[\d.]+),(-?[\d.]+)/i);
      if (m) url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m[1] + ',' + m[2])}`;
    }
    if (!url) return false;
    if (IS_EXT && chrome.tabs) chrome.tabs.create({ url });
    else window.open(url, '_blank', 'noopener');
    return true;
  }

  function primaryActionFor(type) {
    switch (type) {
      case 'url': return { label: 'Open link', icon: 'open' };
      case 'email': return { label: 'Compose email', icon: 'mail' };
      case 'phone': return { label: 'Call number', icon: 'phone' };
      case 'geo': return { label: 'Open map', icon: 'geo' };
      default: return null;
    }
  }

  /* ---------------- clipboard ---------------- */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /* ---------------- storage ---------------- */
  const HISTORY_KEY = 'qr.history';
  const SETTINGS_KEY = 'qr.settings';
  const MAX_HISTORY = 100;

  async function readKey(key, fallback) {
    if (IS_EXT && chrome.storage) {
      const obj = await chrome.storage.local.get(key);
      return obj[key] === undefined ? fallback : obj[key];
    }
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  }
  async function writeKey(key, value) {
    if (IS_EXT && chrome.storage) return chrome.storage.local.set({ [key]: value });
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full */ }
  }

  const store = {
    async history() { return readKey(HISTORY_KEY, []); },
    async add(entry) {
      const items = await store.history();
      if (items[0] && items[0].text === entry.text) {
        items[0].ts = entry.ts;
        items[0].source = entry.source;
      } else {
        items.unshift(entry);
        if (items.length > MAX_HISTORY) items.length = MAX_HISTORY;
      }
      await writeKey(HISTORY_KEY, items);
      return items;
    },
    async remove(id) {
      const items = (await store.history()).filter((i) => i.id !== id);
      await writeKey(HISTORY_KEY, items);
      return items;
    },
    async replace(items) { await writeKey(HISTORY_KEY, items.slice(0, MAX_HISTORY)); },
    async clear() { await writeKey(HISTORY_KEY, []); },
    async setting(name, fallback) {
      const s = await readKey(SETTINGS_KEY, {});
      return s[name] === undefined ? fallback : s[name];
    },
    async setSetting(name, value) {
      const s = await readKey(SETTINGS_KEY, {});
      s[name] = value;
      await writeKey(SETTINGS_KEY, s);
    },
  };

  function timeAgo(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 8) return 'just now';
    if (s < 60) return Math.floor(s) + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* ---------------- sound ---------------- */
  let audioCtx = null;
  let soundEnabled = true;
  store.setting('sound', true).then((v) => { soundEnabled = !!v; });

  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  document.addEventListener('pointerdown', ensureAudio, { once: true });
  document.addEventListener('keydown', ensureAudio, { once: true });

  function beep() {
    if (!soundEnabled) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [[880, 0], [1318.5, 0.075]].forEach(([freq, dt]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + dt);
      gain.gain.exponentialRampToValueAtTime(0.07, t0 + dt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.11);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + 0.13);
    });
  }

  function setSound(enabled) {
    soundEnabled = enabled;
    store.setSetting('sound', enabled);
  }

  function bindSoundButton(btn) {
    const render = () => {
      btn.innerHTML = iconHTML(soundEnabled ? 'sound' : 'mute', 17);
      btn.classList.toggle('active', soundEnabled);
      btn.setAttribute('aria-pressed', String(soundEnabled));
      btn.title = soundEnabled ? 'Sound on — click to mute' : 'Sound off — click to unmute';
    };
    store.setting('sound', true).then((v) => { soundEnabled = !!v; render(); });
    btn.addEventListener('click', () => {
      setSound(!soundEnabled);
      render();
      if (soundEnabled) beep();
    });
    render();
  }

  /* ---------------- decoding ---------------- */
  function decodeDrawable(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let data;
    try { data = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch { return null; }
    let res = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
    if (!res && scale < 1 && w * h <= 12e6) {
      canvas.width = w; canvas.height = h;
      ctx.drawImage(img, 0, 0);
      try {
        data = ctx.getImageData(0, 0, w, h);
        res = jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
      } catch { res = null; }
    }
    return res && res.data ? res.data : null;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image-load-failed'));
      img.src = src;
    });
  }

  async function decodeBlob(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      return decodeDrawable(img);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }

  async function decodeSrc(src) {
    const img = await loadImage(src);
    return decodeDrawable(img);
  }

  /* ---------------- toast ---------------- */
  function toast(msg, opts = {}) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    const ic = document.createElement('span');
    ic.className = 't-icon' + (opts.kind ? ' ' + opts.kind : '');
    ic.appendChild(icon(opts.kind === 'warn' ? 'alert' : opts.kind === 'info' ? 'info' : 'check', 15, 2));
    const label = document.createElement('span');
    label.textContent = msg;
    el.append(ic, label);
    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 240);
    };
    if (opts.actionLabel && opts.onAction) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = opts.actionLabel;
      btn.addEventListener('click', () => { opts.onAction(); dismiss(); });
      el.appendChild(btn);
    }
    wrap.appendChild(el);
    timer = setTimeout(dismiss, opts.duration || (opts.actionLabel ? 5000 : 2600));
    while (wrap.children.length > 2) wrap.firstChild.remove();
    return dismiss;
  }

  /* ---------------- result card ---------------- */
  function createResultCard(entry, opts = {}) {
    const t = TYPES[entry.type] || TYPES.text;
    const card = document.createElement('div');
    card.className = 'result-card';

    const head = document.createElement('div');
    head.className = 'rc-head';
    const badge = document.createElement('span');
    badge.className = 'badge type-' + entry.type;
    badge.appendChild(icon(t.icon, 12, 2));
    badge.appendChild(document.createTextNode(t.label));
    const meta = document.createElement('span');
    meta.className = 'rc-meta';
    meta.textContent = `${entry.source} · ${timeAgo(entry.ts)}`;
    head.append(badge, meta);
    if (opts.onClose) {
      const close = document.createElement('button');
      close.className = 'icon-btn small rc-close';
      close.title = opts.closeLabel || 'Dismiss';
      close.setAttribute('aria-label', opts.closeLabel || 'Dismiss result');
      close.appendChild(icon('x', 14, 2));
      close.addEventListener('click', opts.onClose);
      head.appendChild(close);
    }

    const body = document.createElement('div');
    body.className = 'rc-text';
    body.tabIndex = 0;
    body.textContent = entry.text;

    const actions = document.createElement('div');
    actions.className = 'rc-actions';
    const primary = primaryActionFor(entry.type);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn ' + (primary ? 'ghost' : 'primary solo');
    copyBtn.appendChild(icon('copy', 15, 1.9));
    copyBtn.appendChild(document.createTextNode('Copy'));
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(entry.text);
      if (ok) {
        copyBtn.innerHTML = '';
        copyBtn.appendChild(icon('check', 15, 2.2));
        copyBtn.appendChild(document.createTextNode('Copied'));
        toast('Copied to clipboard');
        setTimeout(() => {
          copyBtn.innerHTML = '';
          copyBtn.appendChild(icon('copy', 15, 1.9));
          copyBtn.appendChild(document.createTextNode('Copy'));
        }, 1400);
      } else {
        toast('Copy failed — select the text manually', { kind: 'warn' });
      }
    });

    if (primary) {
      const openBtn = document.createElement('button');
      openBtn.className = 'btn primary';
      openBtn.appendChild(icon(primary.icon, 15, 1.9));
      openBtn.appendChild(document.createTextNode(primary.label));
      openBtn.addEventListener('click', () => {
        if (!openPayload(entry.text, entry.type)) toast('Nothing to open for this code', { kind: 'info' });
      });
      actions.append(openBtn, copyBtn);
    } else {
      actions.appendChild(copyBtn);
    }

    card.append(head, body, actions);
    return card;
  }

  return {
    IS_EXT, icon, iconHTML, LOGO_HTML, TYPES, detectType, openPayload,
    copyText, store, makeEntry, timeAgo, beep, setSound, bindSoundButton,
    decodeBlob, decodeSrc, decodeDrawable, toast, createResultCard,
  };
})();