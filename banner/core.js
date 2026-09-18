// Shared by the Node build script and the browser editor.
// Every glyph and square is a rigid body in matter-js; the simulation is
// baked into CSS keyframes so the SVG animates on GitHub with no JavaScript.
import Matter from 'matter-js';

const FPS = 60;
const SUB = 4;

const r = (n) => Math.round(n * 100) / 100;

// opentype.js's toPathData occasionally emits NaN; serialise commands ourselves.
const pathData = (p) => p.commands.map((c) => {
  if (c.type === 'Z') return 'Z';
  const pts = c.type === 'C' ? [c.x1, c.y1, c.x2, c.y2, c.x, c.y]
    : c.type === 'Q' ? [c.x1, c.y1, c.x, c.y] : [c.x, c.y];
  return c.type + pts.map(r).join(' ');
}).join('');

// Plain cmap lookup + kerning; opentype.js chokes on these fonts' GSUB tables.
function layout(font, t, visit) {
  const scale = t.size / font.unitsPerEm;
  const glyphs = [...t.text].map((ch) => font.charToGlyph(ch));
  let x = t.x;
  glyphs.forEach((g, i) => {
    visit(g, x);
    const kern = glyphs[i + 1] ? font.getKerningValue(g, glyphs[i + 1]) || 0 : 0;
    x += (g.advanceWidth + kern) * scale + (t.tracking || 0) * t.size;
  });
}

// One body per visible glyph, with its path centred on the body's origin.
function glyphBodies(font, t, cls, part) {
  const bodies = [];
  layout(font, t, (g, x) => {
    const p = g.getPath(x, t.y, t.size);
    if (!p.commands.length) return;
    const bb = p.getBoundingBox();
    const cx = (bb.x1 + bb.x2) / 2;
    const cy = (bb.y1 + bb.y2) / 2;
    bodies.push({
      kind: 'glyph', cls, part, cx, cy,
      w: Math.max(1, bb.x2 - bb.x1), h: Math.max(1, bb.y2 - bb.y1),
      d: pathData(g.getPath(x - cx, t.y - cy, t.size)),
    });
  });
  return bodies;
}

function textPath(font, t) {
  let d = '';
  layout(font, t, (g, x) => { d += pathData(g.getPath(x, t.y, t.size)); });
  return d;
}

