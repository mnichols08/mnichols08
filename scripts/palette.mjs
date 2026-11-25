#!/usr/bin/env node
// One palette per day (US Eastern), shared by every image on the profile.
//
// daily-design.mjs (constellation), the metrics workflow and the snake workflow all
// ask this module for the same date, so they always agree without talking to each
// other. Colours for the other images are derived from the day's palette.
//
//   node scripts/palette.mjs show [--date YYYY-MM-DD]
//   node scripts/palette.mjs github-output          # appends step outputs for workflows
//   node scripts/palette.mjs recolor DIR            # recolour the metrics SVGs in DIR

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

// ---- deterministic randomness (shared with daily-design.mjs) ---------------------

export function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

export function rng(seed) {
  let s = hash(seed) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weighted(random, table) {
  const total = table.reduce((sum, row) => sum + row[row.length - 1], 0);
  let roll = random() * total;
  for (const row of table) {
    roll -= row[row.length - 1];
    if (roll < 0) return row;
  }
  return table[0];
}

// ---- palettes ------------------------------------------------------------------
// "signature" is the original charcoal / cream / yellow look and is drawn most
// often, so the profile still feels like yours. The rest are moods.

export const palettes = {
  signature: {
    label: 'Signature',
    weight: 20,
    light: { background: '#fafaf3', foreground: '#202516', accent: '#595600', line: '#838d66', star: '#8b8500' },
    dark: { background: '#111111', foreground: '#f3f3f4', accent: '#e3de13', line: '#555a38', star: '#e3de13' },
  },
  ember: {
    label: 'Ember',
    weight: 2,
    light: { background: '#fbf5f0', foreground: '#2a1a12', accent: '#a8420f', line: '#a88470', star: '#b8501a' },
    dark: { background: '#14100e', foreground: '#f4ece6', accent: '#ff8a4c', line: '#6b4a3a', star: '#ff8a4c' },
  },
  aurora: {
    label: 'Aurora',
    weight: 2,
    light: { background: '#f2faf6', foreground: '#12261e', accent: '#0c7a54', line: '#6fa38e', star: '#0f8f62' },
    dark: { background: '#0e1412', foreground: '#eaf5f0', accent: '#4ee3a8', line: '#35604f', star: '#4ee3a8' },
  },
  nebula: {
    label: 'Nebula',
    weight: 2,
    light: { background: '#f7f4fc', foreground: '#1f1830', accent: '#6a3fd0', line: '#9a8cc0', star: '#7a4fe0' },
    dark: { background: '#12101a', foreground: '#f0ecf8', accent: '#b58cff', line: '#4d4470', star: '#b58cff' },
  },
  glacier: {
    label: 'Glacier',
    weight: 2,
    light: { background: '#f2f8fc', foreground: '#101f2c', accent: '#0a6ea6', line: '#7ea3bf', star: '#1a82bd' },
    dark: { background: '#0d1218', foreground: '#e8f0f8', accent: '#5cc8ff', line: '#34506a', star: '#5cc8ff' },
  },
  supernova: {
    label: 'Supernova',
    weight: 1,
    light: { background: '#fcf4f6', foreground: '#2b1219', accent: '#b5214f', line: '#b5808f', star: '#cc2c5f' },
    dark: { background: '#170f13', foreground: '#f8ecf0', accent: '#ff6b9a', line: '#6b3a4c', star: '#ff6b9a' },
  },

  // ---- holidays: weight 0, so they are never drawn; holidayFor() picks them by date.
  // `accent` carries the main colour and `star` the second one (constellation stars,
  // light-mode contribution ramp), so two-colour holidays show both.
  frost: {
    label: "New Year's Frost", weight: 0,
    light: { background: '#f3f8fc', foreground: '#0f1e2e', accent: '#1d5fa0', line: '#8aa9c4', star: '#2f7fc9' },
    dark: { background: '#0b1220', foreground: '#eaf3fb', accent: '#9fd8ff', line: '#36506e', star: '#e8f6ff' },
  },
  valentine: {
    label: "Valentine's Rose", weight: 0,
    light: { background: '#fdf3f5', foreground: '#2e1018', accent: '#a3324f', line: '#c48a98', star: '#bf4a66' },
    dark: { background: '#170c10', foreground: '#fbeef1', accent: '#e46f8c', line: '#6e2e40', star: '#f2b8c6' },
  },
  shamrock: {
    label: 'Shamrock', weight: 0,
    light: { background: '#f2faf2', foreground: '#10240f', accent: '#157a2c', line: '#7fae84', star: '#1f9a3a' },
    dark: { background: '#0b140d', foreground: '#eaf6ea', accent: '#3ddc5c', line: '#2e5a35', star: '#f5c542' },
  },
  spring: {
    label: 'Easter Spring', weight: 0,
    light: { background: '#fbf8fd', foreground: '#2a2238', accent: '#7b4bb7', line: '#b8a9d0', star: '#d0567f' },
    dark: { background: '#14121a', foreground: '#f6f2fb', accent: '#c6a8ff', line: '#4c4466', star: '#9fe6c0' },
  },
  fiesta: {
    label: 'Cinco de Mayo Fiesta', weight: 0,
    light: { background: '#f7faf6', foreground: '#14201a', accent: '#00704a', line: '#9fb5a6', star: '#a8323a' },
    dark: { background: '#0c120f', foreground: '#f4f7f5', accent: '#3f9f5f', line: '#2f5442', star: '#cf5a55' },
  },
  remembrance: {
    label: 'Memorial Day Remembrance', weight: 0,
    light: { background: '#f6f5f3', foreground: '#1a1d24', accent: '#86302c', line: '#9a9ea8', star: '#99403b' },
    dark: { background: '#0d0f14', foreground: '#eceef2', accent: '#c95a52', line: '#3b4150', star: '#c9ced8' },
  },
  jubilee: {
    label: 'Juneteenth Jubilee', weight: 0,
    light: { background: '#fbf7ef', foreground: '#1d150c', accent: '#86372b', line: '#9fae8a', star: '#2a7040' },
    dark: { background: '#0f0c08', foreground: '#f6efe3', accent: '#e8b04a', line: '#2f6b3f', star: '#c95a4c' },
  },
  liberty: {
    label: 'Independence Day', weight: 0,
    light: { background: '#f7f8fc', foreground: '#0e1733', accent: '#a03340', line: '#8f9cc0', star: '#2a468f' },
    dark: { background: '#0a0f22', foreground: '#f4f6fb', accent: '#d95b66', line: '#2e3d73', star: '#5b82e0' },
  },
  labor: {
    label: 'Labor Day', weight: 0,
    light: { background: '#f4f6f8', foreground: '#15202b', accent: '#1f4e79', line: '#8a9bb0', star: '#c46a0a' },
    dark: { background: '#0d1219', foreground: '#eef2f6', accent: '#ffa53a', line: '#34465c', star: '#6fa8dc' },
  },
  birthday: {
    label: 'Birthday Confetti', weight: 0,
    light: { background: '#fdf9f2', foreground: '#24180a', accent: '#a1067d', line: '#c4a77a', star: '#c48a00' },
    dark: { background: '#120d16', foreground: '#f8f1fb', accent: '#ffcc33', line: '#5a3d66', star: '#ff5fd2' },
  },
  voyage: {
    label: 'Columbus Day Voyage', weight: 0,
    light: { background: '#f3f7f8', foreground: '#0f1f28', accent: '#0e5a73', line: '#86a4ad', star: '#9a6b1f' },
    dark: { background: '#08141b', foreground: '#e8f2f5', accent: '#d9a441', line: '#24485a', star: '#5fc4d9' },
  },
  halloween: {
    label: 'Halloween', weight: 0,
    light: { background: '#fbf6ef', foreground: '#1c1222', accent: '#c24d00', line: '#a88fa8', star: '#6b2fa3' },
    dark: { background: '#0d0a10', foreground: '#f4eef6', accent: '#ff7a1a', line: '#4a3557', star: '#a463ff' },
  },
  muertos: {
    label: 'Día de los Muertos', weight: 0,
    light: { background: '#fdf7ee', foreground: '#261326', accent: '#b8137a', line: '#c6a38a', star: '#d97706' },
    dark: { background: '#130b14', foreground: '#fbeff6', accent: '#ffa41b', line: '#5c2d5a', star: '#ff4fb8' },
  },
  veterans: {
    label: "Veterans Day", weight: 0,
    light: { background: '#f6f6ef', foreground: '#1c1f14', accent: '#4b5a24', line: '#a3a68a', star: '#9a7a14' },
    dark: { background: '#0f110b', foreground: '#f0f1e8', accent: '#d4af37', line: '#474d32', star: '#9fb06a' },
  },
  arcade: {
    label: 'Birthday Arcade', weight: 0,
    light: { background: '#f3f7fd', foreground: '#0e1a2e', accent: '#0b5fd6', line: '#94a8c8', star: '#4f9a00' },
    dark: { background: '#0b0f1c', foreground: '#eef3ff', accent: '#38bdf8', line: '#2c3d66', star: '#a3e635' },
  },
  harvest: {
    label: 'Thanksgiving Harvest', weight: 0,
    light: { background: '#fbf5ec', foreground: '#2a1a0c', accent: '#9a3f0a', line: '#bf9b72', star: '#b5650d' },
    dark: { background: '#15100a', foreground: '#f7ecdf', accent: '#f08a24', line: '#6a4a2a', star: '#e6b450' },
  },
  devotion: {
    // Candlelit, not Valentine's: pale champagne gold over deep amethyst, no pinks.
    label: 'Champagne Evening', weight: 0, secret: 'JNT',
    light: { background: '#faf7f2', foreground: '#21162b', accent: '#5e3591', line: '#bfb1c9', star: '#a27a35' },
    dark: { background: '#120d18', foreground: '#f4eef7', accent: '#eed3a1', line: '#43345a', star: '#9a6ae0' },
  },
  hanukkah: {
    label: 'Hanukkah', weight: 0,
    light: { background: '#f4f7fd', foreground: '#0c1a3a', accent: '#1b47b5', line: '#9aaad0', star: '#2f62d9' },
    dark: { background: '#091228', foreground: '#eef3ff', accent: '#6ea8ff', line: '#2c3f72', star: '#f2f6ff' },
  },
  christmas: {
    label: 'Christmas', weight: 0,
    light: { background: '#f9f6f0', foreground: '#1a1a12', accent: '#a2302f', line: '#8fa58e', star: '#22693d' },
    dark: { background: '#0b120d', foreground: '#f4f1ea', accent: '#d65450', line: '#2d5a3a', star: '#4bb072' },
  },
  midnight: {
    label: "New Year's Eve", weight: 0,
    light: { background: '#faf8f2', foreground: '#1a1810', accent: '#8a6d00', line: '#b3ab90', star: '#a8860b' },
    dark: { background: '#0a0a0c', foreground: '#f5f3ec', accent: '#ffd447', line: '#4a4636', star: '#e6e6f0' },
  },
};

// ---- the profile's day ---------------------------------------------------------------
// Every generator's default date: the calendar day in US Eastern time, so a new
// palette (and every holiday) starts at local midnight, not 7pm the evening before.

export function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// ---- holiday calendar -------------------------------------------------------------
// Earlier rules win when two land on the same day: single days (e.g. Dec 6, Christmas)
// beat multi-day windows such as Hanukkah, which carries on either side of them.

const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
const span = (y, m, d, days) => Array.from({ length: days }, (_, i) => iso(y, m, d + i));

// nth (1-based) given weekday of a month; n = -1 for the last one.
function nthWeekday(y, m, day, n) {
  if (n > 0) return 1 + ((day - weekday(y, m, 1) + 7) % 7) + (n - 1) * 7;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - ((weekday(y, m, last) - day + 7) % 7);
}

// Gregorian Easter Sunday (anonymous / Meeus algorithm) as [month, day].
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
}

