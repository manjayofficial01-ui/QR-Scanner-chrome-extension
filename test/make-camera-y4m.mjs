import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const qrcode = require(path.join(root, 'test', 'qrcode-lib.js'));

const W = 640, H = 480, FRAMES = 45;
const qr = qrcode(0, 'M');
qr.addData('https://example.com/live-camera');
qr.make();
const count = qr.getModuleCount();
const cell = 11;
const qsize = (count + 8) * cell;
const ox = Math.floor((W - qsize) / 2);
const oy = Math.floor((H - qsize) / 2);

const yPlane = Buffer.alloc(W * H, 255);
for (let my = 0; my < count + 8; my++) {
  for (let mx = 0; mx < count + 8; mx++) {
    const qx = mx - 4, qy = my - 4;
    const dark = qx >= 0 && qy >= 0 && qx < count && qy < count && qr.isDark(qy, qx);
    if (!dark) continue;
    for (let dy = 0; dy < cell; dy++) {
      const row = oy + my * cell + dy;
      yPlane.fill(0, row * W + ox + mx * cell, row * W + ox + mx * cell + cell);
    }
  }
}
const uPlane = Buffer.alloc((W / 2) * (H / 2), 128);
const vPlane = Buffer.alloc((W / 2) * (H / 2), 128);
const frame = Buffer.concat([Buffer.from('FRAME\n'), yPlane, uPlane, vPlane]);
const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`);
const out = Buffer.concat([header, ...Array(FRAMES).fill(frame)]);
fs.writeFileSync(path.join(root, 'test', 'camera-qr.y4m'), out);
console.log('camera-qr.y4m written:', out.length, 'bytes,', count, 'modules');