function simulate(bodies, m, frames) {
  let seed = Math.max(1, Math.floor(m.seed)) % 2147483647;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  for (const b of bodies) {
    // Each body gets its own world and shelf, so bodies never interfere and
    // every one comes to rest exactly where the layout puts it.
    const engine = Matter.Engine.create({ gravity: { x: 0, y: m.gravity } });
    const square = b.kind === 'square';
    const shelf = Matter.Bodies.rectangle(b.cx, b.cy + b.h / 2 + 200, 2400, 400, { isStatic: true });
    const lift = b.cy + b.h / 2 + 30 + rand() * 80;
    const body = Matter.Bodies.rectangle(b.cx + (rand() - 0.5) * 24, b.cy - lift, b.w, b.h, {
      restitution: square ? m.squareBounce : m.letterBounce,
      friction: 0.8, frictionAir: 0.004,
      angle: (rand() - 0.5) * (square ? 0.5 : 0.2),
    });
    // Glyph boxes are tall and narrow and topple too easily, so letters only
    // translate; their slight tilt eases out in the pose correction below.
    if (square) Matter.Body.setAngularVelocity(body, (rand() - 0.5) * 0.06);
    else Matter.Body.setInertia(body, Infinity);
    Matter.Composite.add(engine.world, [shelf, body]);

    const startFrame = Math.round(b.start * FPS);
    b.frames = [];
    for (let f = 0; f <= frames; f++) {
      b.frames.push({ x: body.position.x, y: body.position.y, a: body.angle });
      if (f >= startFrame) for (let s = 0; s < SUB; s++) Matter.Engine.update(engine, 1000 / FPS / SUB);
    }

    // Nudge the trajectory so it ends exactly on the designed pose. The drift
    // is a few px, spread smoothly over the fall so it reads as physics.
    const last = b.frames.at(-1);
    const quarter = Math.PI / 2;
    const target = square ? Math.round(last.a / quarter) * quarter : 0;
    const dx = b.cx - last.x, dy = b.cy - last.y, da = target - last.a;
    b.frames = b.frames.map((p, i) => {
      const k = Math.min(1, (i / FPS - b.start) / 0.9);
      const e = k <= 0 ? 0 : k * k * (3 - 2 * k);
      return { x: p.x + dx * e - b.cx, y: p.y + dy * e - b.cy, a: p.a + da * e - target };
    });
  }
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

/**
 * Returns { [themeName]: svgString }.
 * animate: false renders the final pose only (fast, used while dragging).
 * reducedMotion: false omits the prefers-reduced-motion fallback (editor preview).
 */
export function buildBanner(fonts, cfg, { animate = true, reducedMotion = true } = {}) {
  const m = cfg.motion;
  const greeting = glyphBodies(fonts[cfg.greeting.font], cfg.greeting, 'muted', 'greeting');
  const name = glyphBodies(fonts[cfg.name.font], cfg.name, 'ink', 'name');
  const squares = cfg.squares.map((s, i) => ({
    kind: 'square', cls: s.color, part: `square:${i}`,
    cx: s.x + s.size / 2, cy: s.y + s.size / 2, w: s.size, h: s.size,
  }));

  // Drop order: greeting, then the name, then the squares crash in.
  let t = 0.1;
  for (const b of greeting) { b.start = t; t += m.greetingGap; }
  t += 0.15;
  for (const b of name) { b.start = t; t += m.nameGap; }
  t += 0.2;
  for (const b of squares) { b.start = t; t += m.squareGap; }
  const order = [...greeting, ...name, ...squares];
  const lastStart = order.length ? Math.max(...order.map((b) => b.start)) : 0;
  const duration = r(lastStart + 1.9);
  const fadeAt = r(lastStart + 0.75);

  let css = '';
  if (animate) {
    const frames = Math.round(duration * FPS);
    simulate(order, m, frames);
    order.forEach((b, i) => {
      css += `@keyframes b${i}{`;
      for (const k of simplify(b.frames)) {
        const p = b.frames[k];
        css += `${r((k / frames) * 100)}%{transform:translate(${r(p.x)}px,${r(p.y)}px) rotate(${r(p.a * 57.2958)}deg)}`;
      }
      css += '}\n';
    });
    css += `.b{animation:${duration}s linear both}
.copy{animation:fade .9s ${fadeAt}s ease-out both}
.rule{animation:draw 1.1s .15s cubic-bezier(.6,0,.2,1) both;transform-origin:${cfg.rule.inset}px 0}
@keyframes fade{from{opacity:0;transform:translateY(8px)}}
@keyframes draw{from{transform:scaleX(0)}}
`;
    if (reducedMotion) css += '@media (prefers-reduced-motion:reduce){.b,.copy,.rule{animation:none}}\n';
  }

  const shapes = order.map((b, i) => {
    const inner = b.kind === 'glyph'
      ? `<path class="${b.cls}" d="${b.d}"/>`
      : `<rect class="${b.cls}" x="${r(-b.w / 2)}" y="${r(-b.h / 2)}" width="${b.w}" height="${b.h}"/>`;
    return `<g data-part="${b.part}" transform="translate(${r(b.cx)} ${r(b.cy)})"><g class="b" style="animation-name:b${i}">${inner}</g></g>`;
  }).join('\n');

  const { width: W, height: H } = cfg;
  const label = `${cfg.greeting.text} ${cfg.name.text}. ${cfg.subtitle.text}`.replace(/[<&"]/g, '');
  const out = {};
  for (const [themeName, th] of Object.entries(cfg.themes)) {
    out[themeName] = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
<style>
.ink{fill:${th.ink}}.muted{fill:${th.muted}}
.blue{fill:${cfg.colors.blue}}.orange{fill:${cfg.colors.orange}}.yellow{fill:${cfg.colors.yellow}}
.outline{fill:none;stroke:${th.outline};stroke-width:1.5}
${css}</style>
<rect width="${W}" height="${H}" rx="${cfg.radius}" fill="${th.bg}"/>
${shapes}
<rect class="rule" x="${cfg.rule.inset}" y="${cfg.rule.y}" width="${W - cfg.rule.inset * 2}" height="1" fill="${th.line}"/>
<path data-part="subtitle" class="copy ink" d="${textPath(fonts[cfg.subtitle.font], cfg.subtitle)}"/>
</svg>
`;
  }
  return out;
}
