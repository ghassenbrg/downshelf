#!/usr/bin/env node
/**
 * Renders the Downshelf icon (an arrow landing on a shelf) to PNG at every
 * size Chrome needs. No dependencies: shapes are drawn with signed distance
 * functions, anti-aliased by supersampling, and encoded with node:zlib.
 *
 *   npm run icons
 *
 * The same artwork lives as SVG in extension/shared/icons.js (logoSvg) and
 * docs/logo.svg — keep them in sync if you change it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outDir = fileURLToPath(new URL('../extension/icons/', import.meta.url));

// Artwork in a 32×32 design space.
const TOP = [0x7c, 0x7c, 0xf0];
const BOTTOM = [0x4b, 0x44, 0xc9];
const strokes = (small) => [
  { a: [16, 6.5], b: [16, 17.5], w: small ? 3.4 : 2.6 },
  { a: [11.25, 13], b: [16, 17.75], w: small ? 3.4 : 2.6 },
  { a: [20.75, 13], b: [16, 17.75], w: small ? 3.4 : 2.6 },
  { a: [7.5, 23.5], b: [24.5, 23.5], w: small ? 3.4 : 2.6 },
  ...(small
    ? []
    : [
        { a: [10.5, 23.5], b: [10.5, 26], w: 2.2 },
        { a: [21.5, 23.5], b: [21.5, 26], w: 2.2 },
      ]),
];

function roundedRectSdf(x, y, size, radius) {
  const half = size / 2;
  const qx = Math.abs(x - half) - (half - radius);
  const qy = Math.abs(y - half) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function render(size, padding) {
  const art = size - padding * 2;
  const scale = art / 32;
  const lines = strokes(size <= 16);
  const SS = 5; // samples per axis
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS - padding) / scale;
          const v = (y + (sy + 0.5) / SS - padding) / scale;
          if (roundedRectSdf(u, v, 32, 8) > 0) continue;
          const onStroke = lines.some((l) => segmentDistance(u, v, l.a, l.b) <= l.w / 2);
          const t = Math.max(0, Math.min(1, (u + v) / 64));
          const color = onStroke ? [255, 255, 255] : TOP.map((c, i) => c + (BOTTOM[i] - c) * t);
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
        pixels[i + 3] = Math.round((a / (SS * SS)) * 255);
      }
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // no filter
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Chrome Web Store guidance: the 128px icon has ~16px of transparent padding.
const SIZES = { 16: 0, 32: 1, 48: 3, 128: 14 };

mkdirSync(outDir, { recursive: true });
for (const [size, padding] of Object.entries(SIZES).map(([s, p]) => [Number(s), p])) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, render(size, padding)));
  console.log(`wrote ${file}`);
}
