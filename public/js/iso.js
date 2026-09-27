// Isometric projection + primitive drawing. World units are tiles; z is height.
export const TW = 72;   // tile width in px
export const TH = 36;   // tile height in px
export const ZU = 36;   // px per unit of height

export function iso(x, y, z = 0) {
  return [(x - y) * (TW / 2), (x + y) * (TH / 2) - z * ZU];
}

/** Inverse of iso() on the ground plane. */
export function unIso(sx, sy) {
  const a = sx / (TW / 2);
  const b = sy / (TH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

function hexToRgb(color) {
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const h = color.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const shadeCache = new Map();

/** Lighten (amt > 0) or darken (amt < 0) a hex or rgb() color. */
export function shade(hex, amt) {
  const key = `${hex}|${amt}`;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  const out = `rgb(${f(r)},${f(g)},${f(b)})`;
  shadeCache.set(key, out);
  return out;
}

export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

export const EDGE = 'rgba(60,50,70,0.18)';

/**
 * Axis-aligned box. Visible faces: top, south (+y, faces down-left),
 * east (+x, faces down-right).
 */
export function box(ctx, x, y, w, d, z, h, color, opts = {}) {
  const top = [iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)];
  const south = [iso(x, y + d, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x, y + d, z)];
  const east = [iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x + w, y, z)];
  const alpha = opts.alpha ?? 1;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * alpha;
  ctx.lineWidth = opts.lineWidth ?? 1;
  ctx.strokeStyle = opts.stroke || EDGE;
  const faces = [
    [south, opts.south ?? shade(color, -0.1)],
    [east, opts.east ?? shade(color, -0.22)],
    [top, opts.top ?? color],
  ];
  for (const [pts, fill] of faces) {
    poly(ctx, pts);
    ctx.fillStyle = fill;
    ctx.fill();
    if (opts.stroke !== false) ctx.stroke();
  }
  ctx.globalAlpha = prevAlpha;
}

/** Flat quad lying on plane z. */
export function floorQuad(ctx, x, y, w, d, z, fill, stroke) {
  poly(ctx, [iso(x, y, z), iso(x + w, y, z), iso(x + w, y + d, z), iso(x, y + d, z)]);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Upright cylinder centred on (cx, cy). */
export function cylinder(ctx, cx, cy, r, z, h, color, opts = {}) {
  const rx = (r * TW) / Math.SQRT2;
  const ry = (r * TH) / Math.SQRT2;
  const [bx, by] = iso(cx, cy, z);
  const [tx, ty] = iso(cx, cy, z + h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = opts.stroke ?? EDGE;
  const grad = ctx.createLinearGradient(bx - rx, 0, bx + rx, 0);
  grad.addColorStop(0, shade(color, -0.02));
  grad.addColorStop(1, shade(color, -0.25));
  ctx.beginPath();
  ctx.moveTo(bx - rx, ty);
  ctx.lineTo(bx - rx, by);
  ctx.ellipse(bx, by, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(bx + rx, ty);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(tx, ty, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = opts.top ?? shade(color, 0.12);
  ctx.fill();
  ctx.stroke();
}

export function ellipse(ctx, x, y, rx, ry, fill, stroke, lineWidth = 1) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Runs `fn` with the context mapped onto the ground plane (1 tile = `scale` units). */
export function onFloor(ctx, z, scale, fn) {
  ctx.save();
  const [ox, oy] = iso(0, 0, z);
  ctx.transform(TW / 2 / scale, TH / 2 / scale, -TW / 2 / scale, TH / 2 / scale, ox, oy);
  fn();
  ctx.restore();
}

/**
 * Runs `fn` mapped onto the north wall face (plane y = wy, facing +y).
 * Drawing coords: x = world x * scale, y = -height * scale (so text reads upright).
 */
export function onNorthWall(ctx, wy, scale, fn) {
  ctx.save();
  const [ox, oy] = iso(0, wy, 0);
  ctx.transform(TW / 2 / scale, TH / 2 / scale, 0, ZU / scale, ox, oy);
  fn();
  ctx.restore();
}

/**
 * Runs `fn` mapped onto the west wall face (plane x = wx, facing +x).
 * Drawing coords: x = -(world y) * scale, y = -height * scale.
 */
export function onWestWall(ctx, wx, scale, fn) {
  ctx.save();
  const [ox, oy] = iso(wx, 0, 0);
  ctx.transform(TW / 2 / scale, -TH / 2 / scale, 0, ZU / scale, ox, oy);
  fn();
  ctx.restore();
}
