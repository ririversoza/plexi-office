// Static scene: floor slab, room floors, team zones, back walls with decor, glass partitions.
import { box, floorQuad, iso, onFloor, onNorthWall, onWestWall, rgba } from './iso.js';
import { DORM, ELEVATOR, H, ROOMS, TEAMS, W, ZONES, glassSegments } from './world.js';

const WALL_H = 3;
const WALL_S = 100; // drawing scale on wall planes
const GLASS_H = 1.9;

function checker(ctx, x0, y0, x1, y1, [a, b]) {
  for (let i = x0; i < x1; i++) {
    for (let j = y0; j < y1; j++) floorQuad(ctx, i, j, 1, 1, 0, (i + j) % 2 ? a : b);
  }
}

function floorText(ctx, x, y, text, color, size = 44) {
  onFloor(ctx, 0.01, 60, () => {
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px Fredoka, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x * 60, y * 60);
  });
}

export function drawFloor(ctx) {
  box(ctx, 0, 0, W, H, -0.45, 0.45, '#CBD7E4', { south: '#B7C5D6', east: '#A5B5C9' });
  checker(ctx, 0, 8, W, H, ['#E9EFF5', '#E3EAF1']);
  for (let i = 0; i < W; i++) floorQuad(ctx, i, 8, 1, 2, 0.001, i % 2 ? '#EEF3F8' : '#EAF0F6');
  for (const room of Object.values(ROOMS)) checker(ctx, room.x0, room.y0, room.x1, room.y1, room.floor);
  for (const [team, z] of Object.entries(ZONES)) {
    const t = TEAMS[team];
    floorQuad(ctx, z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0, 0.004, rgba(t.color, 0.1), rgba(t.color, 0.35));
    floorText(ctx, (z.x0 + z.x1) / 2, z.y1 + 0.55, `${t.icon}  ${t.label.toUpperCase()}`, rgba(t.color, 0.55));
  }
  floorText(ctx, 15, 25.2, 'WELCOME TO PLEXI', 'rgba(255,255,255,.75)', 26);
}