// First day of Hanukkah (25 Kislev; candles are lit the evening before).
const hebrew = new Intl.DateTimeFormat('en-u-ca-hebrew', { month: 'long', day: 'numeric', timeZone: 'UTC' });
function hanukkahStart(y) {
  for (let d = 0; d < 50; d++) {
    const date = new Date(Date.UTC(y, 10, 20 + d));
    const parts = Object.fromEntries(hebrew.formatToParts(date).map((p) => [p.type, p.value]));
    if (parts.month === 'Kislev' && parts.day === '25') return [date.getUTCMonth() + 1, date.getUTCDate()];
  }
  return null;
}

// St. Patrick's Day joined to its weekend, with no gap days: the weekend before when the
// 17th is Mon–Wed, the one after when it is Thu–Fri, Fri–Sun when it falls on a weekend.
function stPatricks(y) {
  const wd = weekday(y, 3, 17);
  if (wd === 0 || wd === 6) return span(y, 3, wd === 6 ? 16 : 15, 3);
  if (wd <= 3) return span(y, 3, 17 - wd - 1, wd + 2); // Sat before → 17th
  return span(y, 3, 17, 7 - wd + 1); // 17th → Sun after
}

const calendars = new Map();
function holidayCalendar(y) {
  if (calendars.has(y)) return calendars.get(y);
  const hanukkah = hanukkahStart(y);
  const rules = [
    // Single days first.
    ['frost', [iso(y, 1, 1)]],
    ['valentine', [iso(y, 2, 14)]],
    ['remembrance', [iso(y, 5, nthWeekday(y, 5, 1, -1))]],
    ['jubilee', [iso(y, 6, 19)]],
    ['liberty', [iso(y, 7, 4)]],
    ['birthday', [iso(y, 10, 4)]],
    ['arcade', [iso(y, 10, 12)]],
    // When Columbus Day lands on Oct 12 (as in 2026) the birthday keeps the day and the
    // voyage sails the Sunday before, still the holiday weekend.
    ['voyage', [iso(y, 10, nthWeekday(y, 10, 1, 2) === 12 ? 11 : nthWeekday(y, 10, 1, 2))]],
    ['halloween', [iso(y, 10, 31)]],
    ['veterans', [iso(y, 11, 11)]],
    ['harvest', [iso(y, 11, nthWeekday(y, 11, 4, 4))]],
    ['devotion', [iso(y, 12, 6)]],
    ['christmas', [iso(y, 12, 25)]],
    ['midnight', [iso(y, 12, 31)]],
    // Then the multi-day windows.
    ['muertos', span(y, 11, 1, 2)],
    ['spring', (([m, d]) => span(y, m, d - 2, 4))(easter(y))], // Good Friday – Easter Monday
    ['shamrock', stPatricks(y)],
    ['fiesta', span(y, 5, 4, 3)], // May 4–6
    ['labor', span(y, 9, nthWeekday(y, 9, 1, 1) - 2, 3)], // Sat – Labor Day Monday
    ['hanukkah', hanukkah ? span(y, ...hanukkah, 8) : []],
  ];
  const map = new Map();
  for (const [key, dates] of rules) for (const date of dates) if (!map.has(date)) map.set(date, key);
  calendars.set(y, map);
  return map;
}

