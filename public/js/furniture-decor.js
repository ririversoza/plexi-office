// Agents' own decorations (chosen with `plexi decor`, see decor-catalog.js):
// up to three things on their desk, and a blanket, pillow, plushie and fairy lights on their bed.
import { box, cylinder, ellipse, iso, shade } from './iso.js';
import { COLORS } from './decor-catalog.js';

const Z = 0.77; // desk top
const OUT = 'rgba(0,0,0,.2)';
const LIGHT_BULBS = ['#FDE68A', '#F9A8D4', '#93C5FD', '#A7F3D0'];

// Agents' own SVG drawings, loaded once as images (so they can only ever draw, never run).
const sprites = new Map();
const DESK_SPRITE_PX = 24;
const BED_SPRITE_PX = 20;

function spriteImage(owner, slot) {
  const version = owner?.agent?.decor?.sprites?.[slot];
  if (!version) return null;
  const url = `/api/sprites/${encodeURIComponent(owner.agent.id)}/${slot}.svg?v=${encodeURIComponent(version)}`;
  let entry = sprites.get(url);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false };
    img.onload = () => { entry.ready = true; };
    img.src = url;
    sprites.set(url, entry);
  }
  return entry.ready ? entry.img : null;
}

/** Stands the drawing on the point (x, y, z): bottom-centre anchored, aspect kept. */
function drawSprite(ctx, img, x, y, z, size) {
  const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
  const w = size * Math.min(1, ratio);
  const h = size * Math.min(1, 1 / ratio);
  const [sx, sy] = iso(x, y, z);
  ctx.drawImage(img, sx - w / 2, sy - h + 1, w, h);
}

export function decorColor(key, fallback) {
  return (key && COLORS[key]) || fallback;
}

function leaves(ctx, x, y, z, color, r = 5.5) {
  const [lx, ly] = iso(x, y, z);
  ellipse(ctx, lx - 3, ly + 1, r * 0.7, r * 0.6, shade(color, -0.1), OUT);
  ellipse(ctx, lx + 3, ly, r * 0.7, r * 0.6, color, OUT);
  ellipse(ctx, lx, ly - 3, r * 0.7, r * 0.65, shade(color, 0.1), OUT);
}

