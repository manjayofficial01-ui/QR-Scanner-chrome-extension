/* QR Scanner · service worker — region capture orchestration & decoding */
'use strict';

importScripts('lib/jsqr.js', 'js/payload.js');

const HISTORY_KEY = 'qr.history';
const PENDING_KEY = 'qr.pending';
const MAX_HISTORY = 100;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'region-scan') {
    handleRegionScan().then(sendResponse).catch(() => sendResponse({ error: 'Capture failed.' }));
    return true;
  }
  if (msg && msg.type === 'ack-result') {
    chrome.storage.local.remove(PENDING_KEY);
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

async function handleRegionScan() {
  let dataUrl;
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [tab] = await chrome.tabs.query({ windowId: win.id, active: true });
    if (!tab || !tab.id) throw new Error('no-tab');
    dataUrl = await chrome.tabs.captureVisibleTab(win.id, { format: 'png' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['js/region-select.js'] });
    const [{ result: rect }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => self.qrSelectRegion(),
    });
    if (!rect) return { cancelled: true };

    const text = await decodeCapture(dataUrl, rect);
    if (!text) {
      await deliverError('No QR code found in the selection.');
      return { error: 'No QR code found in the selection.' };
    }
    const entry = QRPayload.makeEntry(text, 'Screen');
    const obj = await chrome.storage.local.get(HISTORY_KEY);
    const items = obj[HISTORY_KEY] || [];
    if (items[0] && items[0].text === entry.text) {
      items[0].ts = entry.ts;
      items[0].source = entry.source;
    } else {
      items.unshift(entry);
      if (items.length > MAX_HISTORY) items.length = MAX_HISTORY;
    }
    await chrome.storage.local.set({ [HISTORY_KEY]: items, [PENDING_KEY]: entry });
    await chrome.action.setBadgeBackgroundColor({ color: '#0d9488' });
    await chrome.action.setBadgeText({ text: '1' });
    broadcast({ type: 'scan-result', entry });
    return { entry };
  } catch (err) {
    const message = dataUrl === undefined
      ? 'This page cannot be captured.'
      : 'Capture failed on this page.';
    await deliverError(message);
    return { error: message };
  }
}

async function deliverError(message) {
  await chrome.storage.local.set({ [PENDING_KEY]: { error: message, ts: Date.now() } });
  await chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
  await chrome.action.setBadgeText({ text: '!' });
  broadcast({ type: 'scan-error', message });
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => { /* no open receiver — pending storage covers it */ });
}

async function decodeCapture(dataUrl, rect) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = bmp.width / rect.viewW;
  let x = Math.round(rect.x * scale);
  let y = Math.round(rect.y * scale);
  let w = Math.round(rect.width * scale);
  let h = Math.round(rect.height * scale);
  x = Math.max(0, Math.min(x, bmp.width - 1));
  y = Math.max(0, Math.min(y, bmp.height - 1));
  w = Math.max(1, Math.min(w, bmp.width - x));
  h = Math.max(1, Math.min(h, bmp.height - y));

  const crop = new OffscreenCanvas(w, h);
  crop.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const found = decodeCanvas(crop);
  if (found) { bmp.close(); return found; }

  const MAX = 1600;
  const fullScale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const full = new OffscreenCanvas(Math.round(bmp.width * fullScale), Math.round(bmp.height * fullScale));
  full.getContext('2d').drawImage(bmp, 0, 0, full.width, full.height);
  bmp.close();
  return decodeCanvas(full);
}

function decodeCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const res = jsQR(data.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
  return res && res.data ? res.data : null;
}