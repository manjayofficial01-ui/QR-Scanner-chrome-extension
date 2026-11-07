/* QR Scanner · live camera controller */
'use strict';

(() => {
  const $ = (s) => document.querySelector(s);
  const video = $('#video');
  const finderCard = $('#finderCard');
  const overlay = $('#finderOverlay');
  const statusPill = $('#statusPill');
  const statusText = $('#statusText');
  const camError = $('#camError');
  const camControls = $('#camControls');
  const resultSlot = $('#resultSlot');
  const hint = $('#hint');
  const fileInput = $('#fileInput');
  const flipBtn = $('#flipBtn');
  const torchBtn = $('#torchBtn');

  $('#brandMark').innerHTML = QR.LOGO_HTML;
  QR.bindSoundButton($('#soundBtn'));

  const FLOATING = new URLSearchParams(location.search).get('float') === '1';
  const backBtn = $('#backBtn');
  backBtn.appendChild(QR.icon('back', 17, 2));
  if (FLOATING) {
    document.body.classList.add('floating');
    backBtn.hidden = false;
  }
  backBtn.addEventListener('click', () => { location.href = 'popup.html?float=1'; });

  const floatBtn = $('#floatBtn');
  floatBtn.appendChild(QR.icon('float', 16, 1.8));
  floatBtn.classList.toggle('active', FLOATING);
  floatBtn.setAttribute('aria-pressed', String(FLOATING));
  floatBtn.title = FLOATING ? 'Close floating window' : 'Float window';
  floatBtn.addEventListener('click', async () => {
    if (FLOATING) { window.close(); return; }
    if (QR.IS_EXT) {
      await chrome.windows.create({
        url: chrome.runtime.getURL('scanner.html?float=1'),
        type: 'popup',
        width: 480,
        height: 780,
      });
      const tab = await chrome.tabs.getCurrent();
      if (tab) chrome.tabs.remove(tab.id);
      else window.close();
    } else {
      window.open('scanner.html?float=1', '_blank', 'width=480,height=780');
    }
  });
  flipBtn.append(QR.icon('flip', 16, 1.9), document.createTextNode('Flip camera'));
  torchBtn.append(QR.icon('zap', 16, 1.9), document.createTextNode('Torch'));
  $('#uploadBtn').append(QR.icon('image', 16, 1.9), document.createTextNode('Scan image'));
  $('#errUploadBtn').append(QR.icon('image', 15, 1.9), document.createTextNode('Scan an image'));
  $('#retryBtn').append(QR.icon('flip', 15, 1.9), document.createTextNode('Retry'));
  $('#ceIcon').appendChild(QR.icon('camera', 26, 1.7));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let stream = null;
  let loopTimer = null;
  let scanning = false;
  let devices = [];
  let deviceIndex = 0;
  let torchOn = false;
  let starting = false;

  function setStatus(mode, text) {
    statusPill.className = 'status-pill ' + mode;
    statusText.textContent = text;
  }

  function stopLoop() {
    scanning = false;
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  }

  function startLoop() {
    stopLoop();
    scanning = true;
    setStatus('scanning', 'Scanning');
    loopTimer = setInterval(tick, 140);
  }

  function tick() {
    if (!scanning || document.hidden) return;
    if (video.readyState < 2 || !video.videoWidth) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const scale = Math.min(1, 640 / w);
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let res = null;
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      res = jsQR(data.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
    } catch { return; }
    if (res && res.data) onFound(res.data, 'Camera');
  }

  async function onFound(text, source) {
    stopLoop();
    const entry = QR.makeEntry(text, source);
    await QR.store.add(entry);
    QR.beep();
    if (navigator.vibrate) navigator.vibrate(40);
    finderCard.classList.add('found');
    const flash = $('#successFlash');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    setStatus('found', 'Code found');
    hint.hidden = true;
    resultSlot.innerHTML = '';
    resultSlot.appendChild(QR.createResultCard(entry, {
      closeLabel: 'Scan next code',
      onClose: () => {
        resultSlot.innerHTML = '';
        finderCard.classList.remove('found');
        hint.hidden = !stream;
        if (stream) startLoop();
      },
    }));
    resultSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function showError(title, msg) {
    stopLoop();
    overlay.classList.add('idle');
    camControls.hidden = true;
    camError.hidden = false;
    hint.hidden = true;
    $('#ceTitle').textContent = title;
    $('#ceMsg').textContent = msg;
    setStatus('error', 'Camera off');
  }

  function clearError() {
    camError.hidden = true;
    camControls.hidden = false;
    overlay.classList.remove('idle');
    hint.hidden = false;
  }

  async function startCamera(deviceId) {
    if (starting) return;
    starting = true;
    clearError();
    setStatus('', 'Starting camera…');
    stopLoop();
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    torchOn = false;
    torchBtn.classList.remove('active');
    torchBtn.hidden = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('Camera not supported', 'This browser cannot access a camera. Scan an image instead.');
      starting = false;
      return;
    }

    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } catch (err2) {
        const name = err2 && err2.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          showError('Camera access denied', 'Allow camera access for this page in Chrome’s site settings, then press Retry. You can also scan an image.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          showError('No camera found', 'Connect a camera and press Retry, or scan an image file instead.');
        } else {
          showError('Camera unavailable', 'The camera could not be started. Press Retry, or scan an image file instead.');
        }
        starting = false;
        return;
      }
    }

    video.srcObject = stream;
    try { await video.play(); } catch { /* autoplay resolves on frames */ }

    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) torchBtn.hidden = false;

    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all.filter((d) => d.kind === 'videoinput');
      if (devices.length > 1) {
        const currentId = track.getSettings ? track.getSettings().deviceId : null;
        const idx = devices.findIndex((d) => d.deviceId === currentId);
        deviceIndex = idx >= 0 ? idx : 0;
        flipBtn.hidden = false;
      } else {
        flipBtn.hidden = true;
      }
    } catch { flipBtn.hidden = true; }

    starting = false;
    startLoop();
  }

  flipBtn.addEventListener('click', () => {
    if (devices.length < 2) return;
    deviceIndex = (deviceIndex + 1) % devices.length;
    startCamera(devices[deviceIndex].deviceId);
  });

  torchBtn.addEventListener('click', async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    torchOn = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      torchBtn.classList.toggle('active', torchOn);
    } catch {
      torchOn = false;
      torchBtn.classList.remove('active');
      QR.toast('Torch is not available on this camera', { kind: 'warn' });
    }
  });

  $('#retryBtn').addEventListener('click', () => startCamera());

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      QR.toast('That file is not an image', { kind: 'warn' });
      return;
    }
    setStatus('', 'Scanning image…');
    try {
      const text = await QR.decodeBlob(file);
      if (text) await onFound(text, 'Image');
      else {
        QR.toast('No QR code found in this image', { kind: 'warn' });
        if (stream) startLoop();
        else setStatus('error', 'Camera off');
      }
    } catch {
      QR.toast('Could not read that image', { kind: 'warn' });
      if (stream) startLoop();
    } finally {
      fileInput.value = '';
    }
  }

  $('#uploadBtn').addEventListener('click', () => fileInput.click());
  $('#errUploadBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && stream && !resultSlot.firstChild && camError.hidden) startLoop();
  });
  window.addEventListener('pagehide', () => {
    stopLoop();
    if (stream) stream.getTracks().forEach((t) => t.stop());
  });

  startCamera();
})();