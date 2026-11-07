import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const qrcode = require(path.join(root, 'test', 'qrcode-lib.js'));

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function qrPNG(text, size, { invert = false, fg = [10, 14, 26], bg = [255, 255, 255] } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4;
  const total = count + margin * 2;
  const cell = size / total;
  const rgba = Buffer.alloc(size * size * 4);
  const dark = invert ? bg : fg;
  const light = invert ? fg : bg;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / cell) - margin;
      const my = Math.floor(y / cell) - margin;
      const on = mx >= 0 && my >= 0 && mx < count && my < count && qr.isDark(my, mx);
      const c = on ? dark : light;
      const i = (y * size + x) * 4;
      rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, size, rgba);
}

const fixtures = [
  ['qr-url.png', 'https://example.com/launch', 512, {}],
  ['qr-text.png', 'Hello from QR Scanner - premium build', 512, {}],
  ['qr-wifi.png', 'WIFI:T:WPA;S:StudioNet;P:supersecret123;;', 512, {}],
  ['qr-inverted.png', 'https://example.com/inverted', 512, { invert: true }],
  ['qr-small.png', 'https://example.com/small', 132, {}],
  ['qr-email.png', 'mailto:hello@example.com', 512, {}],
];
for (const [name, text, size, opts] of fixtures) {
  fs.writeFileSync(path.join(root, 'test', name), qrPNG(text, size, opts));
  console.log(name, '<-', text);
}

// gradient image with no QR
const size = 400;
const rgba = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    rgba[i] = (x / size) * 255;
    rgba[i + 1] = (y / size) * 255;
    rgba[i + 2] = 160;
    rgba[i + 3] = 255;
  }
}
fs.writeFileSync(path.join(root, 'test', 'no-qr.png'), encodePNG(size, size, rgba));
console.log('no-qr.png <- gradient');