export function holidayFor(date) {
  return holidayCalendar(Number(date.slice(0, 4))).get(date) ?? null;
}

// The palette is always the first draw from the day's constellation stream, so
// daily-design.mjs (which keeps drawing from the same stream) and everything else agree.
// The draw happens even on holidays so the rest of the day's design stays the same.
export function paletteKey(random, date) {
  const drawn = weighted(random, Object.entries(palettes).map(([k, v]) => [k, v.weight]))[0];
  return (date && holidayFor(date)) || drawn;
}

export function paletteFor(date) {
  const key = paletteKey(rng(`constellation:${date}`), date);
  return { key, ...palettes[key] };
}

// ---- colour helpers -----------------------------------------------------------------

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.replace('#', '').slice(i - 1, i + 1), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a, b, t) => {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};

export function hlsFromHex(hex) {
  const [r, g, b] = toRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, l, 0];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, l, s];
}

export function hexFromHls(h, l, s) {
  if (s === 0) return toHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return toHex([channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => v * 255));
}

// ---- colours for the other images ------------------------------------------------------

// Holiday palettes carry a second colour in `star` (red + green on Christmas). Everyday
// palettes don't: their dark star is their accent, so they derive exactly as before.
// How strong a colour is (0 = grey or white, 1 = pure hue). Near-white second colours such
// as Hanukkah's white keep the glow silver-white instead of an arbitrary hue.
export const chroma = (hex) => { const c = toRgb(hex); return (Math.max(...c) - Math.min(...c)) / 255; };
export const secondSatScale = (palette) => Math.min(1, chroma(palette.dark.star) / 0.7);
// Same idea for a holiday's main colour, so pale accents (champagne, frost) stay pale on the banner.
export const accentSatScale = (palette) => (isTwoTone(palette) ? Math.min(1, chroma(palette.dark.accent) / 0.7) : 1);

