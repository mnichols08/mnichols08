#!/usr/bin/env node
// Styles a tech stack SVG made by Constellation to match the rest of the profile:
//   1. colours follow today's palette (scripts/palette.mjs) in both light and dark mode;
//   2. a slight, date-seeded motion that changes every UTC day.
//
//   node scripts/style-tech.mjs tech-stack.svg --kind card
//   node scripts/style-tech.mjs tech-stack-map.svg --kind map --date 2026-12-25
//
// Everything is plain CSS inside the SVG (no scripts), and it stands still for
// viewers who ask for reduced motion.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { paletteFor, derive, mix } from './palette.mjs';

function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

function rng(seed) {
  let s = hash(seed) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (random, list) => list[Math.floor(random() * list.length)];

const MOTION = {
  card: {
    // Bars glow in a soft wave down the list.
    sweep: (d) => ({
      name: 'Sweep',
      css: `@keyframes tech-sweep{0%,22%,100%{filter:brightness(1)}10%{filter:brightness(1.55)}}
.tech-bar{animation:tech-sweep ${d.cycle}s ease-in-out infinite}`,
    }),
    // Bars breathe, each a beat behind the last.
    breathe: (d) => ({
      name: 'Breathe',
      css: `@keyframes tech-breathe{0%,100%{filter:brightness(1)}50%{filter:brightness(1.4)}}
.tech-bar{animation:tech-breathe ${d.cycle * 0.6}s ease-in-out infinite}`,
    }),
    // Bars stretch a hair from the left, like a slow inhale.
    stretch: (d) => ({
      name: 'Stretch',
      css: `@keyframes tech-stretch{0%,100%{transform:scaleX(.93)}50%{transform:scaleX(1)}}
.tech-bar{transform-box:fill-box;transform-origin:left center;animation:tech-stretch ${d.cycle * 0.7}s ease-in-out infinite}`,
    }),
  },
  map: {
    // A ripple of brightness crosses the map, left to right (or right to left).
    wave: (d) => ({
      name: 'Wave',
      css: `@keyframes tech-wave{0%,100%{opacity:.78}50%{opacity:1}}
.star{animation:tech-wave ${d.cycle * 0.5}s ease-in-out infinite}`,
    }),
    // Halos swell and settle.
    halo: (d) => ({
      name: 'Halo',
      css: `@keyframes tech-halo{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.12);opacity:1}}
.star-halo{transform-box:fill-box;transform-origin:center;animation:tech-halo ${d.cycle * 0.55}s ease-in-out infinite}`,
    }),
    // Every star floats a couple of pixels on its own small loop.
    drift: (d) => ({
      name: 'Drift',
      css: `@keyframes tech-drift{0%,100%{transform:translate(0,0)}25%{transform:translate(1.6px,-1.8px)}50%{transform:translate(-.6px,-2.4px)}75%{transform:translate(-1.8px,-.6px)}}
.repository{transform-box:fill-box;transform-origin:center;animation:tech-drift ${d.cycle * 1.1}s ease-in-out infinite}`,
    }),
  },
};

function themeCss(kind, date) {
  const palette = paletteFor(date);
  const { light, dark } = derive(palette);
  const vars = (c, p) => {
    if (kind === 'map') return `--t-page:${p === palette.light ? '#ffffff' : '#0d1117'};--sky-background:${p.background};--sky-foreground:${p.foreground};--sky-accent:${p.accent};--sky-line:${p.line};--sky-star:${p.star}`;
    return `--t-bg:${p.background};--t-fg:${p.foreground};--t-muted:${mix(p.foreground, p.background, 0.25)};--t-subtle:${mix(p.foreground, p.background, 0.45)};--t-track:${mix(p.background, p.foreground, 0.12)};--t-border:${mix(p.background, p.foreground, 0.16)}`;
  };
  const rules = kind === 'map'
    ? `svg{background:transparent}
svg .repo-label{fill:var(--sky-foreground)!important;stroke:var(--t-page)!important}
.scene-annotation{fill:var(--sky-foreground);stroke:var(--t-page)}`
    : `rect[fill="#050819"]{fill:none}
[fill="#eef1f8"],[fill="#eef2ff"]{fill:var(--t-fg)}
[fill="#bcc5d8"]{fill:var(--t-muted)}
[fill="#8f9ab3"]{fill:var(--t-subtle)}
[fill="#232a45"]{fill:var(--t-track)}
[stroke="#232a45"]{stroke:var(--t-track)}`;
  void light; void dark;
  return `svg{${vars(null, palette.light)}}
@media (prefers-color-scheme:dark){svg{${vars(null, palette.dark)}}}
${rules}`;
}

export function animateTech(svg, { kind, date }) {
  const random = rng(`tech-motion:${kind}:${date}`);
  const [key, build] = pick(random, Object.entries(MOTION[kind]));
  const cycle = 7 + Math.floor(random() * 6); // 7 to 12 seconds
  const reverse = random() < 0.5;
  const { name, css } = build({ cycle });

  let out = svg;
  let count = 0;

  if (kind === 'card') {
    // Coloured bars are the 8px-tall rects that carry an opacity attribute.
    const bars = [...out.matchAll(/<rect [^>]*height="8"[^>]*opacity="[^"]*"[^>]*\/>/g)].length;
    let i = 0;
    out = out.replace(/<rect ([^>]*height="8"[^>]*opacity="[^"]*"[^>]*)\/>/g, (_, attrs) => {
      const slot = reverse ? bars - 1 - i : i;
      const step = key === 'sweep' ? cycle / bars : 0.35;
      i += 1;
      return `<rect class="tech-bar" style="animation-delay:${(slot * step).toFixed(2)}s" ${attrs}/>`;
    });
    count = i;
  } else {
    // Delay by position so waves and halos travel across the map instead of flickering.
    const xs = [...out.matchAll(/<circle class="star" cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    const min = Math.min(...xs);
    const span = Math.max(...xs) - min || 1;
    out = out.replace(/(<g class="repository" )(style="[^"]*")>(.*?)<\/g>/gs, (whole, open, style, inner) => {
      const cx = Number(/class="star" cx="([\d.]+)"/.exec(inner)?.[1] ?? min);
      const t = (cx - min) / span;
      const delay = -((reverse ? 1 - t : t) * cycle * (key === 'drift' ? 1 : 0.5)).toFixed(2);
      count += 1;
      if (key === 'drift') return `${open}style="${style.slice(7, -1)};animation-delay:${delay}s">${inner}</g>`;
      const withDelay = inner.replace(/(<circle class="star(?:-halo)?" [^>]*?)(?: style="[^"]*")?\/>/g, `$1 style="animation-delay:${delay}s"/>`);
      return `${open}${style}>${withDelay}</g>`;
    });
  }

  if (!count) throw new Error(`No ${kind} elements found to animate; the Constellation output format may have changed.`);

  const style = `<style>/* daily style: ${paletteFor(date).label} palette, ${name} motion (${date}) */\n${themeCss(kind, date)}\n${css}\n@media (prefers-reduced-motion:reduce){.tech-bar,.star,.star-halo,.repository{animation:none!important}}</style>`;
  // Placed last so it wins over Constellation's own rules at equal specificity.
  out = out.replace(/<\/svg>\s*$/, () => `${style}</svg>`);
  return { svg: out, name, count };
}

const isMain = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/style-tech.mjs');
if (isMain) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { kind: { type: 'string' }, date: { type: 'string' } },
  });
  const [file] = positionals;
  if (!file || !['card', 'map'].includes(values.kind)) {
    throw new Error('Usage: style-tech.mjs FILE --kind card|map [--date YYYY-MM-DD] [--out FILE]');
  }
  const date = values.date ?? new Date().toISOString().slice(0, 10);
  const { svg, name, count } = animateTech(readFileSync(file, 'utf8'), { kind: values.kind, date });
  writeFileSync(file, svg);
  console.error(`${file}: ${name} palette + motion on ${count} elements (${date})`);
}
