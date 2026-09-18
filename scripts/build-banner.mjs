// Builds assets/banner-{light,dark}.svg.
// Every glyph and square is a rigid body in a matter-js world; the simulation
// runs here in Node and is baked into CSS keyframes, so the SVG animates on
// GitHub with no JavaScript.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import Matter from 'matter-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const font = (name) => opentype.parse(fs.readFileSync(path.join(here, 'fonts', name)).buffer);
const manrope = font('Manrope-Medium.ttf');
const serif = font('InstrumentSerif-Italic.ttf');
const sans = font('DMSans-Regular.ttf');

const W = 900;
const H = 412;
const FLOOR = 318;
const FPS = 60;
const DURATION = 3.4;

const r = (n) => Math.round(n * 100) / 100;
// opentype.js's toPathData occasionally emits NaN; serialise commands ourselves.
const pathData = (p) => p.commands.map((c) => {
  if (c.type === 'Z') return 'Z';
  const pts = c.type === 'C' ? [c.x1, c.y1, c.x2, c.y2, c.x, c.y]
    : c.type === 'Q' ? [c.x1, c.y1, c.x, c.y] : [c.x, c.y];
  return c.type + pts.map(r).join(' ');
}).join('');

// Lay out a word glyph by glyph, returning one body per glyph.
function word(f, text, size, x, baseline, tracking, cls) {
  const bodies = [];
  const scale = size / f.unitsPerEm;
  for (const glyph of glyphs(f, text)) {
    const p = glyph.getPath(x, baseline, size);
    const bb = p.getBoundingBox();
    const cx = (bb.x1 + bb.x2) / 2;
    const cy = (bb.y1 + bb.y2) / 2;
    const d = pathData(glyph.getPath(x - cx, baseline - cy, size));
    if (!p.commands.length) { x += glyph.advanceWidth * scale; continue; }
    bodies.push({ kind: 'glyph', cls, d, cx, cy, w: bb.x2 - bb.x1, h: bb.y2 - bb.y1 });
    x += glyph.advanceWidth * scale + tracking * size;
    if (Number.isNaN(x)) throw new Error(`NaN advancing ${text}`);
  }
  return { bodies, end: x };
}

// Plain cmap lookup + kerning; opentype.js chokes on these fonts' GSUB tables.
const glyphs = (f, str) => [...str].map((ch) => f.charToGlyph(ch));
function layout(f, str, size, x, baseline, draw) {
  const scale = size / f.unitsPerEm;
  const gs = glyphs(f, str);
  gs.forEach((g, i) => {
    draw?.(pathData(g.getPath(x, baseline, size)));
    x += g.advanceWidth * scale + (gs[i + 1] ? (f.getKerningValue(g, gs[i + 1]) || 0) * scale : 0);
  });
  return x;
}
function text(f, str, size, x, baseline) {
  let d = '';
  layout(f, str, size, x, baseline, (p) => { d += p; });
  return d;
}
const textWidth = (f, str, size) => layout(f, str, size, 0, 0);

// ---- composition (mirrors the site hero) ---------------------------------
const hello = word(serif, 'Hi, I’m', 60, 46, 96, 0, 'muted');
const tim = word(manrope, 'Tim', 250, 38, FLOOR, -0.055, 'ink');
const sq = (cls, x, y, s) => ({ kind: 'square', cls, cx: x + s / 2, cy: y + s / 2, w: s, h: s });
const squares = [
  sq('outline', 680, 118, 141),
  sq('blue', 635, 58, 125),
  sq('orange', 773, 200, 70),
  sq('yellow', 592, 232, 47),
];

// Drop order: greeting, then the name, then the squares crash in.
const order = [...hello.bodies, ...tim.bodies, ...squares];
const startTimes = [
  ...hello.bodies.map((_, i) => 0.1 + i * 0.06),
  ...tim.bodies.map((_, i) => 0.6 + i * 0.12),
  1.15, 1.3, 1.42, 1.52,
];

// ---- simulation ------------------------------------------------------------
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const engine = Matter.Engine.create({ gravity: { x: 0, y: 7 } });
order.forEach((b, i) => {
  const bit = 1 << i;
  const bottom = b.cy + b.h / 2;
  // Each body lands on its own shelf so the final layout is exact.
  const shelf = Matter.Bodies.rectangle(b.cx, bottom + 200, 2400, 400, {
    isStatic: true, collisionFilter: { category: bit, mask: bit },
  });
  const lift = b.cy + b.h / 2 + 30 + rand() * 80;
  const body = Matter.Bodies.rectangle(b.cx + (rand() - 0.5) * 24, b.cy - lift, b.w, b.h, {
    restitution: b.kind === 'square' ? 0.42 : 0.28,
    friction: 0.8, frictionAir: 0.004,
    angle: (rand() - 0.5) * (b.kind === 'square' ? 0.5 : 0.2),
    collisionFilter: { category: bit, mask: bit },
  });
  // Glyph boxes are tall and narrow and topple too easily, so letters only
  // translate; their slight tilt eases out in the pose correction below.
  if (b.kind === 'glyph') Matter.Body.setInertia(body, Infinity);
  Matter.Body.setStatic(body, true);
  Matter.Composite.add(engine.world, [shelf, body]);
  b.body = body;
  b.start = startTimes[i];
  b.frames = [];
});