export const isTwoTone = (palette) => palette.dark.star.toLowerCase() !== palette.dark.accent.toLowerCase();

export function derive(palette) {
  const { light: l, dark: d } = palette;
  const duo = isTwoTone(palette);
  return {
    dark: {
      canvas: d.background,
      subtle: mix(d.background, d.foreground, 0.06),
      borderDefault: mix(d.background, d.accent, 0.2),
      borderMuted: mix(d.background, d.foreground, 0.12),
      fg: d.foreground,
      fgMuted: mix(d.background, d.accent, 0.75),
      fgSubtle: mix(d.background, d.accent, 0.5),
      accent: d.accent,
      second: d.star,
      empty: mix(d.background, d.foreground, 0.06),
      // Two-tone: the squares climb in the second colour and peak in the accent.
      ramp: duo
        ? [...[0.3, 0.55, 0.8].map((t) => mix(d.background, d.star, t)), d.accent]
        : [0.2, 0.5, 0.75, 1].map((t) => mix(d.background, d.accent, t)),
      snake: d.accent,
    },
    light: {
      canvas: l.background,
      subtle: mix(l.background, l.line, 0.15),
      borderDefault: l.line,
      borderMuted: mix(l.background, l.line, 0.4),
      fg: l.foreground,
      fgMuted: mix(l.foreground, l.background, 0.25),
      fgSubtle: mix(l.foreground, l.background, 0.4),
      accent: duo ? l.accent : l.foreground,
      second: duo ? l.star : l.foreground,
      empty: mix(l.background, l.line, 0.12),
      ramp: duo
        ? [mix(l.background, l.star, 0.3), mix(l.background, l.star, 0.55), mix(l.background, l.star, 0.8), l.accent]
        : [mix(l.background, l.star, 0.3), mix(l.background, l.star, 0.55), mix(l.background, l.star, 0.8), mix(l.star, l.foreground, 0.35)],
      snake: duo ? l.accent : l.foreground,
    },
  };
}

