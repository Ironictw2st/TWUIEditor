// Generates a 1024x1024 RGBA PNG source icon (no native deps) for `tauri icon`.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 1024;

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Bold, high-contrast icon: solid gold rounded square on transparent, with a
// dark "X" (for TWUI / XML) so it's clearly visible even at 32px.
const GOLD = [201, 162, 39];
const DARK = [21, 22, 28];
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));

const inset = 70;
const radius = 150;
function inRoundedSquare(x, y) {
  const lo = inset;
  const hi = SIZE - inset;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  // round the corners
  const corners = [
    [lo + radius, lo + radius],
    [hi - radius, lo + radius],
    [lo + radius, hi - radius],
    [hi - radius, hi - radius],
  ];
  const nearCornerOutside =
    (x < lo + radius && y < lo + radius && dist(x, y, corners[0]) > radius) ||
    (x > hi - radius && y < lo + radius && dist(x, y, corners[1]) > radius) ||
    (x < lo + radius && y > hi - radius && dist(x, y, corners[2]) > radius) ||
    (x > hi - radius && y > hi - radius && dist(x, y, corners[3]) > radius);
  return !nearCornerOutside;
}
function dist(x, y, c) {
  return Math.hypot(x - c[0], y - c[1]);
}

for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter type 0
  for (let x = 0; x < SIZE; x++) {
    const i = y * (SIZE * 4 + 1) + 1 + x * 4;
    const cx = x - SIZE / 2;
    const cy = y - SIZE / 2;
    let col = null;
    if (inRoundedSquare(x, y)) {
      col = GOLD;
      // bold dark "X" through the middle
      const onX = Math.abs(Math.abs(cx) - Math.abs(cy)) < 55 && Math.max(Math.abs(cx), Math.abs(cy)) < SIZE / 2 - inset - 60;
      if (onX) col = DARK;
    }
    if (col) {
      raw[i] = col[0];
      raw[i + 1] = col[1];
      raw[i + 2] = col[2];
      raw[i + 3] = 255;
    } else {
      raw[i] = 0;
      raw[i + 1] = 0;
      raw[i + 2] = 0;
      raw[i + 3] = 0; // transparent outside the square
    }
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "..", "src-tauri", "icon-source.png");
fs.writeFileSync(out, png);
console.log("wrote", out, png.length, "bytes");
