import * as opentypeModule from 'opentype.js';
import { buildBanner } from '../banner/core.js';

// Vite may hand us either the ES build (named exports) or the CJS one (default).
const opentype = opentypeModule.default ?? opentypeModule;

const canvas = document.getElementById('canvas');
const panel = document.getElementById('panel');
const status = document.getElementById('status');
const themeButton = document.getElementById('theme');

let cfg;
let fonts = {};
let theme = 'light';
let dirty = false;

const get = (p) => p.split('.').reduce((o, k) => o[k], cfg);
function set(p, value) {
  const keys = p.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], cfg)[last] = value;
}

function render(animate) {
  const svgs = buildBanner(fonts, cfg, { animate, reducedMotion: false });
  canvas.innerHTML = svgs[theme];
  canvas.classList.toggle('is-editing', !animate);
}

function changed() {
  dirty = true;
  status.textContent = 'Unsaved changes';
  render(false);
}

// ---- form -------------------------------------------------------------------
const num = (path, label, step = 1) =>
  `<label>${label}<input type="number" step="${step}" data-path="${path}" /></label>`;
const txt = (path, label) => `<label>${label}<input type="text" data-path="${path}" /></label>`;
const color = (path, label) => `<label>${label}<input type="color" data-path="${path}" /></label>`;
const fontSelect = (path) => `<label>Font<select data-path="${path}">${
  Object.keys(cfg.fonts).map((f) => `<option>${f}</option>`).join('')}</select></label>`;

function textGroup(key, label) {
  return `<div class="ed-group">
    ${txt(`${key}.text`, label)}
    <div class="ed-row">${num(`${key}.size`, 'Size')}${num(`${key}.x`, 'X')}${num(`${key}.y`, 'Baseline')}${num(`${key}.tracking`, 'Spacing', 0.005)}</div>
    ${fontSelect(`${key}.font`)}
  </div>`;
}

function buildPanel() {
  const squareOptions = ['blue', 'orange', 'yellow', 'outline'];
  panel.innerHTML = `
    <h2>Text</h2>
    ${textGroup('greeting', 'Greeting')}
    ${textGroup('name', 'Name')}
    ${textGroup('subtitle', 'Subtitle')}

    <h2>Squares</h2>
    ${cfg.squares.map((_, i) => `<div class="ed-group">
      <div class="ed-row">
        <label>Colour<select data-path="squares.${i}.color">${squareOptions.map((c) => `<option>${c}</option>`).join('')}</select></label>
        ${num(`squares.${i}.size`, 'Size')}${num(`squares.${i}.x`, 'X')}${num(`squares.${i}.y`, 'Y')}
      </div>
      <button class="ed-small" data-remove="${i}">Remove</button>
    </div>`).join('')}
    <button class="ed-small" id="add-square">+ Add square</button>

    <h2>Motion</h2>
    <div class="ed-group">
      <div class="ed-row two">${num('motion.gravity', 'Gravity', 0.5)}${num('motion.seed', 'Random seed')}</div>
      <div class="ed-row two">${num('motion.letterBounce', 'Letter bounce', 0.02)}${num('motion.squareBounce', 'Square bounce', 0.02)}</div>
      <div class="ed-row">${num('motion.greetingGap', 'Greeting gap', 0.01)}${num('motion.nameGap', 'Name gap', 0.01)}${num('motion.squareGap', 'Square gap', 0.01)}</div>
    </div>

    <details>
      <summary>Layout &amp; colours</summary>
      <div class="ed-group">
        <div class="ed-row">${num('width', 'Width')}${num('height', 'Height')}${num('radius', 'Corners')}${num('rule.y', 'Line Y')}</div>
        <div class="ed-row">${color('colors.blue', 'Blue')}${color('colors.orange', 'Orange')}${color('colors.yellow', 'Yellow')}</div>
      </div>
      ${Object.keys(cfg.themes).map((t) => `<div class="ed-group"><strong>${t}</strong>
        <div class="ed-row">${color(`themes.${t}.bg`, 'Background')}${color(`themes.${t}.ink`, 'Name')}${color(`themes.${t}.muted`, 'Greeting')}${color(`themes.${t}.outline`, 'Outline')}</div>
      </div>`).join('')}
    </details>`;
  syncPanel();
}

function syncPanel() {
  for (const el of panel.querySelectorAll('[data-path]')) {
    if (el !== document.activeElement) el.value = get(el.dataset.path);
  }
}

panel.addEventListener('input', (e) => {
  const el = e.target.closest('[data-path]');
  if (!el) return;
  if (el.type === 'number') {
    if (el.value === '' || Number.isNaN(el.valueAsNumber)) return;
    set(el.dataset.path, el.valueAsNumber);
  } else {
    set(el.dataset.path, el.value);
  }
  changed();
});

panel.addEventListener('click', (e) => {
  if (e.target.id === 'add-square') {
    cfg.squares.push({ color: 'blue', x: cfg.width - 200, y: 60, size: 80 });
  } else if (e.target.dataset.remove) {
    cfg.squares.splice(Number(e.target.dataset.remove), 1);
  } else {
    return;
  }
  buildPanel();
  changed();
});

// ---- dragging ---------------------------------------------------------------
function partConfig(part) {
  if (part.startsWith('square:')) return cfg.squares[Number(part.slice(7))];
  return cfg[part];
}

canvas.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-part]');
  if (!el) return;
  e.preventDefault();
  const target = partConfig(el.dataset.part);
  const toSvg = canvas.querySelector('svg').getScreenCTM().inverse();
  const point = (ev) => new DOMPoint(ev.clientX, ev.clientY).matrixTransform(toSvg);
  const start = point(e);
  const origin = { x: target.x, y: target.y };
  render(false);

  const move = (ev) => {
    const p = point(ev);
    target.x = Math.round(origin.x + p.x - start.x);
    target.y = Math.round(origin.y + p.y - start.y);
    changed();
    syncPanel();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

// ---- toolbar ----------------------------------------------------------------
document.getElementById('play').addEventListener('click', () => render(true));

themeButton.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  themeButton.textContent = theme === 'light' ? 'Dark' : 'Light';
  canvas.classList.toggle('is-dark', theme === 'dark');
  render(true);
});

document.getElementById('reroll').addEventListener('click', () => {
  cfg.motion.seed = Math.floor(Math.random() * 100000) + 1;
  dirty = true;
  status.textContent = 'Unsaved changes';
  syncPanel();
  render(true);
});

document.getElementById('save').addEventListener('click', async () => {
  status.textContent = 'Saving…';
  const svgs = buildBanner(fonts, cfg);
  const res = await fetch('/__save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config: cfg, svgs }),
  });
  if (res.ok) {
    dirty = false;
    status.textContent = 'Saved ✓';
  } else {
    status.textContent = `Save failed: ${await res.text()}`;
  }
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

// ---- boot -------------------------------------------------------------------
cfg = await (await fetch('/banner.config.json', { cache: 'no-store' })).json();
for (const [key, file] of Object.entries(cfg.fonts)) {
  fonts[key] = opentype.parse(await (await fetch(`/${file}`)).arrayBuffer());
}
buildPanel();
render(true);