const DESK_DRAWERS = {
  plant: (ctx, x, y, c) => {
    cylinder(ctx, x, y, 0.08, Z, 0.1, c);
    leaves(ctx, x, y, Z + 0.24, '#7DBB6E');
  },
  cactus: (ctx, x, y, c) => {
    cylinder(ctx, x, y, 0.06, Z, 0.07, c);
    cylinder(ctx, x, y, 0.035, Z + 0.07, 0.14, '#6FAF62', { top: '#86C477' });
    const [fx, fy] = iso(x, y, Z + 0.23);
    ellipse(ctx, fx, fy, 2, 1.6, '#F9A8D4');
  },
  flowers: (ctx, x, y, c) => {
    cylinder(ctx, x, y, 0.05, Z, 0.16, c);
    for (const [dx, dy, col] of [[-3, -2, '#F9A8D4'], [3, -3, '#FDE68A'], [0, -6, '#FCA5A5']]) {
      const [fx, fy] = iso(x, y, Z + 0.26);
      ellipse(ctx, fx + dx, fy + dy, 2.6, 2.4, col, OUT);
    }
  },
  lamp: (ctx, x, y, c, env, lit) => {
    cylinder(ctx, x, y, 0.07, Z, 0.02, '#4B5563');
    const [bx, by] = iso(x, y, Z + 0.02);
    const [tx, ty] = iso(x, y, Z + 0.3);
    ctx.strokeStyle = '#4B5563';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    if (lit) ellipse(ctx, tx, ty + 7, 11, 5, 'rgba(253,230,138,.35)');
    ctx.beginPath();
    ctx.moveTo(tx - 4, ty - 4);
    ctx.lineTo(tx + 4, ty - 4);
    ctx.lineTo(tx + 7, ty + 3);
    ctx.lineTo(tx - 7, ty + 3);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1;
    ctx.stroke();
  },
  photo: (ctx, x, y, c) => {
    box(ctx, x - 0.1, y, 0.2, 0.03, Z, 0.17, c);
    const [px, py] = iso(x, y + 0.03, Z + 0.09);
    ctx.fillStyle = '#FFF7E6';
    ctx.fillRect(px - 4.5, py - 3.5, 9, 6);
    ellipse(ctx, px - 1, py - 1, 1.6, 1.6, '#F9A8D4');
    ellipse(ctx, px + 2, py, 1.6, 1.6, '#93C5FD');
  },
  books: (ctx, x, y, c) => {
    box(ctx, x - 0.12, y - 0.08, 0.24, 0.16, Z, 0.04, c);
    box(ctx, x - 0.1, y - 0.07, 0.21, 0.14, Z + 0.04, 0.035, '#FCA5A5');
    box(ctx, x - 0.11, y - 0.06, 0.2, 0.13, Z + 0.075, 0.035, '#FDE68A');
  },
  duck: (ctx, x, y) => {
    const [dx, dy] = iso(x, y, Z + 0.05);
    ellipse(ctx, dx, dy, 5.5, 4, '#FACC15', OUT);
    ellipse(ctx, dx + 2.5, dy - 4.5, 3.2, 3, '#FDE047', OUT);
    ellipse(ctx, dx + 5.6, dy - 4, 1.8, 1, '#F97316');
    ellipse(ctx, dx + 3.3, dy - 5.2, 0.6, 0.6, '#1F2937');
  },
  figurine: (ctx, x, y, c) => {
    cylinder(ctx, x, y, 0.04, Z, 0.1, c);
    const [hx, hy] = iso(x, y, Z + 0.17);
    ellipse(ctx, hx, hy, 3.4, 3.4, '#FCE3D6', OUT);
    ellipse(ctx, hx, hy - 2, 3.5, 2, shade(c, -0.3));
  },
  snacks: (ctx, x, y, c) => {
    cylinder(ctx, x, y, 0.07, Z, 0.14, 'rgba(225,240,255,.9)', { top: c });
    const [sx, sy] = iso(x, y, Z + 0.06);
    for (const [ox, oy, col] of [[-2, 0, '#F97316'], [2, -1, '#F9A8D4'], [0, -3, '#FDE68A']]) ellipse(ctx, sx + ox, sy + oy, 1.6, 1.4, col);
  },
  trophy: (ctx, x, y) => {
    box(ctx, x - 0.05, y - 0.05, 0.1, 0.1, Z, 0.04, '#B08968');
    cylinder(ctx, x, y, 0.015, Z + 0.04, 0.06, '#EAB308');
    const [tx, ty] = iso(x, y, Z + 0.15);
    ellipse(ctx, tx, ty, 4.5, 3.5, '#FACC15', OUT);
    ellipse(ctx, tx - 1.5, ty - 1, 1.2, 0.8, '#FEF9C3');
  },
  mug: (ctx, x, y, c) => {
    cylinder(ctx, x, y, 0.07, Z, 0.14, c, { top: '#6B4A2F' });
  },
  custom: (ctx, x, y, c, env, lit, owner) => {
    const img = spriteImage(owner, 'desk');
    if (img) drawSprite(ctx, img, x, y, Z, DESK_SPRITE_PX);
  },
};

/**
 * Three spots on the desk clear of the monitor and keyboard. When the screen faces away
 * it sits on the near edge, so items go beside it (both near corners, then far right).
 */
function deskSlots(f) {
  if (f.side === 'A') {
    const py = f.y + 0.35;
    return [[f.x + 0.26, py], [f.x + f.w - 0.26, py], [f.x + 0.26, py + 0.28]];
  }
  const near = f.y + f.d - 0.22;
  return [[f.x + 0.2, near], [f.x + f.w - 0.2, near], [f.x + f.w - 0.24, f.y + 0.3]];
}

/** Returns true when the owner has decorated (so the desk's default prop is skipped). */
export function drawDeskDecor(ctx, f, owner, env) {
  const decor = owner?.agent?.decor?.desk;
  if (!decor?.items?.length) return false;
  const accent = decorColor(decor.color, owner.style?.color || '#C4B5FD');
  const lit = owner.state === 'working';
  const placed = decor.items.slice(0, 3).map((item, i) => [item, ...deskSlots(f)[i]]);
  placed.sort((a, b) => a[1] + a[2] - (b[1] + b[2]));
  for (const [item, x, y] of placed) DESK_DRAWERS[item]?.(ctx, x, y, accent, env, lit, owner);
  return true;
}

