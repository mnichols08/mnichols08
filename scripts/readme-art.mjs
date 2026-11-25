#!/usr/bin/env node
// Fetches the README's third-party images (typing banner, nav badges, streak card)
// with today's palette baked in, so they match everything else.
//
// Those services take colours in the URL, and a README's URLs can't change daily,
// so the workflow asks for today's version and publishes it to the output branch.
//
//   node scripts/readme-art.mjs art                       # write art/*.svg
//   node scripts/readme-art.mjs art --date 2026-12-25     # any date
//   node scripts/readme-art.mjs --list                    # show the URLs only
//
// A fetch that fails is skipped (and reported), so the last published copy stays live.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { paletteFor, derive } from './palette.mjs';

const hex = (color) => color.replace('#', '');

const TYPING_LINES = ['Full-Stack Developer', 'Creator of Zubra', 'HTML-first Web Components', 'Rust + WebAssembly', 'React & Node.js'];

export function artFor(date) {
  const palette = paletteFor(date);
  const { dark, light } = derive(palette);
  const modes = {
    dark: { accent: dark.accent, onAccent: palette.dark.background, text: dark.fg, soft: dark.ramp[2], rule: dark.accent, ring: dark.accent },
    light: { accent: palette.light.star, onAccent: palette.light.background, text: light.fg, soft: palette.light.star, rule: light.fg, ring: palette.light.star },
  };
  const items = [];

  for (const [mode, c] of Object.entries(modes)) {
    const lines = TYPING_LINES.map((line) => encodeURIComponent(line).replaceAll('%20', '+')).join(';');
    items.push({
      file: `typing-${mode}.svg`,
      url: `https://readme-typing-svg.demolab.com?font=Fira+Code&size=22&duration=3000&pause=1000&color=${hex(c.accent).toUpperCase()}&center=true&vCenter=true&width=600&lines=${lines}`,
    });

    items.push({
      file: `streak-${mode}.svg`,
      url: `https://streak-stats.demolab.com?user=mnichols08&hide_border=true&background=00000000&stroke=${hex(c.rule)}&ring=${hex(c.ring)}&fire=${hex(c.ring)}&currStreakLabel=${hex(mode === 'dark' ? c.accent : c.text)}&currStreakNum=${hex(c.text)}&sideLabels=${hex(c.text)}&sideNums=${hex(c.text)}&dates=${hex(c.soft)}`,
    });

    // Badges whose message was the base yellow.
    const badge = (name, label, extra = '') => ({
      file: `badge-${name}-${mode}.svg`,
      url: `https://img.shields.io/badge/${label}-${hex(c.accent)}?style=for-the-badge${extra}&logoColor=${hex(c.onAccent)}`,
    });
    items.push(badge('portfolio', 'Portfolio-mnix.dev'));
    items.push(badge('writing', 'Technical_Writing-Journey_to_Code'));
    items.push(badge('resume', 'Resume-Download', '&logo=readdotcv'));
    items.push(badge('javascript', 'JavaScript', '&logo=javascript'));
  }

  // Dark-mode badges whose logo was the base yellow (light mode keeps its dark logo).
  const logo = (name, label, icon) => ({
    file: `badge-${name}-dark.svg`,
    url: `https://img.shields.io/badge/${label}-111111?style=for-the-badge&logo=${icon}&logoColor=${hex(modes.dark.accent)}`,
  });
  items.push(logo('axum', 'Axum', 'rust'));
  items.push(logo('webcomponents', 'Web_Components', 'webcomponents.org'));
  items.push(logo('restapis', 'REST_APIs', 'fastapi'));

  return { palette, items };
}

async function fetchSvg(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000), redirect: 'follow' });
      const text = await response.text();
      if (response.ok && /<svg[\s>]/.test(text) && text.length > 200) return text;
      throw new Error(`HTTP ${response.status}, ${text.length} bytes`);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

const isMain = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/readme-art.mjs');
if (isMain) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { date: { type: 'string' }, list: { type: 'boolean', default: false } } });
  const date = values.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error(`--date must be YYYY-MM-DD, got "${date}".`);
  const { palette, items } = artFor(date);

  if (values.list) {
    for (const item of items) console.log(`${item.file}\n  ${item.url}`);
  } else {
    const [dir] = positionals;
    if (!dir) throw new Error('Usage: readme-art.mjs OUTPUT_DIR [--date YYYY-MM-DD]');
    mkdirSync(dir, { recursive: true });
    let failed = 0;
    // A few at a time: kind to the free services.
    for (let i = 0; i < items.length; i += 4) {
      await Promise.all(items.slice(i, i + 4).map(async ({ file, url }) => {
        try {
          writeFileSync(join(dir, file), await fetchSvg(url));
        } catch (error) {
          failed += 1;
          console.error(`::warning::${file} was not refreshed (${error.message}); the last published copy stays live.`);
        }
      }));
    }
    console.error(`${palette.label} (${date}): ${items.length - failed}/${items.length} README images fetched`);
  }
}
