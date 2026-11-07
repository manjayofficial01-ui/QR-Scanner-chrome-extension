import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const hex = (s) => [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];

function renderIcon(size) {
  const SS = 4;
  const W = size * SS;
  const img = Buffer.alloc(W * W * 4);
  const bgA = hex('1b2340'), bgB = hex('080b16');
  const cyan = hex('22d3ee'), cyanCore = hex('67e8f9'), violet = hex('a78bfa');
  const radius = W * 0.24;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = Math.max(radius - x, x - (W - 1 - radius), 0);
      const dy = Math.max(radius - y, y - (W - 1 - radius), 0);
      const dist = Math.hypot(dx, dy);
      const alpha = Math.max(0, Math.min(1, radius - dist + 0.5));
      if (alpha <= 0) continue;
      const t = (x + y) / (2 * W);
      const i = (y * W + x) * 4;
      img[i] = lerp(bgA[0], bgB[0], t);
      img[i + 1] = lerp(bgA[1], bgB[1], t);
      img[i + 2] = lerp(bgA[2], bgB[2], t);
      img[i + 3] = alpha * 255;
    }
  }

  const pad = W * 0.14;
  const unit = (W - pad * 2) / 21;
  const cell = (cx, cy, cw, ch, color, aa = true) => {
    const x0 = pad + cx * unit, y0 = pad + cy * unit;
    const x1 = pad + (cx + cw) * unit, y1 = pad + (cy + ch) * unit;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        if (x < 0 || y < 0 || x >= W || y >= W) continue;
        let cov = 1;
        if (aa) {
          cov = Math.max(0, Math.min(x + 1, x1) - Math.max(x, x0)) *
                Math.max(0, Math.min(y + 1, y1) - Math.max(y, y0));
        }
        if (cov <= 0) continue;
        const i = (y * W + x) * 4;
        const a = cov * (color[3] === undefined ? 1 : color[3]);
        img[i] = lerp(img[i], color[0], a);
        img[i + 1] = lerp(img[i + 1], color[1], a);
        img[i + 2] = lerp(img[i + 2], color[2], a);
        img[i + 3] = Math.max(img[i + 3], a * 255);
      }
    }
  };

  const finder = (fx, fy) => {
    cell(fx, fy, 7, 7, cyan);
    cell(fx + 1, fy + 1, 5, 5, bgB);
    cell(fx + 2, fy + 2, 3, 3, cyanCore);
  };
  finder(0, 0);
  finder(14, 0);
  finder(0, 14);

  const dataCells = [
    [9, 2], [11, 2], [9, 4], [12, 5], [10, 6], [2, 9], [4, 10], [6, 9], [8, 11],
    [10, 9], [12, 10], [14, 9], [16, 10], [18, 9], [20, 11], [9, 13], [11, 14],
    [13, 13], [15, 15], [17, 14], [19, 16], [9, 16], [10, 18], [12, 19], [14, 18],
    [16, 20], [18, 19], [20, 18], [9, 20], [6, 12], [3, 12],
  ];
  dataCells.forEach(([x, y], i) => cell(x, y, 1, 1, i % 4 === 0 ? violet : cyan));
  cell(14, 14, 5, 5, violet);
  cell(15, 15, 3, 3, bgB);
  cell(16, 16, 1, 1, violet);

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * W + x * SS + sx) * 4;
          const al = img[i + 3] / 255;
          r += img[i] * al; g += img[i + 1] * al; b += img[i + 2] * al; a += al;
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a;
      }
      out[o + 3] = (a / n) * 255;
    }
  }
  return encodePNG(size, size, out);
}

for (const s of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(root, 'icons', `icon${s}.png`), renderIcon(s));
  console.log(`icon${s}.png written`);
}