function metricsCss(c, light) {
  return `:root {
  --color-canvas-default: ${c.canvas} !important;
  --color-canvas-subtle: ${c.subtle} !important;
  --color-border-default: ${c.borderDefault} !important;
  --color-border-muted: ${c.borderMuted} !important;
  --color-fg-default: ${c.fg} !important;
  --color-fg-muted: ${c.fgMuted} !important;
  --color-fg-subtle: ${c.fgSubtle} !important;
  --color-accent-fg: ${c.accent} !important;
  --color-accent-emphasis: ${c.accent} !important;
  --color-success-fg: ${c.second} !important;
  --color-attention-fg: ${c.accent} !important;
  --color-severe-fg: ${c.accent} !important;
  --color-done-fg: ${c.second} !important;
  --color-calendar-graph-day-L1-bg: ${c.ramp[0]} !important;
  --color-calendar-graph-day-L2-bg: ${c.ramp[1]} !important;
  --color-calendar-graph-day-L3-bg: ${c.ramp[2]} !important;
  --color-calendar-graph-day-L4-bg: ${c.ramp[3]} !important;
  --color-calendar-graph-day-bg: ${c.empty} !important;
}
h1, h2, h3, h4, a { color: ${c.accent} !important; }
body { background-color: ${c.canvas} !important;${light ? ` color: ${c.fg} !important;` : ''} }
${light ? `text, tspan { fill: ${c.fg} !important; }\n` : ''}`;
}

function snakeOutputs(c) {
  const dots = (theme) => [theme.empty, ...theme.ramp].join(',');
  return [
    `dist/github-snake.svg?palette=github-light&color_snake=${c.light.snake}&color_dots=${dots(c.light)}`,
    `dist/github-snake-dark.svg?palette=github-dark&color_snake=${c.dark.snake}&color_dots=${dots(c.dark)}`,
  ].join('\n');
}