// ── wall decor ──────────────────────────────────────────────────────────────
function windowOnWall(ctx, x0, w, t) {
  const X = x0 * WALL_S;
  const Wd = w * WALL_S;
  const top = -2.55 * WALL_S;
  const h = 1.35 * WALL_S;
  const sky = ctx.createLinearGradient(0, top, 0, top + h);
  sky.addColorStop(0, '#9FD3F2');
  sky.addColorStop(1, '#DDF1FB');
  ctx.fillStyle = sky;
  ctx.fillRect(X, top, Wd, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(X, top, Wd, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  const drift = (t * 4) % (Wd + 80);
  for (const [cx, cy, r] of [[20, 40, 14], [42, 34, 18], [64, 42, 12]]) {
    ctx.beginPath();
    ctx.arc(X - 40 + ((cx + drift) % (Wd + 80)), top + cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#7FB069';
  ctx.fillRect(X, top + h - 16, Wd, 16);
  ctx.restore();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 6;
  ctx.strokeRect(X, top, Wd, h);
  ctx.beginPath();
  ctx.moveTo(X + Wd / 2, top);
  ctx.lineTo(X + Wd / 2, top + h);
  ctx.stroke();
}

function whiteboard(ctx, x0, w, t, active) {
  const X = x0 * WALL_S;
  const top = -2.45 * WALL_S;
  const Wd = w * WALL_S;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(X, top, Wd, 1.4 * WALL_S);
  ctx.strokeStyle = '#B8C0CC';
  ctx.lineWidth = 5;
  ctx.strokeRect(X, top, Wd, 1.4 * WALL_S);
  ctx.font = '600 17px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  const lines = [
    ['#E5534B', '<<<<<<< HEAD'],
    ['#374151', '  const answer = 42;'],
    ['#6B7280', '======='],
    ['#2F9E6E', '  const answer = fortyTwo();'],
    ['#6B7280', '>>>>>>> feature/refactor'],
  ];
  lines.forEach(([color, text], i) => {
    ctx.fillStyle = color;
    ctx.fillText(text, X + 18, top + 30 + i * 24);
  });
  if (active) {
    ctx.strokeStyle = `rgba(229,83,75,${0.5 + Math.sin(t * 6) * 0.4})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(X + Wd * 0.28, top + 26, 90, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function clock(ctx, cx, cy) {
  const now = new Date();
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#E9A23B';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const hand = (angle, len, width) => {
    ctx.lineWidth = width;
    ctx.strokeStyle = '#374151';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(angle) * len, cy - Math.cos(angle) * len);
    ctx.stroke();
  };
  hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 15, 4);
  hand(now.getMinutes() * (Math.PI / 30), 23, 3);
}

function poster(ctx, x, y, w, h, bg, title, sub) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 5;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.font = '700 20px Fredoka, system-ui';
  ctx.fillText(title, x + w / 2, y + h / 2);
  if (sub) {
    ctx.font = '600 12px Nunito, system-ui';
    ctx.fillText(sub, x + w / 2, y + h / 2 + 20);
  }
}

function menuBoard(ctx, x, y) {
  ctx.fillStyle = '#2F3B35';
  ctx.fillRect(x, y, 150, 100);
  ctx.strokeStyle = '#C79B72';
  ctx.lineWidth = 6;
  ctx.strokeRect(x, y, 150, 100);
  ctx.fillStyle = '#F8FAFC';
  ctx.textAlign = 'left';
  ctx.font = '700 15px Fredoka, system-ui';
  ctx.fillText("TODAY'S BREWS", x + 14, y + 24);
  ctx.font = '13px Nunito, system-ui';
  ['☕ token latte', '🍵 context chai', '🧋 boba fetch'].forEach((line, i) => ctx.fillText(line, x + 14, y + 48 + i * 18));
}

/** Elevator doors on the west wall, shared by both floors. */
function elevatorDoors(ctx, label, t, riding) {
  const x0 = -(ELEVATOR.y + 0.65) * WALL_S;
  const w = 1.3 * WALL_S;
  const top = -2.15 * WALL_S;
  const h = 2.15 * WALL_S;
  ctx.fillStyle = '#AEB7C6';
  ctx.fillRect(x0 - 8, top - 8, w + 16, h + 8);
  ctx.fillStyle = '#D5DCE6';
  ctx.fillRect(x0, top, w / 2 - 2, h);
  ctx.fillRect(x0 + w / 2 + 2, top, w / 2 - 2, h);
  ctx.strokeStyle = 'rgba(0,0,0,.15)';
  ctx.strokeRect(x0, top, w, h);
  ctx.fillStyle = '#374151';
  ctx.fillRect(x0 + w / 2 - 34, top - 36, 68, 22);
  ctx.fillStyle = riding ? `rgba(253,224,71,${0.6 + Math.sin(t * 8) * 0.4})` : '#FDE047';
  ctx.font = '700 13px Fredoka, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(label, x0 + w / 2, top - 20);
}

function nightWindow(ctx, x0, w, t) {
  const X = x0 * WALL_S;
  const Wd = w * WALL_S;
  const top = -2.2 * WALL_S;
  const h = 1.2 * WALL_S;
  const sky = ctx.createLinearGradient(0, top, 0, top + h);
  sky.addColorStop(0, '#1E1B4B');
  sky.addColorStop(1, '#4338CA');
  ctx.fillStyle = sky;
  ctx.fillRect(X, top, Wd, h);
  for (let i = 0; i < 9; i++) {
    const sx = X + ((i * 37) % Wd);
    const sy = top + 10 + ((i * 23) % (h - 20));
    ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i))})`;
    ctx.fillRect(sx, sy, 2.5, 2.5);
  }
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 6;
  ctx.strokeRect(X, top, Wd, h);
}

/** 2nd floor: deck, walls, windows. Drawn with the context already raised to FLOOR2_Z. */
export function drawDorm(ctx, env) {
  const w = DORM.x1 - DORM.x0;
  const d = DORM.y1 - DORM.y0;
  box(ctx, DORM.x0, DORM.y0, w, d, -0.45, 0.45, '#A9A3D9', { south: '#8E88C9', east: '#7B74B8' });
  checker(ctx, DORM.x0, DORM.y0, DORM.x1, DORM.y1, ['#ECE8FB', '#E3DEF8']);
  box(ctx, DORM.x0, DORM.y0 - 0.22, w, 0.22, 0, WALL_H, '#F6F4FC', { south: '#E7E3F7', stroke: 'rgba(60,50,70,.12)' });
  box(ctx, DORM.x0 - 0.22, DORM.y0, 0.22, d, 0, WALL_H, '#F6F4FC', { east: '#DDD8F2', stroke: 'rgba(60,50,70,.12)' });
  onNorthWall(ctx, DORM.y0, WALL_S, () => {
    nightWindow(ctx, 2, 2.6, env.t);
    nightWindow(ctx, 8.6, 2.6, env.t);
    ctx.fillStyle = '#FDE68A';
    ctx.beginPath();
    ctx.arc(11.2 * WALL_S, -1.85 * WALL_S, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#F6F4FC';
    ctx.beginPath();
    ctx.arc(11.2 * WALL_S + 12, -1.85 * WALL_S - 6, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6D5FD3';
    ctx.font = '700 40px Fredoka, system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('🌙 DORMS', 5.1 * WALL_S, -1.65 * WALL_S);
    ctx.font = '600 18px Nunito, system-ui';
    ctx.fillStyle = '#8A84B8';
    ctx.fillText('shh… agents recharging', 5.15 * WALL_S, -1.35 * WALL_S);
  });
  onWestWall(ctx, DORM.x0, WALL_S, () => {
    elevatorDoors(ctx, '▼ 1F', env.t, env.elevatorBusy);
    nightWindow(ctx, -17.6, 2.4, env.t);
    // string lights
    for (let i = 0; i < 14; i++) {
      const x = -(11.2 + i * 0.7) * WALL_S;
      ctx.fillStyle = ['#FDE68A', '#F9A8D4', '#A5F3FC'][i % 3];
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(env.t * 2 + i);
      ctx.beginPath();
      ctx.arc(x, -2.55 * WALL_S + Math.sin(i) * 6, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

export function drawWalls(ctx, env) {
  const tints = { manager: '#E6EDF7', conflict: '#F7E4E4', break: '#F8EEDF' };
  for (const [id, r] of Object.entries(ROOMS)) {
    box(ctx, r.x0, -0.22, r.x1 - r.x0, 0.22, 0, WALL_H, '#F7F7F5', { south: tints[id], stroke: 'rgba(60,50,70,.12)' });
  }
  box(ctx, -0.22, 0, 0.22, H, 0, WALL_H, '#F7F7F5', { east: '#E9EEF4', stroke: 'rgba(60,50,70,.12)' });
  box(ctx, -0.22, -0.22, 0.22, 0.22, 0, WALL_H, '#F7F7F5');
  box(ctx, 0, -0.02, W, 0.04, 0, 0.14, '#C9D2DE', { stroke: false });
  box(ctx, -0.02, 0, 0.04, H, 0, 0.14, '#C9D2DE', { stroke: false });

  onNorthWall(ctx, 0, WALL_S, () => {
    windowOnWall(ctx, 1.2, 2.2, env.t);
    poster(ctx, 3.9 * WALL_S, -2.4 * WALL_S, 150, 110, '#F2B84B', '★ MANAGER', 'of the month');
    whiteboard(ctx, 10.3, 6.8, env.t, env.conflictActive);
    poster(ctx, 17.4 * WALL_S, -2.3 * WALL_S, 110, 90, '#E5534B', 'KEEP', 'calm & rebase');
    menuBoard(ctx, 19.6 * WALL_S, -2.5 * WALL_S);
    clock(ctx, 22.9 * WALL_S, -2.1 * WALL_S);
    windowOnWall(ctx, 26.6, 2.6, env.t);
  });
  // West wall coords run along -y, so x = -(world y).
  onWestWall(ctx, 0, WALL_S, () => {
    elevatorDoors(ctx, '▲ 2F Dorms', env.t, env.elevatorBusy);
    windowOnWall(ctx, -4.6, 2.4, env.t);
    windowOnWall(ctx, -13.4, 2.4, env.t);
    windowOnWall(ctx, -22.2, 2.4, env.t);
    ctx.fillStyle = '#6E6AE8';
    ctx.font = '700 64px Fredoka, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('PLEXI', -16.9 * WALL_S, -1.75 * WALL_S);
    ctx.font = '600 22px Nunito, system-ui';
    ctx.fillStyle = '#8A94A6';
    ctx.fillText('an office for agents', -16.9 * WALL_S, -1.4 * WALL_S);
  });
}

// ── glass partitions (depth-sorted per tile) ────────────────────────────────
export function glassPieces() {
  const pieces = [];
  for (const seg of glassSegments) {
    for (let k = seg.from; k < seg.to; k++) {
      const ends = { endA: k === seg.from, endB: k === seg.to - 1 };
      pieces.push(seg.axis === 'x'
        ? { axis: 'x', x: k, y: seg.at, key: k + 0.5 + seg.at, ...ends }
        : { axis: 'y', x: seg.at, y: k, key: seg.at + k + 0.5, ...ends });
    }
  }
  return pieces;
}

export function drawGlass(ctx, p) {
  const t = 0.05;
  const [x, y, w, d] = p.axis === 'x' ? [p.x, p.y - t, 1, t * 2] : [p.x - t, p.y, t * 2, 1];
  box(ctx, x, y, w, d, 0, 0.18, '#DDE5EE');
  box(ctx, x, y, w, d, 0.18, GLASS_H - 0.18, '#CFE8FA', {
    alpha: 0.32, top: '#FFFFFF', south: 'rgb(190,225,250)', east: 'rgb(170,210,240)', stroke: 'rgba(255,255,255,.7)',
  });
  box(ctx, x, y, w, d, GLASS_H, 0.06, '#FFFFFF');
  const post = (px, py) => box(ctx, px - 0.05, py - 0.05, 0.1, 0.1, 0, GLASS_H + 0.06, '#FFFFFF');
  if (p.endA) post(p.x, p.y);
  if (p.endB) post(p.axis === 'x' ? p.x + 1 : p.x, p.axis === 'x' ? p.y : p.y + 1);
  const along = p.axis === 'x' ? [1, 0] : [0, 1];
  const [ax, ay] = iso(x + along[0] * 0.3 + (p.axis === 'y' ? w : 0), y + along[1] * 0.3 + (p.axis === 'x' ? d : 0), 1.5);
  const [bx, by] = iso(x + along[0] * 0.5 + (p.axis === 'y' ? w : 0), y + along[1] * 0.5 + (p.axis === 'x' ? d : 0), 0.5);
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}
