/**
 * Draw the ConceptAI logo (the same as src/app/icon.svg) into a Windows .ico
 * for the desktop shortcut, with no image libraries: each size is rasterised
 * with 4x4 supersampling and stored as a PNG inside the .ico.
 *
 *   node scripts/windows/make-icon.mjs   → scripts/windows/conceptai.ico
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// The logo's stroke in its 24-unit space (from the SVG path, expanded to absolute cubics).
const CURVES = [
  [[4, 17], [6.5, 11], [9.5, 8], [12, 8]],
  [[12, 8], [14.5, 8], [16, 10], [16, 12]],
  [[16, 12], [16, 14], [14.5, 15.5], [12.5, 15.5]],
  [[12.5, 15.5], [10.5, 15.5], [9, 14], [9, 12]],
];
const STOPS = [[0, [0xa5, 0x97, 0xff]], [0.5, [0x7c, 0x6c, 0xff]], [1, [0x2d, 0xd4, 0xbf]]];

const cubic = ([a, b, c, d], t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k]);
};
const POLY = CURVES.flatMap((c, i) => Array.from({ length: 48 + (i === CURVES.length - 1 ? 1 : 0) }, (_, j) => cubic(c, j / 48)));

function gradient(t) {
  const i = t < 0.5 ? 0 : 1;
  const [t0, c0] = STOPS[i];
  const [t1, c1] = STOPS[i + 1];
  const f = (t - t0) / (t1 - t0);
  return c0.map((v, k) => v + (c1[k] - v) * f);
}

function distToPolyline(x, y) {
  let best = Infinity;
  for (let i = 0; i < POLY.length - 1; i++) {
    const [ax, ay] = POLY[i];
    const [bx, by] = POLY[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

/** RGBA pixels of the logo at size×size. */
function render(size) {
  const px = new Uint8Array(size * size * 4);
  const S = 4;
  const unit = size / 64; // the 64-unit icon box
  const radius = 16 * unit;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S;
          const fy = y + (sy + 0.5) / S;
          // Rounded square.
          const cx = Math.min(Math.max(fx, radius), size - radius);
          const cy = Math.min(Math.max(fy, radius), size - radius);
          if (Math.hypot(fx - cx, fy - cy) > radius) continue;
          // Logo space: translate(12.8) scale(1.6) inside the 64-unit box.
          const lx = (fx / unit - 12.8) / 1.6;
          const ly = (fy / unit - 12.8) / 1.6;
          const white = distToPolyline(lx, ly) <= 1.1 || Math.hypot(lx - 18.5, ly - 6) <= 1.8;
          const [cr, cg, cb] = white ? [255, 255, 255] : gradient((fx + fy) / (2 * size));
          r += cr;
          g += cg;
          b += cb;
          a += 1;
        }
      }
      const i = (y * size + x) * 4;
      if (a) [px[i], px[i + 1], px[i + 2]] = [r / a, g / a, b / a];
      px[i + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  return px;
}

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
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const sizes = [256, 64, 48, 32, 16];
const images = sizes.map((s) => png(s, render(s)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header[e] = s === 256 ? 0 : s; // 0 means 256
  header[e + 1] = s === 256 ? 0 : s;
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(images[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "conceptai.ico");
writeFileSync(out, Buffer.concat([header, ...images]));
console.log(`wrote ${out}`);
