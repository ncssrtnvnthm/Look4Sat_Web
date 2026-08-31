// Generates PWA PNG icons (no external deps — pure Node + zlib).
// Run: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const off = y * (size * 4 + 1) + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Dark background with a cyan "satellite" dot and orbit ring (matches the app theme).
// `maskable` fills the whole canvas so the icon survives platform masks.
function makeDraw(maskable) {
  return (x, y, size) => {
    const bg = maskable ? [0x12, 0x12, 0x12, 255] : [0x12, 0x12, 0x12, 0];
    const cx = size / 2;
    const cy = size / 2;
    const r = Math.hypot(x - cx + 0.5, y - cy + 0.5);
    const scale = maskable ? 0.72 : 1; // keep content inside the safe zone
    const ringR = size * 0.42 * scale;
    const dotR = size * 0.15 * scale;
    if (Math.abs(r - ringR) < size * 0.05 * scale) {
      return [0x4f, 0xc3, 0xf7, 200];
    }
    if (r < dotR) {
      return [0x4f, 0xc3, 0xf7, 255];
    }
    if (r < dotR + size * 0.12 * scale) {
      const t = (r - dotR) / (size * 0.12 * scale);
      return [0x4f, 0xc3, 0xf7, Math.round(255 * (1 - t) * 0.35)];
    }
    return bg;
  };
}

mkdirSync(OUT_DIR, { recursive: true });

const outputs = [
  ['icon-192.png', 192, makeDraw(false)],
  ['icon-512.png', 512, makeDraw(false)],
  ['maskable-512.png', 512, makeDraw(true)],
];

for (const [name, size, draw] of outputs) {
  const png = makePng(size, draw);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`✓ ${name} (${size}x${size}, ${png.length} bytes)`);
}
