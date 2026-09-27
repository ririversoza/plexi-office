// Office furniture drawn with iso primitives. Each drawer gets (ctx, item, env).
// env: { t, ownerOf(seat) -> agent entity|null, memory, conflictActive, hover }
import { box, cylinder, ellipse, floorQuad, iso, onNorthWall, poly, rgba, shade } from './iso.js';
import { ROLE_STYLE, TEAMS } from './world.js';
import { ROOM_DRAWERS } from './furniture-rooms.js';
import { bedColors, drawDeskDecor, drawFairyLights, drawPlush } from './furniture-decor.js';

const WOOD = '#F1DFC4';
const METAL = '#C5CBD6';
const NAVY = '#3E4B63';
export const SCREEN_S = 100; // drawing scale inside vertical planes

export function accentFor(team) {
  return TEAMS[team]?.color || ROLE_STYLE[team]?.color || '#8A94A6';
}

function lightFor(team) {
  return TEAMS[team]?.light || ROLE_STYLE[team]?.light || '#E4E8EF';
}

/** Draws on a vertical plane facing +y (e.g. a monitor screen facing south). */
export function onSouthFace(ctx, y, fn) {
  onNorthWall(ctx, y, SCREEN_S, fn);
}

// ── monitor screens ─────────────────────────────────────────────────────────
const SCREEN_BG = { offline: '#1B1F2A', working: '#1D2536', question: '#3A331C', conflict: '#3A1C20' };

function drawCodeLines(ctx, X0, Y0, w, h, color, t, seed) {
  const rows = 7;
  const rowH = h / rows;
  const progress = t * 12 + seed * 7;
  const scroll = progress % rowH;
  ctx.save();
  ctx.beginPath();
  ctx.rect(X0, Y0, w, h);
  ctx.clip();
  for (let r = -1; r < rows + 1; r++) {
    const n = r + Math.floor(progress / rowH);
    const ly = Y0 + (r + 1) * rowH - scroll;
    const len = ((Math.sin(n * 12.9898 + seed) + 1) / 2) * 0.6 + 0.25;
    const indent = (Math.abs(n + seed) % 3) * 6;
    ctx.fillStyle = [color, '#9FB4D8', '#E6C07B'][Math.abs(n) % 3];
    ctx.fillRect(X0 + 6 + indent, ly, (w - 16 - indent) * len, 3.2);
  }
  ctx.restore();
}

function drawScreenContent(ctx, x0, x1, z0, z1, state, color, t, seed) {
  const X0 = x0 * SCREEN_S;
  const Y0 = -z1 * SCREEN_S;
  const w = (x1 - x0) * SCREEN_S;
  const h = (z1 - z0) * SCREEN_S;
  ctx.fillStyle = state === 'break' ? shade(color, -0.35) : SCREEN_BG[state] || SCREEN_BG.offline;
  ctx.fillRect(X0, Y0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (state === 'working') {
    drawCodeLines(ctx, X0, Y0, w, h, color, t, seed);
  } else if (state === 'break') {
    ctx.font = `${h * 0.45}px system-ui`;
    ctx.fillText('☕', X0 + w / 2 + Math.sin(t * 1.3 + seed) * w * 0.3, Y0 + h / 2 + Math.cos(t * 1.7 + seed) * h * 0.25);
  } else if (state === 'question' || state === 'conflict') {
    ctx.fillStyle = state === 'question' ? '#FFD35A' : '#FF6B6B';
    ctx.font = `bold ${h * 0.7}px system-ui`;
    ctx.globalAlpha = 0.6 + Math.sin(t * 5) * 0.4;
    ctx.fillText(state === 'question' ? '?' : '!', X0 + w / 2, Y0 + h / 2 + 2);
    ctx.globalAlpha = 1;
  } else {
    ellipse(ctx, X0 + w - 7, Y0 + h - 6, 2, 2, '#3A7D5C');
  }
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(X0, Y0);
  ctx.lineTo(X0 + w * 0.35, Y0);
  ctx.lineTo(X0, Y0 + h * 0.6);
  ctx.fill();
}

/** Monitor centred on mx at depth y. facingSouth → screen visible; otherwise we see its back. */
export function drawMonitor(ctx, mx, y, facingSouth, state, color, t, seed, width = 0.9, z = 0.77) {
  const half = width / 2;
  const frame = '#2F3542';
  box(ctx, mx - 0.07, y - 0.07, 0.14, 0.14, z, 0.12, METAL);
  box(ctx, mx - 0.18, y - 0.1, 0.36, 0.2, z, 0.02, METAL);
  box(ctx, mx - half, y - 0.05, width, 0.1, z + 0.09, 0.6, frame, { south: facingSouth ? frame : shade(frame, 0.1) });
  onSouthFace(ctx, y + 0.05, () => {
    if (facingSouth) {
      drawScreenContent(ctx, mx - half + 0.04, mx + half - 0.04, z + 0.13, z + 0.65, state, color, t, seed);
    } else {
      ellipse(ctx, mx * SCREEN_S, -(z + 0.4) * SCREEN_S, 5, 5, color);
    }
  });
}

function drawDesk(ctx, f, env) {
  const { x, y, w, d, team, side, seat } = f;
  const color = accentFor(team);
  const owner = env.ownerOf(seat);
  const state = owner?.state || 'offline';
  const seed = (f.k ?? 1) * 3 + (f.pod ?? 0) * 11 + (side === 'A' ? 5 : 0);
  for (const [lx, ly] of [[x + 0.05, y + d - 0.13], [x + w - 0.13, y + d - 0.13], [x + w - 0.13, y + 0.05]]) {
    box(ctx, lx, ly, 0.08, 0.08, 0, 0.7, METAL);
  }
  box(ctx, x + 0.08, y + 0.1, 0.46, d - 0.2, 0, 0.66, '#EDE7DD', { south: shade(lightFor(team), -0.05) });
  box(ctx, x, y, w, d, 0.7, 0.07, WOOD);
  const mx = x + w / 2;
  const screenFacesViewer = side === 'A';
  const kbY = screenFacesViewer ? y + d - 0.36 : y + 0.1;
  box(ctx, mx - 0.3, kbY, 0.6, 0.2, 0.77, 0.025, '#E9ECF2');
  const [mox, moy] = iso(mx + 0.45, kbY + 0.1, 0.8);
  ellipse(ctx, mox, moy, 3, 2, '#E9ECF2', 'rgba(0,0,0,.2)');
  // Decorations behind a screen that faces away are drawn first, so the monitor covers them.
  const decorBehind = !screenFacesViewer && drawDeskDecor(ctx, f, owner, env);
  drawMonitor(ctx, mx, screenFacesViewer ? y + 0.18 : y + d - 0.18, screenFacesViewer, state, color, env.t, seed);
  if (decorBehind || (screenFacesViewer && drawDeskDecor(ctx, f, owner, env))) return;
  const prop = seed % 4;
  const px = x + (screenFacesViewer ? 0.28 : w - 0.28);
  const py = screenFacesViewer ? y + 0.35 : y + d - 0.4;
  if (prop === 0) cylinder(ctx, px, py, 0.07, 0.77, 0.14, color, { top: '#6B4A2F' });
  if (prop === 1) {
    cylinder(ctx, px, py, 0.08, 0.77, 0.1, '#F4F1EA');
    const [lx, ly] = iso(px, py, 1.0);
    ellipse(ctx, lx, ly, 6, 6, '#7DBB6E', 'rgba(0,0,0,.15)');
  }
  if (prop === 2) box(ctx, px - 0.12, py - 0.08, 0.24, 0.16, 0.77, 0.08, '#F7D774');
}

function drawDivider(ctx, f) {
  const color = accentFor(f.team);
  const light = lightFor(f.team);
  box(ctx, f.x, f.y, f.w, f.d, 0, 1.25, light, { south: shade(light, -0.04), east: shade(light, -0.15) });
  box(ctx, f.x, f.y - 0.01, f.w, f.d + 0.02, 1.25, 0.05, color);
  onSouthFace(ctx, f.y + f.d + 0.001, () => {
    for (let i = 0; i < f.w; i += 1.5) {
      ctx.fillStyle = ['#FFF3A6', '#FFD1DC', '#C9F2FF'][Math.floor(i) % 3];
      ctx.fillRect((f.x + i + 0.5) * SCREEN_S, -1.12 * SCREEN_S, 18, 16);
    }
  });
}

const SEAT_HALF = 0.24;
const SEAT_Z = 0.34;
const LEG = 0.06;

/** Footprint of a chair's backrest (the side away from where the sitter faces). */
export function chairBackBox(s) {
  const alongX = s.facing === 'N' || s.facing === 'S';
  const off = { N: [0, 0.2], S: [0, -0.28], E: [-0.28, 0], W: [0.2, 0] }[s.facing] || [0, 0.2];
  return {
    x: s.x - (alongX ? SEAT_HALF : 0) + off[0],
    y: s.y - (alongX ? 0 : SEAT_HALF) + off[1],
    w: alongX ? SEAT_HALF * 2 : 0.08,
    d: alongX ? 0.08 : SEAT_HALF * 2,
  };
}

/** Four-legged chair, split so the backrest can sort in front of or behind the sitter. */
export function drawChairPart(ctx, f, part) {
  const s = f.seat;
  const color = f.color || NAVY;
  const legColor = shade(color, -0.35);
  if (part === 'base') {
    const [bx, by] = iso(s.x, s.y, 0.01);
    ellipse(ctx, bx, by, 13, 6, 'rgba(40,40,60,.18)');
    const inset = SEAT_HALF - 0.05;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      box(ctx, s.x + dx * inset - LEG / 2, s.y + dy * inset - LEG / 2, LEG, LEG, 0, SEAT_Z, legColor, { stroke: false });
    }
    box(ctx, s.x - SEAT_HALF, s.y - SEAT_HALF, SEAT_HALF * 2, SEAT_HALF * 2, SEAT_Z, 0.08, color);
    return;
  }
  const b = chairBackBox(s);
  box(ctx, b.x, b.y, b.w, b.d, SEAT_Z + 0.1, 0.52, color);
}

