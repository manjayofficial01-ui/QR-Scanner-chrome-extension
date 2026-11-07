/* QR Scanner · popup controller */
'use strict';

(() => {
  const $ = (s) => document.querySelector(s);
  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  const alertSlot = $('#alertSlot');
  const resultSlot = $('#resultSlot');
  const actionRow = $('#actionRow');
  const scanView = $('#scanView');
  const historyView = $('#historyView');
  const historyList = $('#historyList');
  const historyFoot = $('#historyFoot');
  const historyCount = $('#historyCount');
  const searchInput = $('#searchInput');

  $('#brandMark').innerHTML = QR.LOGO_HTML;
  $('#dzRing').appendChild(QR.icon('upload', 22, 1.9));
  $('#historyBtn').appendChild(QR.icon('history', 17));
  $('#cameraBtn').append(QR.icon('camera', 16, 1.9), document.createTextNode('Live camera'));
  $('#regionBtn').append(QR.icon('crop', 16, 1.9), document.createTextNode('Select region'));
  $('#clearHistory').append(QR.icon('trash', 13, 1.9), document.createTextNode('Clear all'));
  $('#searchBox').prepend(QR.icon('search', 15, 1.9));
  QR.bindSoundButton($('#soundBtn'));

  let currentResult = null;
  let historyCache = [];
  let historyOpen = false;

  /* ---------- floating window ---------- */
  const FLOATING = new URLSearchParams(location.search).get('float') === '1';
  if (FLOATING) {
    document.documentElement.classList.add('floating');
    document.body.classList.add('floating');
  }
  const floatBtn = $('#floatBtn');
  floatBtn.appendChild(QR.icon('float', 16, 1.8));
  floatBtn.classList.toggle('active', FLOATING);
  floatBtn.setAttribute('aria-pressed', String(FLOATING));
  floatBtn.title = FLOATING ? 'Close floating window' : 'Float window';
  floatBtn.addEventListener('click', async () => {
    if (FLOATING) { window.close(); return; }
    if (QR.IS_EXT) {
      await chrome.windows.create({
        url: chrome.runtime.getURL('popup.html?float=1'),
        type: 'popup',
        width: 400,
        height: 640,
      });
      window.close();
    } else {
      window.open('popup.html?float=1', '_blank', 'width=400,height=640');
    }
  });

  /* ---------- alerts ---------- */
  function showAlert(msg, kind, sticky) {
    alertSlot.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'alert' + (kind === 'info' ? ' info' : '');
    el.appendChild(QR.icon(kind === 'info' ? 'info' : 'alert', 15, 1.9));
    el.appendChild(document.createTextNode(msg));
    alertSlot.appendChild(el);
    clearTimeout(showAlert.t);
    if (!sticky) showAlert.t = setTimeout(() => { alertSlot.innerHTML = ''; }, 4200);
  }
  function clearAlert() {
    clearTimeout(showAlert.t);
    alertSlot.innerHTML = '';
  }

  /* ---------- result ---------- */
  function showResult(entry) {
    currentResult = entry;
    resultSlot.innerHTML = '';
    actionRow.hidden = true;
    resultSlot.appendChild(QR.createResultCard(entry, { onClose: hideResult }));
    dropzone.classList.add('success');
    setTimeout(() => dropzone.classList.remove('success'), 1600);
  }
  function hideResult() {
    currentResult = null;
    resultSlot.innerHTML = '';
    actionRow.hidden = false;
  }

  /* ---------- scan pipeline ---------- */
  function setBusy(busy) { dropzone.classList.toggle('busy', busy); }

  async function acceptScan(text, source) {
    const entry = QR.makeEntry(text, source);
    await QR.store.add(entry);
    QR.beep();
    showResult(entry);
    if (historyOpen) renderHistory();
  }

  function scanFailed(msg) {
    showAlert(msg || 'No QR code found in this image.');
    dropzone.classList.add('shake');
    setTimeout(() => dropzone.classList.remove('shake'), 450);
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      scanFailed('That file is not an image.');
      return;
    }
    setBusy(true);
    alertSlot.innerHTML = '';
    try {
      const text = await QR.decodeBlob(file);
      if (text) await acceptScan(text, 'Image');
      else scanFailed();
    } catch {
      scanFailed('Could not read that image.');
    } finally {
      setBusy(false);
      fileInput.value = '';
    }
  }

  /* ---------- dropzone events ---------- */
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); })
  );
  dropzone.addEventListener('dragleave', (e) => {
    if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  document.addEventListener('paste', (e) => {
    if (historyOpen) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        handleFile(item.getAsFile());
        return;
      }
    }
  });

  /* ---------- camera ---------- */
  $('#cameraBtn').addEventListener('click', () => {
    if (FLOATING) { location.href = 'scanner.html?float=1'; return; }
    const url = QR.IS_EXT ? chrome.runtime.getURL('scanner.html') : 'scanner.html';
    if (QR.IS_EXT) chrome.tabs.create({ url });
    else window.open(url, '_blank');
  });

  /* ---------- region capture (screenshot of the active webpage) ---------- */
  $('#regionBtn').addEventListener('click', async () => {
    clearAlert();
    if (QR.IS_EXT) {
      chrome.runtime.sendMessage({ type: 'region-scan' }).then((resp) => {
        if (resp && resp.cancelled) clearAlert();
      }).catch(() => { /* popup closed before response — expected */ });
      if (FLOATING) showAlert('Select a region on the page — Esc to cancel.', 'info', true);
      else window.close();
      return;
    }
    setBusy(true);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 } });
        try {
          const video = document.createElement('video');
          video.srcObject = stream;
          await video.play();
          await new Promise((r) => setTimeout(r, 350));
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext('2d').drawImage(video, 0, 0);
          const res = jsQR(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
          if (res && res.data) await acceptScan(res.data, 'Screen');
          else scanFailed('No QR code found on this screen.');
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      } else {
        showAlert('Screen capture is unavailable in this browser.', 'info');
      }
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        showAlert('Screen capture was cancelled.', 'info');
      } else {
        showAlert('This page cannot be captured.', 'info');
      }
    } finally {
      setBusy(false);
    }
  });

  /* ---------- incoming region captures ---------- */
  function ackResult() {
    if (!QR.IS_EXT) return;
    chrome.runtime.sendMessage({ type: 'ack-result' }).catch(() => {});
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
  }
  if (QR.IS_EXT) {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
    chrome.runtime.onMessage.addListener(async (m) => {
      if (m && m.type === 'scan-result') {
        clearAlert();
        showResult(m.entry);
        QR.beep();
        ackResult();
        if (historyOpen) { historyCache = await QR.store.history(); renderHistory(); }
      } else if (m && m.type === 'scan-error') {
        showAlert(m.message, 'info');
        ackResult();
      }
    });
    (async () => {
      const obj = await chrome.storage.local.get('qr.pending');
      const pending = obj['qr.pending'];
      if (!pending) return;
      await chrome.storage.local.remove('qr.pending');
      if (pending.error) showAlert(pending.error, 'info');
      else { showResult(pending); QR.beep(); }
    })();
  }

  /* ---------- history ---------- */
  function renderHistory() {
    const q = searchInput.value.trim().toLowerCase();
    const items = historyCache.filter((i) => !q || i.text.toLowerCase().includes(q));
    historyList.innerHTML = '';

    if (!historyCache.length) {
      historyFoot.hidden = true;
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      const ring = document.createElement('span');
      ring.className = 'he-ring';
      ring.appendChild(QR.icon('qr', 26, 1.6));
      const p = document.createElement('p');
      p.textContent = 'No scans yet';
      const span = document.createElement('span');
      span.textContent = 'Codes you scan will appear here.';
      empty.append(ring, p, span);
      historyList.appendChild(empty);
      return;
    }

    historyFoot.hidden = false;
    historyCount.textContent = q ? `${items.length} of ${historyCache.length}` : `${historyCache.length} scan${historyCache.length === 1 ? '' : 's'}`;

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      const p = document.createElement('p');
      p.textContent = 'No matches';
      const span = document.createElement('span');
      span.textContent = 'Try a different search.';
      empty.append(p, span);
      historyList.appendChild(empty);
      return;
    }

    items.forEach((entry, idx) => {
      const t = QR.TYPES[entry.type] || QR.TYPES.text;
      const item = document.createElement('div');
      item.className = 'h-item';
      item.dataset.id = entry.id;
      item.style.animationDelay = Math.min(idx * 0.03, 0.3) + 's';

      const ic = document.createElement('span');
      ic.className = 'h-icon type-' + entry.type;
      ic.appendChild(QR.icon(t.icon, 15, 1.8));

      const main = document.createElement('div');
      main.className = 'h-main';
      const text = document.createElement('div');
      text.className = 'h-text';
      text.textContent = entry.text;
      text.title = 'Click to expand';
      text.addEventListener('click', () => item.classList.toggle('expanded'));
      const meta = document.createElement('div');
      meta.className = 'h-meta';
      meta.textContent = `${t.label} · ${entry.source} · ${QR.timeAgo(entry.ts)}`;
      main.append(text, meta);

      const actions = document.createElement('div');
      actions.className = 'h-actions';
      if (['url', 'email', 'phone', 'geo'].includes(entry.type)) {
        const open = document.createElement('button');
        open.className = 'icon-btn small';
        open.title = 'Open';
        open.setAttribute('aria-label', 'Open');
        open.appendChild(QR.icon('open', 13, 1.9));
        open.addEventListener('click', () => QR.openPayload(entry.text, entry.type));
        actions.appendChild(open);
      }
      const copy = document.createElement('button');
      copy.className = 'icon-btn small';
      copy.title = 'Copy';
      copy.setAttribute('aria-label', 'Copy');
      copy.appendChild(QR.icon('copy', 13, 1.9));
      copy.addEventListener('click', async () => {
        if (await QR.copyText(entry.text)) {
          copy.innerHTML = '';
          copy.appendChild(QR.icon('check', 13, 2.2));
          QR.toast('Copied to clipboard');
          setTimeout(() => { copy.innerHTML = ''; copy.appendChild(QR.icon('copy', 13, 1.9)); }, 1200);
        }
      });
      const del = document.createElement('button');
      del.className = 'icon-btn small danger';
      del.title = 'Delete';
      del.setAttribute('aria-label', 'Delete scan');
      del.appendChild(QR.icon('trash', 13, 1.9));
      del.addEventListener('click', async () => {
        item.classList.add('removing');
        const snapshot = historyCache.slice();
        historyCache = await QR.store.remove(entry.id);
        setTimeout(() => renderHistory(), 220);
        QR.toast('Scan deleted', {
          actionLabel: 'Undo',
          onAction: async () => { historyCache = snapshot; await QR.store.replace(snapshot); renderHistory(); },
        });
      });
      actions.append(copy, del);

      item.append(ic, main, actions);
      historyList.appendChild(item);
    });
  }

  async function openHistory() {
    historyOpen = true;
    historyCache = await QR.store.history();
    scanView.hidden = true;
    historyView.hidden = false;
    $('#historyBtn').innerHTML = '';
    $('#historyBtn').appendChild(QR.icon('x', 17, 1.9));
    $('#historyBtn').title = 'Back to scanner';
    renderHistory();
    searchInput.focus();
  }
  function closeHistory() {
    historyOpen = false;
    historyView.hidden = true;
    scanView.hidden = false;
    searchInput.value = '';
    $('#historyBtn').innerHTML = '';
    $('#historyBtn').appendChild(QR.icon('history', 17));
    $('#historyBtn').title = 'Scan history';
  }
  $('#historyBtn').addEventListener('click', () => (historyOpen ? closeHistory() : openHistory()));
  searchInput.addEventListener('input', renderHistory);

  $('#clearHistory').addEventListener('click', async () => {
    const snapshot = historyCache.slice();
    if (!snapshot.length) return;
    historyCache = [];
    await QR.store.clear();
    renderHistory();
    QR.toast('History cleared', {
      actionLabel: 'Undo',
      onAction: async () => { historyCache = snapshot; await QR.store.replace(snapshot); renderHistory(); },
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (historyOpen) closeHistory();
      else if (currentResult) hideResult();
    }
  });
})();