// Port of the recolour step that used to live in metrics.yml, driven by the day's palette.
export function recolorMetrics(dir, palette) {
  const c = derive(palette);
  // Two-tone days paint the calendar's cubes in the second colour; the brightest tops keep the accent.
  const duo = isTwoTone(palette);
  const [bodyHue] = hlsFromHex(duo ? palette.dark.star : palette.dark.accent);
  const satScale = duo ? secondSatScale(palette) : 1;
  const hexRe = /#([0-9a-fA-F]{6})\b/g;

  const classify = (hex, theme) => {
    const [h, l, s] = hlsFromHex(`#${hex}`);
    void h;
    if (s < 0.03) return null;
    const bright = l >= 0.45 && s >= 0.55;
    if (theme === 'light') return (bright ? c.light.fg : hexFromHls(bodyHue, l, s * satScale)).slice(1);
    return (bright ? c.dark.accent : hexFromHls(bodyHue, Math.max(0.13, 1 - l), Math.min(1, s * 1.15) * satScale)).slice(1);
  };

  const iso = { 'metrics.isocalendar-dark.svg': ['dark', c.dark.subtle], 'metrics.isocalendar.svg': ['light', c.light.canvas] };
  for (const [name, [theme, background]] of Object.entries(iso)) {
    const file = join(dir, name);
    if (!existsSync(file)) { console.log(`skip missing ${name}`); continue; }
    let text = readFileSync(file, 'utf8').replace(/#f0f0eb/gi, background);
    const mapping = new Map();
    for (const m of text.matchAll(hexRe)) {
      const hex = m[1].toLowerCase();
      const next = classify(hex, theme);
      if (next && next !== hex) mapping.set(hex, next);
    }
    for (const [from, to] of mapping) text = text.replace(new RegExp(`#${from}`, 'gi'), `#${to}`);
    writeFileSync(file, text);
    console.log(`${name}: ${palette.label}, ${mapping.size} colours remapped`);
  }

  const swaps = (theme) => ({
    ebedf0: theme.empty,
    '9be9a8': theme.ramp[0],
    '40c463': theme.ramp[1],
    '30a14e': theme.ramp[2],
    '216e39': theme.ramp[3],
    '0969da': theme.accent,
    '0366d6': theme.accent,
    '0a3069': theme.accent,
  });
  const explicit = { 'metrics-dark.svg': swaps(c.dark), 'metrics.svg': swaps(c.light) };
  for (const [name, map] of Object.entries(explicit)) {
    const file = join(dir, name);
    if (!existsSync(file)) { console.log(`skip missing ${name}`); continue; }
    let text = readFileSync(file, 'utf8');
    // Two-phase so a target colour can never be rewritten by a later swap.
    const placeholders = Object.keys(map);
    placeholders.forEach((from, i) => { text = text.replace(new RegExp(`#${from}`, 'gi'), `#@@${i}@@`); });
    placeholders.forEach((from, i) => { text = text.replaceAll(`#@@${i}@@`, map[from]); });
    writeFileSync(file, text);
    console.log(`${name}: ${placeholders.length} explicit swaps (${palette.label})`);
  }
}

// ---- cli -------------------------------------------------------------------------------

const isMain = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/palette.mjs');
if (isMain) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { date: { type: 'string' } } });
  const date = values.date ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error(`--date must be YYYY-MM-DD, got "${date}".`);
  const palette = paletteFor(date);
  const [command = 'show', target] = positionals;

  if (command === 'show') {
    console.log(JSON.stringify({ date, palette: palette.label, ...derive(palette) }, null, 2));
  } else if (command === 'github-output') {
    const c = derive(palette);
    const delimiter = `EOF_${hash(date)}`;
    const block = (name, value) => `${name}<<${delimiter}\n${value.trimEnd()}\n${delimiter}\n`;
    const out = block('palette_name', palette.label)
      + block('metrics_dark_css', metricsCss(c.dark, false))
      + block('metrics_light_css', metricsCss(c.light, true))
      + block('snake_outputs', snakeOutputs(c));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
    else process.stdout.write(out);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**Palette for ${date}:** ${palette.label}\n`);
  } else if (command === 'recolor') {
    recolorMetrics(target ?? '.', palette);
  } else {
    throw new Error(`Unknown command "${command}". Use show, github-output or recolor DIR.`);
  }
}
