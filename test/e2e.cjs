/* End-to-end test: loads the unpacked extension in Chromium and exercises every flow.
   The loaded copy adds host_permissions so captureVisibleTab/scripting work headlessly
   (production uses activeTab, granted by the toolbar click — asserted minimal below). */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.dirname(__dirname);
const SHOTS = path.join(ROOT, 'test', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe');

let failures = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
};

(async () => {
  // production manifest stays minimal
  const realManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  ok(JSON.stringify(realManifest.permissions) === JSON.stringify(['storage', 'activeTab', 'scripting']), 'production manifest permissions minimal');
  ok(!realManifest.host_permissions, 'production manifest has no host permissions');

  // test copy with host access (stands in for the activeTab grant)
  const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-ext-'));
  fs.cpSync(ROOT, EXT, {
    recursive: true,
    filter: (s) => !s.startsWith(path.join(ROOT, 'test')) && !s.startsWith(path.join(ROOT, 'scripts')),
  });
  const mPath = path.join(EXT, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  m.host_permissions = ['<all_urls>'];
  fs.writeFileSync(mPath, JSON.stringify(m, null, 2));

  // fixture server
  const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
      res.end(d);
    });
  });
  await new Promise((r) => server.listen(8124, r));

  // fake-camera feed is a regenerable 20MB binary — build on demand
  const y4m = path.join(ROOT, 'test', 'camera-qr.y4m');
  if (!fs.existsSync(y4m)) {
    require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'test', 'make-camera-y4m.mjs')], { stdio: 'inherit' });
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-ext-test-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 380, height: 600 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${path.join(ROOT, 'test', 'camera-qr.y4m')}`,
    ],
  });

  const consoleErrors = [];
  context.on('page', (p) => {
    p.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(p.url() + ' :: ' + msg.text()); });
    p.on('pageerror', (e) => consoleErrors.push(p.url() + ' :: PAGEERROR ' + e.message));
  });

  const extPage = await context.newPage();
  await extPage.goto('chrome://extensions/');
  const extId = await extPage.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    if (!mgr) return null;
    const list = mgr.shadowRoot.querySelector('extensions-item-list');
    if (!list) return null;
    const item = list.shadowRoot.querySelector('extensions-item');
    return item ? item.id : null;
  });
  ok(!!extId, 'extension loaded, id=' + extId);
  if (!extId) throw new Error('extension not found');
  const base = `chrome-extension://${extId}`;
  await extPage.close();

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
  ok(sw.url().includes('background.js'), 'service worker registered');

  // --- popup: initial render ---
  let page = await context.newPage();
  await page.goto(base + '/popup.html');
  await page.waitForSelector('.dropzone');
  ok(await page.locator('.brand-name').innerText() === 'QR Scanner', 'popup renders brand');
  ok(await page.locator('#cameraBtn').isVisible(), 'camera button visible');
  ok((await page.locator('#regionBtn').innerText()).includes('Select region'), 'region button visible');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '01-popup-initial.png') });

  // --- scan URL image ---
  await page.setInputFiles('#fileInput', path.join(ROOT, 'test', 'qr-url.png'));
  await page.waitForSelector('.result-card', { timeout: 8000 });
  ok((await page.locator('.rc-text').innerText()) === 'https://example.com/launch', 'URL decoded from image');
  ok((await page.locator('.badge').innerText()).trim().toLowerCase() === 'link', 'type badge = Link');
  ok(await page.locator('.rc-actions .btn.primary').innerText() === 'Open link', 'primary action = Open link');
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(SHOTS, '02-popup-result-url.png') });

  await page.locator('.rc-actions .btn.ghost').click();
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (clip !== null) ok(clip === 'https://example.com/launch', 'copy writes clipboard');
  ok((await page.locator('.rc-actions .btn.ghost').innerText()).includes('Copied'), 'copy succeeds, button morphs to Copied');

  const [opened] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('.rc-actions .btn.primary').click(),
  ]);
  ok(opened.url().includes('example.com/launch'), 'Open link creates tab with payload URL');
  await opened.close();
  await page.locator('.rc-close').click();
  ok(await page.locator('#actionRow').isVisible(), 'dismiss restores action row');

  // --- no-QR image ---
  await page.setInputFiles('#fileInput', path.join(ROOT, 'test', 'no-qr.png'));
  await page.waitForSelector('.alert', { timeout: 8000 });
  ok((await page.locator('.alert').innerText()).includes('No QR code'), 'no-QR image shows error alert');
  await page.screenshot({ path: path.join(SHOTS, '03-popup-no-qr.png') });
  await page.waitForTimeout(4400);

  // --- inverted + small + wifi + email + text ---
  await page.setInputFiles('#fileInput', path.join(ROOT, 'test', 'qr-inverted.png'));
  await page.waitForSelector('.result-card', { timeout: 8000 });
  ok((await page.locator('.rc-text').innerText()) === 'https://example.com/inverted', 'inverted QR decoded');
  await page.locator('.rc-close').click();

  await page.setInputFiles('#fileInput', path.join(ROOT, 'test', 'qr-small.png'));
  await page.waitForSelector('.result-card', { timeout: 8000 });
  ok((await page.locator('.rc-text').innerText()) === 'https://example.com/small', 'small 132px QR decoded');
  await page.locator('.rc-close').click();

  await page.setInputFiles('#fileInput', path.join(ROOT, 'test', 'qr-wifi.png'));
  await page.waitForSelector('.result-card', { timeout: 8000 });
  ok((await page.locator('.badge').innerText()).trim().toLowerCase() === 'wi-fi', 'Wi-Fi type detected');
  ok(await page.locator('.rc-actions .btn').count() === 1, 'Wi-Fi offers copy only');
  await page.screenshot({ path: path.join(SHOTS, '04-popup-wifi.png') });
  await page.locator('.rc-close').click();

  await page.setInputFiles('#fileInput', path.join(ROOT, 'test', 'qr-email.png'));
  await page.waitForSelector('.result-card', { timeout: 8000 });
  ok((await page.locator('.badge').innerText()).trim().toLowerCase() === 'email', 'Email type detected');
  ok((await page.locator('.rc-actions .btn.primary').innerText()).includes('Compose'), 'Email primary = Compose');
  await page.locator('.rc-close').click();

  await page.setInputFiles('#fileInput', path.join(ROOT, 'test', 'qr-text.png'));
  await page.waitForSelector('.result-card', { timeout: 8000 });
  ok((await page.locator('.badge').innerText()).trim().toLowerCase() === 'text', 'plain Text type detected');
  await page.locator('.rc-close').click();

  // --- history ---
  await page.locator('#historyBtn').click();
  await page.waitForSelector('.h-item');
  ok(await page.locator('.h-item').count() === 6, 'history has 6 scans');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '05-history.png') });

  await page.fill('#searchInput', 'wifi');
  await page.waitForTimeout(200);
  ok(await page.locator('.h-item').count() === 1, 'history search filters');
  await page.fill('#searchInput', '');
  await page.waitForTimeout(200);

  await page.locator('.h-item').first().hover();
  await page.locator('.h-item .icon-btn.danger').first().click();
  await page.waitForTimeout(400);
  ok(await page.locator('.h-item').count() === 5, 'delete removes item');
  await page.locator('.toast-action').click();
  await page.waitForTimeout(300);
  ok(await page.locator('.h-item').count() === 6, 'undo restores item');

  await page.locator('#clearHistory').click();
  await page.waitForTimeout(300);
  ok(await page.locator('.history-empty').isVisible(), 'clear shows empty state');
  await page.screenshot({ path: path.join(SHOTS, '06-history-empty.png') });
  await page.locator('.toast-action').click();
  await page.waitForTimeout(300);
  ok(await page.locator('.h-item').count() === 6, 'undo restores history');

  await page.reload();
  await page.waitForSelector('.dropzone');
  await page.locator('#historyBtn').click();
  await page.waitForSelector('.h-item');
  ok(await page.locator('.h-item').count() === 6, 'history persists via chrome.storage');
  await page.locator('#historyBtn').click();

  // --- sound toggle ---
  const pressedBefore = await page.locator('#soundBtn').getAttribute('aria-pressed');
  await page.locator('#soundBtn').click();
  ok(pressedBefore !== (await page.locator('#soundBtn').getAttribute('aria-pressed')), 'sound toggle flips state');
  await page.locator('#soundBtn').click();

  // ================= REGION CAPTURE =================
  // Headless per-tab viewport emulation does not resize the shared OS window,
  // so captureVisibleTab can return a surface smaller than the page layout.
  // Force the window bounds to match the emulated viewport.
  async function setWindowSize(pg, width, height) {
    const cdp = await context.newCDPSession(pg);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width, height } });
    await cdp.detach();
  }
  const qrPage = await context.newPage();
  await qrPage.setViewportSize({ width: 1100, height: 750 });
  await qrPage.goto('http://localhost:8124/test/page-with-qr.html');
  await qrPage.bringToFront();
  await setWindowSize(qrPage, 1100, 750);

  // --- live delivery to an open popup tab ---
  await page.evaluate(() => { chrome.runtime.sendMessage({ type: 'region-scan' }); });
  await qrPage.waitForSelector('#qr-region-select-host', { timeout: 8000 });
  ok(true, 'region overlay injected into active webpage');

  // tiny drag resets, overlay stays
  await qrPage.mouse.move(100, 100);
  await qrPage.mouse.down();
  await qrPage.mouse.move(103, 103);
  await qrPage.mouse.up();
  ok(await qrPage.locator('#qr-region-select-host').count() === 1, 'tiny drag resets selection');

  // real drag around the QR image
  const box = await qrPage.locator('#qr').boundingBox();
  await qrPage.mouse.move(box.x - 12, box.y - 12);
  await qrPage.mouse.down();
  await qrPage.mouse.move(box.x + box.width + 12, box.y + box.height + 12, { steps: 10 });
  const selW = await qrPage.evaluate(() => {
    const host = document.querySelector('#qr-region-select-host');
    return parseFloat(host.shadowRoot.querySelector('.sel').style.width);
  });
  ok(Math.abs(selW - (box.width + 24)) < 3, 'selection rectangle tracks drag, width=' + selW);
  await qrPage.screenshot({ path: path.join(SHOTS, '13-region-selecting.png') });
  await qrPage.mouse.up();
  await qrPage.waitForSelector('#qr-region-select-host', { state: 'detached', timeout: 8000 });

  await page.waitForSelector('.result-card', { timeout: 10000 });
  ok((await page.locator('.rc-text').innerText()) === 'https://example.com/launch', 'region crop auto-decoded at dpr=2, delivered live');
  ok((await page.locator('.rc-meta').innerText()).includes('Screen'), 'region result source = Screen');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => chrome.storage.local.get('qr.pending').then((o) => !o['qr.pending'])), 'live receiver acks pending');
  await page.screenshot({ path: path.join(SHOTS, '14-region-result-popup.png') });
  await page.locator('.rc-close').click();

  // --- pending path: popup closes itself after requesting (real button behavior) ---
  await qrPage.bringToFront();
  await page.evaluate(() => { chrome.runtime.sendMessage({ type: 'region-scan' }); });
  await page.close();
  await qrPage.waitForSelector('#qr-region-select-host', { timeout: 8000 });
  const boxP = await qrPage.locator('#qr').boundingBox();
  await qrPage.mouse.move(boxP.x - 10, boxP.y - 10);
  await qrPage.mouse.down();
  await qrPage.mouse.move(boxP.x + boxP.width + 10, boxP.y + boxP.height + 10, { steps: 8 });
  await qrPage.mouse.up();
  await qrPage.waitForSelector('#qr-region-select-host', { state: 'detached', timeout: 8000 });
  await qrPage.waitForTimeout(900);

  // reader tab that does not consume pending/badge (scanner page has no listener)
  const reader = await context.newPage();
  await reader.goto(base + '/scanner.html');
  const badgeState = await reader.evaluate(async () => ({
    badge: await chrome.action.getBadgeText({}),
    pending: (await chrome.storage.local.get('qr.pending'))['qr.pending'],
  }));
  await reader.close();
  ok(badgeState.badge === '1', 'badge signals completed scan');
  ok(badgeState.pending && badgeState.pending.text === 'https://example.com/launch', 'pending result stored when no receiver open');

  page = await context.newPage();
  await page.goto(base + '/popup.html');
  await page.waitForSelector('.result-card', { timeout: 8000 });
  ok((await page.locator('.rc-text').innerText()) === 'https://example.com/launch', 'pending result shown on popup open');
  ok((await page.evaluate(() => chrome.action.getBadgeText({}))) === '', 'badge cleared after delivery');
  await page.locator('.rc-close').click();

  // --- float window: live region delivery ---
  await page.setViewportSize({ width: 380, height: 600 });
  const [floatPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#floatBtn').click(),
  ]);
  await floatPage.waitForLoadState();
  ok(floatPage.url().includes('popup.html?float=1'), 'float window opens detached');
  await floatPage.waitForSelector('body.floating .dropzone');
  ok(await floatPage.locator('#floatBtn').getAttribute('aria-pressed') === 'true', 'float button active in float');

  await floatPage.locator('#historyBtn').click();
  await floatPage.waitForSelector('.h-item');
  ok(await floatPage.locator('.h-item').count() >= 7, 'float shares history (incl. region scan)');
  await floatPage.locator('#historyBtn').click();

  await qrPage.bringToFront();
  await setWindowSize(qrPage, 1100, 750);
  await floatPage.locator('#regionBtn').click();
  await floatPage.waitForSelector('.alert.info');
  ok((await floatPage.locator('.alert.info').innerText()).includes('Select a region'), 'float shows sticky selection hint');
  await qrPage.waitForSelector('#qr-region-select-host', { timeout: 8000 });
  const box2 = await qrPage.locator('#qr').boundingBox();
  await qrPage.mouse.move(box2.x - 10, box2.y - 10);
  await qrPage.mouse.down();
  await qrPage.mouse.move(box2.x + box2.width + 10, box2.y + box2.height + 10, { steps: 8 });
  await qrPage.mouse.up();
  await qrPage.waitForSelector('#qr-region-select-host', { state: 'detached', timeout: 8000 });
  await floatPage.waitForSelector('.result-card', { timeout: 15000 });
  ok((await floatPage.locator('.rc-text').innerText()) === 'https://example.com/launch', 'region result delivered live to float');
  ok((await floatPage.locator('.rc-meta').innerText()).includes('Screen'), 'float result source = Screen');
  await floatPage.waitForTimeout(300);
  const acked = await floatPage.evaluate(() => chrome.storage.local.get('qr.pending').then((o) => !o['qr.pending']));
  ok(acked, 'live delivery acks and clears pending');
  await floatPage.screenshot({ path: path.join(SHOTS, '15-float-region-result.png') });
  await floatPage.locator('.rc-close').click();

  // --- Enter = full screen ---
  await qrPage.bringToFront();
  await floatPage.evaluate(() => { chrome.runtime.sendMessage({ type: 'region-scan' }); });
  await qrPage.waitForSelector('#qr-region-select-host', { timeout: 8000 });
  await qrPage.keyboard.press('Enter');
  await floatPage.waitForSelector('.result-card', { timeout: 10000 });
  ok((await floatPage.locator('.rc-text').innerText()) === 'https://example.com/launch', 'Enter captures and scans full screen');
  await floatPage.locator('.rc-close').click();

  // --- Esc cancels ---
  await qrPage.bringToFront();
  await floatPage.evaluate(() => { chrome.runtime.sendMessage({ type: 'region-scan' }); });
  await qrPage.waitForSelector('#qr-region-select-host', { timeout: 8000 });
  await qrPage.keyboard.press('Escape');
  await qrPage.waitForSelector('#qr-region-select-host', { state: 'detached', timeout: 5000 });
  await floatPage.waitForTimeout(600);
  ok(await floatPage.locator('.result-card').count() === 0, 'Esc cancels without result');
  ok(await floatPage.locator('.alert').count() === 0, 'Esc clears float selection hint');

  // --- region with no QR -> error delivery ---
  await qrPage.goto('http://localhost:8124/test/page-empty.html');
  await qrPage.bringToFront();
  await floatPage.evaluate(() => { chrome.runtime.sendMessage({ type: 'region-scan' }); });
  await qrPage.waitForSelector('#qr-region-select-host', { timeout: 8000 });
  await qrPage.mouse.move(200, 200);
  await qrPage.mouse.down();
  await qrPage.mouse.move(420, 320, { steps: 6 });
  await qrPage.mouse.up();
  await floatPage.waitForSelector('.alert', { timeout: 10000 });
  ok((await floatPage.locator('.alert').innerText()).includes('No QR code'), 'no-QR region shows error in float');
  await floatPage.close();

  // error also lands as pending when no receiver is open
  const sender = await context.newPage();
  await sender.goto(base + '/popup.html');
  await sender.waitForSelector('.dropzone');
  await qrPage.bringToFront();
  await sender.evaluate(() => { chrome.runtime.sendMessage({ type: 'region-scan' }); });
  await sender.close();
  await qrPage.waitForSelector('#qr-region-select-host', { timeout: 8000 });
  await qrPage.mouse.move(200, 200);
  await qrPage.mouse.down();
  await qrPage.mouse.move(420, 320, { steps: 6 });
  await qrPage.mouse.up();
  await qrPage.waitForSelector('#qr-region-select-host', { state: 'detached', timeout: 8000 });
  await qrPage.waitForTimeout(900);
  const reader2 = await context.newPage();
  await reader2.goto(base + '/scanner.html');
  ok((await reader2.evaluate(() => chrome.action.getBadgeText({}))) === '!', 'error badge set');
  await reader2.close();
  page = await context.newPage();
  await page.goto(base + '/popup.html');
  await page.waitForSelector('.alert', { timeout: 8000 });
  ok((await page.locator('.alert').innerText()).includes('No QR code'), 'pending error shown on popup open');
  await qrPage.close();

  // ================= CAMERA =================
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base + '/scanner.html');
  await page.waitForSelector('.result-card', { timeout: 15000 });
  ok((await page.locator('.rc-text').innerText()) === 'https://example.com/live-camera', 'live camera auto-scans QR from video feed');
  ok((await page.locator('.rc-meta').innerText()).includes('Camera'), 'camera result source = Camera');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '07-scanner-found.png') });

  await page.locator('.rc-close').click();
  await page.waitForSelector('.status-pill.scanning', { timeout: 3000 });
  ok(true, 'scan-next resumes scanning');
  await page.waitForSelector('.result-card', { timeout: 10000 });
  ok(true, 'camera re-detects after resume');
  await page.screenshot({ path: path.join(SHOTS, '08-scanner-redetect.png') });

  const hist = await page.evaluate(() => QR.store.history());
  ok(hist.filter((h) => h.text === 'https://example.com/live-camera').length === 1, 'repeated camera detection deduplicated');

  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, '09-scanner-mobile.png') });
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'no horizontal overflow at 390px');

  await page.locator('.rc-close').click().catch(() => {});
  await page.setInputFiles('#fileInput', path.join(ROOT, 'test', 'qr-text.png'));
  await page.waitForSelector('.result-card', { timeout: 8000 });
  ok((await page.locator('.rc-meta').innerText()).includes('Image'), 'scanner page image upload works');

  // --- paste + drag-drop ---
  await page.setViewportSize({ width: 380, height: 600 });
  await page.goto(base + '/popup.html');
  await page.waitForSelector('.dropzone');
  const b64 = fs.readFileSync(path.join(ROOT, 'test', 'qr-url.png')).toString('base64');
  await page.evaluate((b) => {
    const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'paste.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, b64);
  await page.waitForSelector('.result-card', { timeout: 8000 });
  ok((await page.locator('.rc-text').innerText()) === 'https://example.com/launch', 'clipboard paste scans image');
  await page.locator('.rc-close').click();

  await page.evaluate((b) => {
    const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
    document.querySelector('#dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, b64);
  await page.waitForSelector('.result-card', { timeout: 8000 });
  ok((await page.locator('.rc-text').innerText()) === 'https://example.com/launch', 'drag-and-drop scans image');
  await page.locator('.rc-close').click();

  // --- torch ---
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base + '/scanner.html');
  await page.waitForSelector('.result-card', { timeout: 15000 });
  if (await page.locator('#torchBtn').isVisible()) {
    await page.locator('#torchBtn').click();
    await page.waitForTimeout(300);
    ok(await page.evaluate(() =>
      document.querySelector('#torchBtn').classList.contains('active') || !!document.querySelector('.toast')), 'torch toggle responds');
  } else ok(true, 'torch hidden when unsupported');

  // --- float camera navigation ---
  await page.setViewportSize({ width: 380, height: 600 });
  await page.goto(base + '/popup.html');
  await page.waitForSelector('.dropzone');
  const [float2] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#floatBtn').click(),
  ]);
  await float2.waitForLoadState();
  await float2.waitForSelector('.dropzone');
  await float2.locator('#cameraBtn').click();
  await float2.waitForURL('**/scanner.html?float=1', { timeout: 5000 });
  ok(float2.url().includes('scanner.html?float=1'), 'camera stays inside the float window');
  await float2.waitForSelector('.result-card', { timeout: 15000 });
  ok((await float2.locator('.rc-text').innerText()) === 'https://example.com/live-camera', 'live camera runs inside float window');
  await float2.screenshot({ path: path.join(SHOTS, '12-float-camera.png') });
  await float2.locator('.rc-close').click();
  await float2.locator('#backBtn').click();
  await float2.waitForURL('**/popup.html?float=1', { timeout: 5000 });
  ok(true, 'back button returns to float scanner');
  await float2.close();

  // --- no-camera error state ---
  const ctx2 = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'qr-nocam-')), {
    executablePath: CHROME,
    headless: true,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--no-first-run', '--no-default-browser-check'],
  });
  const p2 = await ctx2.newPage();
  await p2.goto('chrome://extensions/');
  const id2 = await p2.evaluate(() => {
    const item = document.querySelector('extensions-manager').shadowRoot
      .querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item');
    return item ? item.id : null;
  });
  await p2.goto(`chrome-extension://${id2}/scanner.html`);
  await p2.waitForSelector('.cam-error:not([hidden])', { timeout: 10000 });
  ok(true, 'no-camera shows graceful error state');
  await p2.screenshot({ path: path.join(SHOTS, '10-scanner-no-camera.png') });
  await p2.setInputFiles('#fileInput', path.join(ROOT, 'test', 'qr-url.png'));
  await p2.waitForSelector('.result-card', { timeout: 8000 });
  ok((await p2.locator('.rc-text').innerText()) === 'https://example.com/launch', 'image upload works from camera error state');
  await ctx2.close();

  // --- console errors ---
  const realErrors = consoleErrors.filter((e) => !e.includes('example.com') && !e.includes('ERR_') && !e.includes('Failed to load resource'));
  ok(realErrors.length === 0, 'zero console/page errors' + (realErrors.length ? ' :: ' + realErrors.join(' | ') : ''));

  await context.close();
  server.close();
  console.log('\n' + (failures ? failures + ' FAILURES' : 'ALL TESTS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });