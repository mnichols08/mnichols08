#!/usr/bin/env node
// Re-hues the README banners to today's palette.
//
// The banners are transparent PNGs: a yellow glow plus neutral (white / black) text.
// Only saturated pixels are rotated to the palette's hue, so the lettering stays put
// and the glow, circuit lines and fringes shift together. On Signature days the
// originals are copied untouched, so your yellow is exact.
//
//   node scripts/recolor-banner.mjs assets/banner-dark.png out/banner-dark.png
//   node scripts/recolor-banner.mjs assets/banner-light.png out/banner-light.png --date 2026-12-25
//
// Pure Node (zlib only): no ImageMagick or npm packages needed on the runner.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { paletteFor, hlsFromHex, hexFromHls, today, isTwoTone, secondSatScale, accentSatScale } from './palette.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Hue of the banners' yellow, measured from the palette's own signature accent.
const SOURCE_HUE = hlsFromHex('#e3de13')[0];

// CRC-32 written out so this runs on any Node version (zlib.crc32 needs 22.2+).
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decode(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file.');
  let offset = 8;
  let header;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header || header.depth !== 8 || header.color !== 6 || header.interlace !== 0) {
    throw new Error('Only 8-bit RGBA, non-interlaced PNGs are supported (the banners are).');
  }
  const { width, height } = header;
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[x - 4] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= 4 ? prev[x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = (line[x] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, tail]);
}

function encode({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Recolours one saturated pixel to `hue`, scaling its saturation (so a white or silver
// second colour turns the glow silver instead of an arbitrary hue).
function recolor(h, l, s, hue, satScale) {
  return hexFromHls(hue, l, Math.min(1, s * satScale)).slice(1).match(/../g).map((v) => parseInt(v, 16));
}

// Where the accent stays on a two-tone day: the round emblem and the "08". Everything
// else that glows (the circuit traces, the dots between words) takes the second colour.
// Fractions of the banner's size, feathered so the glow hands over without a seam.
function accentWeight(x, y, width, height) {
  const u = x / width;
  const v = y / height;
  const emblem = Math.hypot((u - 0.5) / 0.092, (v - 0.335) / 0.235);
  const inEmblem = 1 - smooth(0.92, 1.12, emblem);
  const dx = Math.max(0.626 - u, u - 0.764, 0);
  const dy = Math.max(0.5 - v, v - 0.71, 0);
  const inEight = 1 - smooth(0, 0.012, Math.hypot(dx, dy * (height / width)));
  return Math.max(inEmblem, inEight);
}
const smooth = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

export function rehue(image, targetHue, second = null, mainSatScale = 1) {
  const shift = targetHue - SOURCE_HUE;
  const { width, height, pixels } = image;
  const cache = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    let pair = cache.get(key);
    if (!pair) {
      const hex = `#${key.toString(16).padStart(6, '0')}`;
      const [h, l, s] = hlsFromHex(hex);
      // Neutrals (white text, black outlines, grey fringes) keep their colour exactly.
      if (s < 0.12) pair = [[pixels[i], pixels[i + 1], pixels[i + 2]], null];
      else pair = [
        recolor(h, l, s, ((h + shift) % 1 + 1) % 1, mainSatScale),
        second ? recolor(h, l, s, second.hue, second.satScale) : null,
      ];
      cache.set(key, pair);
    }
    const [main, alt] = pair;
    if (!alt) { [pixels[i], pixels[i + 1], pixels[i + 2]] = main; continue; }
    const p = i / 4;
    const w = accentWeight(p % width, Math.floor(p / width), width, height);
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(main[c] * w + alt[c] * (1 - w));
  }
  return image;
}

const isMain = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/recolor-banner.mjs');
if (isMain) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { date: { type: 'string' } } });
  const [input, output] = positionals;
  if (!input || !output) throw new Error('Usage: recolor-banner.mjs INPUT.png OUTPUT.png [--date YYYY-MM-DD]');
  const date = values.date ?? today();
  const palette = paletteFor(date);
  mkdirSync(dirname(output), { recursive: true });
  if (palette.key === 'signature') {
    copyFileSync(input, output);
    console.error(`${output}: ${palette.label} (${date}), original kept`);
  } else {
    const hue = hlsFromHex(palette.dark.accent)[0];
    const second = isTwoTone(palette) ? { hue: hlsFromHex(palette.dark.star)[0], satScale: secondSatScale(palette) } : null;
    writeFileSync(output, encode(rehue(decode(readFileSync(input)), hue, second, accentSatScale(palette))));
    console.error(`${output}: re-hued to ${palette.label} (${date})`);
  }
}