export function bedColors(f, owner) {
  const bed = owner?.agent?.decor?.bed;
  return { blanket: decorColor(bed?.blanket, null), pillow: decorColor(bed?.pillow, null) };
}

const PLUSH_DRAWERS = {
  bear: (ctx, x, y) => {
    ellipse(ctx, x, y + 3, 5, 4.5, '#B08968', OUT);
    ellipse(ctx, x, y - 3, 4.2, 4, '#C49A74', OUT);
    for (const s of [-1, 1]) ellipse(ctx, x + s * 3.4, y - 6.2, 1.6, 1.6, '#B08968', OUT);
    ellipse(ctx, x, y - 2, 1.6, 1.1, '#F1DFC4');
  },
  cat: (ctx, x, y) => {
    ellipse(ctx, x, y + 3, 5, 4.2, '#9CA3AF', OUT);
    ellipse(ctx, x, y - 3, 4.2, 3.8, '#B6BCC6', OUT);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * 1.5, y - 6);
      ctx.lineTo(x + s * 4, y - 8.5);
      ctx.lineTo(x + s * 4, y - 4.5);
      ctx.closePath();
      ctx.fillStyle = '#B6BCC6';
      ctx.fill();
    }
  },
  bunny: (ctx, x, y) => {
    for (const s of [-1, 1]) ellipse(ctx, x + s * 1.8, y - 8, 1.4, 3.6, '#FFFFFF', OUT);
    ellipse(ctx, x, y + 3, 5, 4.2, '#FFFFFF', OUT);
    ellipse(ctx, x, y - 3, 4, 3.8, '#FFFFFF', OUT);
    ellipse(ctx, x, y - 2.4, 1, 0.7, '#F9A8D4');
  },
  duck: (ctx, x, y) => {
    ellipse(ctx, x, y + 2, 5.5, 4, '#FACC15', OUT);
    ellipse(ctx, x + 2, y - 3, 3.4, 3.2, '#FDE047', OUT);
    ellipse(ctx, x + 5, y - 2.5, 1.8, 1, '#F97316');
  },
  dino: (ctx, x, y) => {
    ellipse(ctx, x, y + 2.5, 5.5, 4, '#86EFAC', OUT);
    ellipse(ctx, x + 3, y - 3, 3.4, 3, '#86EFAC', OUT);
    for (const k of [0, 1, 2]) ellipse(ctx, x - 3 + k * 2.4, y - 1.5 - k * 0.6, 1.1, 1.3, '#4ADE80');
  },
};

/** The plushie sits on the pillow's left corner, next to (not on) the sleeper. */
export function drawPlush(ctx, f, owner) {
  const plush = owner?.agent?.decor?.bed?.plush;
  if (plush === 'custom') {
    const img = spriteImage(owner, 'bed');
    if (img) drawSprite(ctx, img, f.x + 0.22, f.y + 0.32, 0.6, BED_SPRITE_PX);
    return;
  }
  const draw = PLUSH_DRAWERS[plush];
  if (!draw) return;
  const [x, y] = iso(f.x + 0.2, f.y + 0.3, 0.64);
  draw(ctx, x, y);
}

/** A string of twinkling bulbs along the headboard. */
export function drawFairyLights(ctx, f, owner, t = 0) {
  if (!owner?.agent?.decor?.bed?.lights) return;
  const count = 7;
  ctx.strokeStyle = 'rgba(75,85,99,.6)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i <= count; i++) {
    const [lx, ly] = iso(f.x + (f.w * i) / count, f.y + 0.05, 0.98 - Math.sin((i / count) * Math.PI) * 0.1);
    if (i === 0) ctx.moveTo(lx, ly);
    else ctx.lineTo(lx, ly);
  }
  ctx.stroke();
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const [lx, ly] = iso(f.x + f.w * u, f.y + 0.05, 0.96 - Math.sin(u * Math.PI) * 0.1);
    const glow = 0.55 + 0.45 * Math.sin(t * 2.2 + i * 1.7);
    ctx.globalAlpha = glow;
    ellipse(ctx, lx, ly + 1.5, 3.4, 3.4, 'rgba(253,230,138,.35)');
    ctx.globalAlpha = 1;
    ellipse(ctx, lx, ly + 1.5, 1.6, 1.8, LIGHT_BULBS[i % LIGHT_BULBS.length]);
  }
}