function drawPlant(ctx, f, env) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.d / 2;
  const s = f.size || 1;
  cylinder(ctx, cx, cy, 0.22 * s, 0, 0.38 * s, f.variant === 1 ? '#F4F1EA' : '#D98B5F', { top: '#6B4A2F' });
  const [px, py] = iso(cx, cy, 0.38 * s);
  const sway = Math.sin(env.t * 1.2 + cx) * 1.2;
  const greens = ['#5FAF6B', '#77C27F', '#4E9A5B'];
  const leafEdge = 'rgba(30,70,40,.35)';
  if (f.variant === 1) {
    for (let i = -2; i <= 2; i++) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(i * 0.32 + sway * 0.02);
      ellipse(ctx, 0, -18 * s, 5 * s, 17 * s, greens[(i + 3) % 3], leafEdge);
      ctx.restore();
    }
    return;
  }
  const blobs = f.variant === 2
    ? [[-9, -14, 11], [9, -16, 12], [0, -28, 12], [-4, -8, 9]]
    : [[-8, -12, 10], [8, -12, 10], [0, -22, 12], [0, -10, 10]];
  blobs.forEach(([dx, dy, r], i) => {
    ellipse(ctx, px + dx * s + sway * 0.6, py + dy * s, r * s, r * (f.variant === 2 ? 0.75 : 1) * s, greens[i % 3], leafEdge);
  });
  ellipse(ctx, px - 4 * s, py - 26 * s, 4 * s, 3 * s, 'rgba(255,255,255,.25)');
}

function drawWaterCooler(ctx, f) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.d / 2;
  box(ctx, cx - 0.25, cy - 0.25, 0.5, 0.5, 0, 0.95, '#F2F4F8');
  box(ctx, cx - 0.12, cy + 0.2, 0.24, 0.06, 0.55, 0.12, '#8FA3B8');
  cylinder(ctx, cx, cy, 0.2, 0.95, 0.55, '#8ED1F5', { top: '#B7E5FB' });
  const [hx, hy] = iso(cx, cy, 1.25);
  ellipse(ctx, hx - 3, hy, 3, 8, 'rgba(255,255,255,.35)');
}

function drawPrinter(ctx, f) {
  box(ctx, f.x, f.y, f.w, f.d, 0, 0.75, '#DDE2EA');
  box(ctx, f.x + 0.1, f.y + 0.1, f.w - 0.2, f.d - 0.3, 0.75, 0.18, '#C3CAD6');
  box(ctx, f.x + 0.3, f.y + f.d - 0.25, f.w - 0.6, 0.3, 0.5, 0.03, '#FFFFFF');
  const [lx, ly] = iso(f.x + f.w - 0.2, f.y + f.d, 0.85);
  ellipse(ctx, lx, ly, 2, 2, '#4ADE80');
}

/** Four legs under a rectangular top, set in from the corners. */
export function drawLegs(ctx, f, height, color, thickness = 0.1, inset = 0.08) {
  const xs = [f.x + inset, f.x + f.w - inset - thickness];
  const ys = [f.y + inset, f.y + f.d - inset - thickness];
  for (const ly of ys) for (const lx of xs) box(ctx, lx, ly, thickness, thickness, 0, height, color);
}

