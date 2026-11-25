#!/usr/bin/env node
// One palette per UTC day, shared by every image on the profile.
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
};

// The palette is always the first draw from the day's constellation stream, so
// daily-design.mjs (which keeps drawing from the same stream) and everything else agree.
export function paletteKey(random) {
  return weighted(random, Object.entries(palettes).map(([k, v]) => [k, v.weight]))[0];
}

export function paletteFor(date) {
  const key = paletteKey(rng(`constellation:${date}`));
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

export function derive(palette) {
  const { light: l, dark: d } = palette;
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
      empty: mix(d.background, d.foreground, 0.06),
      ramp: [0.2, 0.5, 0.75, 1].map((t) => mix(d.background, d.accent, t)),
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
      accent: l.foreground,
      empty: mix(l.background, l.line, 0.12),
      ramp: [mix(l.background, l.star, 0.3), mix(l.background, l.star, 0.55), mix(l.background, l.star, 0.8), mix(l.star, l.foreground, 0.35)],
      snake: l.foreground,
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
  --color-success-fg: ${c.accent} !important;
  --color-attention-fg: ${c.accent} !important;
  --color-severe-fg: ${c.accent} !important;
  --color-done-fg: ${c.accent} !important;
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
  const targetHue = hlsFromHex(palette.dark.accent)[0];
  const hexRe = /#([0-9a-fA-F]{6})\b/g;

  const classify = (hex, theme) => {
    const [h, l, s] = hlsFromHex(`#${hex}`);
    void h;
    if (s < 0.03) return null;
    const bright = l >= 0.45 && s >= 0.55;
    if (theme === 'light') return (bright ? c.light.fg : hexFromHls(targetHue, l, s)).slice(1);
    return (bright ? c.dark.accent : hexFromHls(targetHue, Math.max(0.13, 1 - l), Math.min(1, s * 1.15))).slice(1);
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
  const date = values.date ?? new Date().toISOString().slice(0, 10);
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
