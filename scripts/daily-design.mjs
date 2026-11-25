#!/usr/bin/env node
// Picks today's "sky" for the README constellation.
//
// The design is a pure function of the UTC date, so every run on the same day
// (cron, manual re-run, local preview) draws the same picture, and tomorrow
// draws a different one. Your repositories and the base look live in
// constellation.config.json; this script only varies presentation.
//
//   node scripts/daily-design.mjs                       # today's config -> stdout
//   node scripts/daily-design.mjs --date 2026-12-25     # any date
//   node scripts/daily-design.mjs --out today.json      # write to a file
//   node scripts/daily-design.mjs --days 14 --name-only # list upcoming sky names

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rng, weighted, palettes, paletteKey, today } from './palette.mjs';

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'constellation.config.json' },
    date: { type: 'string' },
    out: { type: 'string' },
    days: { type: 'string' },
    'name-only': { type: 'boolean', default: false },
  },
});

// ---- the draw --------------------------------------------------------------------

const arrangements = [['rings', 'Rings', 1]];
const skies = [
  ['milky-way', 5],
  ['space', 3],
  ['classic', 2],
];
const shapes = [
  ['circle', 4],
  ['star', 2],
  ['diamond', 1],
  ['hexagon', 1],
  ['mixed', 2],
];
const effects = [
  ['none', 6],
  ['grid', 1],
  ['coordinates', 1],
  ['scanlines', 1],
];
const sizes = [
  ['uniform', 3],
  ['stars', 2],
  ['activity', 2],
  ['languages', 1],
];
const colorModes = [
  ['language', 5],
  ['seeded', 2],
  ['category', 1],
];

const pick = (random, list) => list[Math.floor(random() * list.length)];
const range = (random, min, max) => min + Math.floor(random() * (max - min + 1));

function css(p) {
  const decl = (c) => Object.entries(c).map(([k, v]) => `  --sky-${k}: ${v};`).join('\n');
  return [
    '/* Daily sky: light palette, then the viewer’s dark preference. */',
    ...(p.secret ? [`/* ♥ ${p.secret} */`] : []),
    'svg {',
    decl(p.light),
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  svg {',
    decl(p.dark).replace(/^/gm, '  '),
    '  }',
    '}',
    '.connections { stroke-width: 1; opacity: 0.65; }',
    '.shared-language[data-emphasis="secondary"] { opacity: 0.26; }',
    '.bridges { stroke-width: 1; opacity: 0.3; }',
    '.star { filter: drop-shadow(0 0 3.5px var(--node-color,var(--sky-star))); }',
    '.dust { opacity: 0.95; }',
    '.language text, .repo-label { font-size: 11px; }',
    '.language, .repo-label { display: inline; }',
    '',
  ].join('\n');
}

export function designFor(date, base) {
  const random = rng(`constellation:${date}`);
  const config = structuredClone(base);

  const key = paletteKey(random, date);
  const palette = palettes[key];
  const [arrangement, arrangementLabel] = weighted(random, arrangements);
  const [skyMode] = weighted(random, skies);
  const [shape] = weighted(random, shapes);
  const [effect] = weighted(random, effects);
  const [nodeSize] = weighted(random, sizes);
  const [nodeColorMode] = weighted(random, colorModes);
  // About one day in ten is a "meteor shower": comets streak between active projects.
  const meteor = random() < 0.1;

  config.seedMode = 'custom';
  config.seed = `sky-${date}`;
  config.arrangement = arrangement;
  config.snapToRings = true;
  config.identityRing = true;
  config.nodeShape = shape;
  config.nodeSize = nodeSize;
  config.nodeColorMode = nodeColorMode;
  config.effect = effect;
  config.connectionBasis = pick(random, ['languages', 'languages', 'both']);
  config.connectionDensity = 'balanced';
  config.nodeGlowMode = meteor ? 'activity' : pick(random, ['activity', 'uniform', 'seeded']);

  config.starfield = {
    ...config.starfield,
    mode: skyMode,
    density: range(random, 55, 100),
    brightness: Number((0.7 + random() * 0.3).toFixed(2)),
    depth: Number((0.6 + random() * 0.4).toFixed(2)),
    twinkle: true,
    seed: `${date}-sky`,
  };

  // Motion: each ring may turn its own way, at its own pace.
  const speeds = Array.from({ length: 4 }, () => Number((0.25 + random() * 1.25).toFixed(2)));
  config.ringAnimation = {
    ...config.ringAnimation,
    enabled: true,
    linked: false,
    speeds,
    directions: speeds.map(() => (random() < 0.5 ? 'clockwise' : 'counterclockwise')),
    modes: speeds.map(() => 'spin'),
    easing: speeds.map(() => 'smooth'),
    amplitudes: speeds.map(() => 100),
  };
  config.ringRotations = Array.from({ length: 4 }, () => range(random, 0, 359));
  config.floatingAnimation = {
    enabled: random() < 0.5,
    mode: pick(random, ['orbit', 'drift', 'bob']),
    amplitude: range(random, 3, 8),
    duration: range(random, 18, 40),
  };

  // A gentle tilt on some days, so the sky occasionally has depth.
  const tilt = random() < 0.2;
  config.perspective = {
    ...config.perspective,
    enabled: tilt,
    animate: true,
    horizontal: range(random, -20, 20),
    vertical: range(random, 15, 35),
    zoom: range(random, 85, 95),
    range: range(random, 10, 25),
    duration: range(random, 30, 60),
  };

  if (meteor) {
    config.activityEffect = 'comet';
    config.activityWindow = '30d';
    config.activityAnimate = true;
    config.activityConnections = true;
  }

  // Palette: keep CSS and visualStyle in step, exactly as the Studio does.
  config.visualStyle = { ...config.visualStyle, light: { ...palette.light }, dark: { ...palette.dark } };
  config.css = css(palette);

  const name = `${palette.label} ${meteor ? 'meteor shower' : arrangementLabel}`;
  return { config, name, meta: { palette: key, arrangement, skyMode, shape, effect, nodeSize, nodeColorMode, meteor } };
}

// ---- cli -------------------------------------------------------------------------

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`--date must be YYYY-MM-DD, got "${value}".`);
  }
  return value;
}

const isMain = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/daily-design.mjs');

if (isMain) {
  const base = JSON.parse(readFileSync(args.base, 'utf8'));

  if (args.days) {
    const start = assertDate(args.date ?? today());
    for (let i = 0; i < Number(args.days); i++) {
      const d = new Date(`${start}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      console.log(`${date}  ${designFor(date, base).name}`);
    }
  } else {
    const date = assertDate(args.date ?? today());
    const { config, name } = designFor(date, base);
    if (args['name-only']) console.log(name);
    else if (args.out) writeFileSync(args.out, `${JSON.stringify(config, null, 2)}\n`);
    else process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);

    if (args.out) console.error(`Today's sky (${date}): ${name}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**Sky for ${date}:** ${name}\n`);
    }
  }
}