const SUB = 4;
const frames = Math.round(DURATION * FPS);
for (let f = 0; f <= frames; f++) {
  const t = f / FPS;
  for (const b of order) {
    if (b.body.isStatic && t >= b.start) {
      Matter.Body.setStatic(b.body, false);
      if (b.kind === 'square') Matter.Body.setAngularVelocity(b.body, (rand() - 0.5) * 0.06);
    }
    b.frames.push({ x: b.body.position.x, y: b.body.position.y, a: b.body.angle });
  }
  for (let s = 0; s < SUB; s++) Matter.Engine.update(engine, 1000 / FPS / SUB);
}

// Nudge each trajectory so it ends exactly on the designed pose. The drift is
// a few px, spread smoothly over the fall so it reads as part of the physics.
for (const b of order) {
  const last = b.frames.at(-1);
  const quarter = Math.PI / 2;
  const target = b.kind === 'square' ? Math.round(last.a / quarter) * quarter : 0;
  const dx = b.cx - last.x, dy = b.cy - last.y, da = target - last.a;
  b.frames = b.frames.map((p, i) => {
    const k = Math.min(1, (i / FPS - b.start) / 0.9);
    const e = k <= 0 ? 0 : k * k * (3 - 2 * k);
    return { x: p.x + dx * e - b.cx, y: p.y + dy * e - b.cy, a: p.a + da * e - target };
  });
}

// Drop keyframes that linear interpolation already reproduces.
function simplify(pts, tol = 0.25) {
  const keep = [0];
  let anchor = 0;
  for (let i = 2; i < pts.length; i++) {
    const a = pts[anchor], c = pts[i];
    let ok = true;
    for (let j = anchor + 1; j < i && ok; j++) {
      const u = (j - anchor) / (i - anchor), p = pts[j];
      ok = Math.abs(a.x + (c.x - a.x) * u - p.x) < tol
        && Math.abs(a.y + (c.y - a.y) * u - p.y) < tol
        && Math.abs((a.a + (c.a - a.a) * u - p.a) * 57.3) < tol;
    }
    if (!ok) { keep.push(i - 1); anchor = i - 1; }
  }
  keep.push(pts.length - 1);
  return keep;
}

let css = '';
order.forEach((b, i) => {
  const idx = simplify(b.frames);
  css += `@keyframes b${i}{`;
  for (const k of idx) {
    const p = b.frames[k];
    css += `${r((k / frames) * 100)}%{transform:translate(${r(p.x)}px,${r(p.y)}px) rotate(${r(p.a * 57.2958)}deg)}`;
  }
  css += '}\n';
});

// ---- render ----------------------------------------------------------------
const themes = {
  light: { bg: '#f5f4ed', ink: '#282a24', muted: '#686a60', line: '#d4d5c8', outline: '#565f4a' },
  dark: { bg: '#161713', ink: '#ecebe2', muted: '#9a9c90', line: '#34362e', outline: '#a4ab8c' },
};
const fill = { blue: '#315cd5', orange: '#e77743', yellow: '#dfc14e' };

function svg(t) {
  const shapes = order.map((b, i) => {
    const inner = b.kind === 'glyph'
      ? `<path class="${b.cls}" d="${b.d}"/>`
      : `<rect class="${b.cls}" x="${r(-b.w / 2)}" y="${r(-b.h / 2)}" width="${b.w}" height="${b.h}"/>`;
    return `<g transform="translate(${r(b.cx)} ${r(b.cy)})"><g class="b" style="animation-name:b${i}">${inner}</g></g>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hi, I’m Tim. Computer science student.">
<style>
.ink{fill:${t.ink}}.muted{fill:${t.muted}}
.blue{fill:${fill.blue}}.orange{fill:${fill.orange}}.yellow{fill:${fill.yellow}}
.outline{fill:none;stroke:${t.outline};stroke-width:1.5}
.b{animation:${DURATION}s linear both}
.copy{animation:fade .9s 2.3s ease-out both}
.rule{animation:draw 1.1s .15s cubic-bezier(.6,0,.2,1) both;transform-origin:44px 0}
@keyframes fade{from{opacity:0;transform:translateY(8px)}}
@keyframes draw{from{transform:scaleX(0)}}
${css}@media (prefers-reduced-motion:reduce){.b,.copy,.rule{animation:none}}
</style>
<rect width="${W}" height="${H}" rx="20" fill="${t.bg}"/>
<svg x="0" y="0" width="${W}" height="${H}" overflow="hidden">
${shapes}
</svg>
<rect class="rule" x="44" y="${FLOOR + 32}" width="${W - 88}" height="1" fill="${t.line}"/>
<path class="copy ink" d="${text(sans, 'Computer science student.', 22, 44, FLOOR + 74)}"/>
</svg>
`;
}

const out = path.join(here, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
for (const [name, t] of Object.entries(themes)) {
  const file = path.join(out, `banner-${name}.svg`);
  fs.writeFileSync(file, svg(t));
  console.log(`${file}  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
}
