// Builds assets/banner-{light,dark}.svg from banner.config.json.
// To edit visually instead, run `npm run editor`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { buildBanner } from '../banner/core.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'banner.config.json'), 'utf8'));

const fonts = {};
for (const [key, file] of Object.entries(cfg.fonts)) {
  const buf = fs.readFileSync(path.join(root, file));
  fonts[key] = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
for (const [name, svg] of Object.entries(buildBanner(fonts, cfg))) {
  const file = path.join(root, 'assets', `banner-${name}.svg`);
  fs.writeFileSync(file, svg);
  console.log(`${path.relative(root, file)}  ${(svg.length / 1024).toFixed(1)} KB`);
}