function drawBench(ctx, f) {
  const color = f.color || '#9AB7D3';
  drawLegs(ctx, f, 0.36, shade(color, -0.4), 0.1, 0.12);
  box(ctx, f.x, f.y, f.w, f.d, 0.36, 0.1, color);
  // slats
  const along = f.axis === 'y';
  for (let k = 1; k < 3; k++) {
    const [ax, ay] = iso(along ? f.x + (f.w * k) / 3 : f.x, along ? f.y : f.y + (f.d * k) / 3, 0.461);
    const [bx, by] = iso(along ? f.x + (f.w * k) / 3 : f.x + f.w, along ? f.y + f.d : f.y + (f.d * k) / 3, 0.461);
    ctx.strokeStyle = shade(color, -0.18);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
}

function drawKanban(ctx, f) {
  box(ctx, f.x + 0.1, f.y + 0.1, 0.08, 0.08, 0, 0.5, '#6B7280');
  box(ctx, f.x + f.w - 0.2, f.y + 0.1, 0.08, 0.08, 0, 0.5, '#6B7280');
  box(ctx, f.x, f.y, f.w, 0.12, 0.5, 1.5, '#FFFFFF', { east: '#D5DAE3' });
  onSouthFace(ctx, f.y + 0.121, () => {
    const X0 = f.x * SCREEN_S;
    const colW = (f.w * SCREEN_S) / 3;
    ctx.font = 'bold 13px Fredoka, system-ui';
    ctx.textAlign = 'center';
    ['TODO', 'DOING', 'DONE'].forEach((label, i) => {
      const cx = X0 + (i + 0.5) * colW;
      ctx.fillStyle = '#4B5563';
      ctx.fillText(label, cx, -1.82 * SCREEN_S);
      for (let n = 0; n < 4 - i; n++) {
        ctx.fillStyle = ['#FFE58F', '#FFC2D4', '#B9F3D0', '#BAE6FD'][(i + n) % 4];
        ctx.fillRect(cx - 40 + (n % 2) * 42, -1.7 * SCREEN_S + Math.floor(n / 2) * 32, 36, 26);
      }
    });
    ctx.fillStyle = '#E5E7EB';
    for (let i = 1; i < 3; i++) ctx.fillRect(X0 + i * colW, -1.95 * SCREEN_S, 2, 1.4 * SCREEN_S);
  });
}

function drawLamp(ctx, f, env) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.d / 2;
  cylinder(ctx, cx, cy, 0.18, 0, 0.05, '#4B5563');
  box(ctx, cx - 0.03, cy - 0.03, 0.06, 0.06, 0.05, 1.6, '#4B5563', { stroke: false });
  cylinder(ctx, cx, cy, 0.26, 1.55, 0.3, '#FFF1C9');
  const [gx, gy] = iso(cx, cy, 1.5);
  const glow = ctx.createRadialGradient(gx, gy, 2, gx, gy, 46);
  glow.addColorStop(0, `rgba(255,230,160,${0.25 + Math.sin(env.t) * 0.03})`);
  glow.addColorStop(1, 'rgba(255,230,160,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(gx - 46, gy - 46, 92, 92);
}

function drawSign(ctx, f) {
  const cx = f.x + f.w / 2;
  box(ctx, cx - 0.03, f.y + 0.1, 0.06, 0.06, 0, 0.9, '#6B7280');
  box(ctx, f.x, f.y, f.w, 0.08, 0.9, 0.5, '#FFFFFF', { east: '#D5DAE3' });
  onSouthFace(ctx, f.y + 0.081, () => {
    ctx.fillStyle = f.color;
    ctx.fillRect(f.x * SCREEN_S, -1.4 * SCREEN_S, f.w * SCREEN_S, 10);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#374151';
    ctx.font = 'bold 15px Fredoka, system-ui';
    ctx.fillText(f.text, cx * SCREEN_S, -1.1 * SCREEN_S);
    ctx.font = '10px Nunito, system-ui';
    ctx.fillStyle = '#6B7280';
    ctx.fillText(f.sub || '', cx * SCREEN_S, -0.97 * SCREEN_S);
  });
}

function drawServerRack(ctx, f, env) {
  const mem = env.memory || {};
  const hovered = env.hover === 'memory';
  box(ctx, f.x, f.y, f.w, f.d, 0, 2.1, '#2A2F3D', {
    top: '#3A4153', east: '#1E2230', stroke: hovered ? '#A99BFF' : undefined, lineWidth: hovered ? 2.5 : 1,
  });
  const led = mem.connected ? '#4ADE80' : mem.running ? '#FBBF24' : '#F87171';
  onSouthFace(ctx, f.y + f.d + 0.001, () => {
    for (let u = 0; u < 9; u++) {
      const yy = -(0.2 + u * 0.21) * SCREEN_S;
      ctx.fillStyle = '#353B4C';
      ctx.fillRect(f.x * SCREEN_S + 6, yy - 14, f.w * SCREEN_S - 12, 14);
      for (let k = 0; k < 4; k++) {
        const on = mem.connected ? Math.sin(env.t * (6 + k) + u * 1.7 + f.x) > -0.2 : k === 0;
        ctx.fillStyle = on ? led : '#1F2330';
        ctx.fillRect(f.x * SCREEN_S + 12 + k * 9, yy - 9, 5, 4);
      }
    }
  });
  if (mem.connected || hovered) {
    const [gx, gy] = iso(f.x + f.w / 2, f.y + f.d / 2, 2.2);
    ctx.fillStyle = rgba('#8B7CF6', 0.25 + Math.sin(env.t * 2) * 0.1);
    ctx.beginPath();
    ctx.ellipse(gx, gy, 26, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRug(ctx, f) {
  floorQuad(ctx, f.x, f.y, f.w, f.d, 0.005, f.color);
  floorQuad(ctx, f.x + 0.2, f.y + 0.2, f.w - 0.4, f.d - 0.4, 0.006, 'rgba(0,0,0,0)', rgba('#FFFFFF', 0.55));
}

function drawDoormat(ctx, f) {
  floorQuad(ctx, f.x, f.y, f.w, f.d, 0.005, '#C98B5A');
  poly(ctx, [iso(f.x + 0.1, f.y + 0.1, 0.006), iso(f.x + f.w - 0.1, f.y + 0.1, 0.006), iso(f.x + f.w - 0.1, f.y + f.d - 0.1, 0.006), iso(f.x + 0.1, f.y + f.d - 0.1, 0.006)]);
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.stroke();
}

const DRAWERS = {
  desk: drawDesk,
  divider: drawDivider,
  plant: drawPlant,
  waterCooler: drawWaterCooler,
  printer: drawPrinter,
  bench: drawBench,
  kanban: drawKanban,
  lamp: drawLamp,
  sign: drawSign,
  serverRack: drawServerRack,
  rug: drawRug,
  doormat: drawDoormat,
  ...ROOM_DRAWERS,
};

/** Beds are drawn in two parts: the frame goes behind the sleeper, the blanket over them. */
export function drawBedPart(ctx, f, part, env = {}) {
  const { x, y, w, d, spot } = f;
  const owner = env.bedOwnerOf?.(spot) || null;
  const colors = bedColors(f, owner);
  if (f.kind === 'bedroll') {
    if (part === 'base') {
      box(ctx, x, y, w, d, 0, 0.06, '#E0E7FF');
      box(ctx, x + 0.05, y + 0.05, 0.3, d - 0.1, 0.06, 0.08, colors.pillow || '#FFFFFF');
    } else {
      box(ctx, spot.x - 0.05, y + 0.02, x + w - spot.x + 0.03, d - 0.04, 0.06, 0.12, colors.blanket || '#A5B4FC');
    }
    return;
  }
  if (part === 'base') {
    for (const [lx, ly] of [[x + 0.05, y + d - 0.14], [x + w - 0.14, y + d - 0.14], [x + w - 0.14, y + 0.05]]) {
      box(ctx, lx, ly, 0.09, 0.09, 0, 0.2, '#8B6B4E');
    }
    box(ctx, x, y, w, d, 0.2, 0.15, '#B08968');
    box(ctx, x + 0.03, y + 0.03, w - 0.06, d - 0.06, 0.35, 0.14, '#FAFAFA');
    box(ctx, x, y - 0.02, w, 0.14, 0.2, 0.8, '#9C7A5B');
    box(ctx, x + 0.12, y + 0.14, w - 0.24, 0.36, 0.49, 0.12, colors.pillow || '#FFFFFF');
    drawFairyLights(ctx, f, owner, env.t);
    return;
  }
  const blanket = colors.blanket || f.blanket;
  const top = spot.y + 0.12;
  box(ctx, x + 0.02, top, w - 0.04, y + d - top - 0.02, 0.45, 0.2, blanket);
  box(ctx, x + 0.02, top, w - 0.04, 0.14, 0.45, 0.22, shade(blanket, 0.35));
  drawPlush(ctx, f, owner);
}

/** Items drawn flat in the floor pass instead of depth-sorted. */
export const FLOOR_KINDS = new Set(['rug', 'doormat']);

export function drawFurniture(ctx, f, env) {
  DRAWERS[f.kind]?.(ctx, f, env);
}
