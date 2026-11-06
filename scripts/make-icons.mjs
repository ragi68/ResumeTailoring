// Generates public/icon/{16,32,48,128}.png: a blue rounded tile with a white page and text lines.
// Pure Node (zlib) PNG encoder, no image dependencies.  node scripts/make-icons.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const BLUE = [36, 86, 214, 255];
const WHITE = [255, 255, 255, 255];
const LINE = [150, 172, 230, 255];
const CLEAR = [0, 0, 0, 0];

function pixel(x, y, s) {
  const u = x / s;
  const v = y / s;
  // rounded tile
  const r = 0.2;
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return CLEAR;
  // page with folded corner
  const inPage = u > 0.27 && u < 0.73 && v > 0.18 && v < 0.82 && !(u > 0.6 && v < 0.31 && u - 0.6 > v - 0.18);
  if (!inPage) return BLUE;
  const lineRows = [0.42, 0.53, 0.64, 0.73];
  const thick = Math.max(0.035, 1.2 / s);
  for (const [i, row] of lineRows.entries()) {
    const end = i === lineRows.length - 1 ? 0.55 : 0.65;
    if (Math.abs(v - row) < thick && u > 0.35 && u < end) return LINE;
  }
  return WHITE;
}

fs.mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 128]) fs.writeFileSync(`public/icon/${size}.png`, png(size, pixel));
console.log('wrote public/icon/{16,32,48,128}.png');
