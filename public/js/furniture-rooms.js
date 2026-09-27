// Furniture for the Manager's Office, Merge Conflict Room and Break Room.
import { box, cylinder, ellipse, iso, rgba, shade } from './iso.js';
import { SCREEN_S, drawLegs, drawMonitor, onSouthFace } from './furniture.js';

const WALNUT = '#9A6B4A';

function drawManagerDesk(ctx, f, env) {
  const { x, y, w, d } = f;
  box(ctx, x + 0.05, y + 0.05, 0.3, d - 0.1, 0, 0.72, shade(WALNUT, -0.1));
  box(ctx, x + w - 0.35, y + 0.05, 0.3, d - 0.1, 0, 0.72, shade(WALNUT, -0.1));
  box(ctx, x + 0.35, y + d - 0.12, w - 0.7, 0.06, 0.15, 0.55, shade(WALNUT, -0.18));
  box(ctx, x, y, w, d, 0.72, 0.08, WALNUT, { top: '#B07F5A' });
  // The boss faces south, so we see the back of the monitor.
  drawMonitor(ctx, x + 1.2, y + 0.25, false, 'working', '#F2B84B', env.t, 3, 1.0, 0.8);
  box(ctx, x + w - 1.35, y + d - 0.2, 0.7, 0.08, 0.8, 0.14, '#2F3542');
  onSouthFace(ctx, y + d - 0.12 + 0.001, () => {
    ctx.fillStyle = '#F2B84B';
    ctx.font = 'bold 9px Fredoka, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('MANAGER', (x + w - 1.0) * SCREEN_S, -0.84 * SCREEN_S);
  });
  cylinder(ctx, x + w - 0.3, y + 0.35, 0.09, 0.8, 0.17, '#FFFFFF', { top: '#6B4A2F' });
  box(ctx, x + 2.1, y + 0.2, 0.4, 0.3, 0.8, 0.04, '#FFFFFF');
  box(ctx, x + 2.13, y + 0.22, 0.4, 0.3, 0.84, 0.03, '#F9FAFB');
}

function drawBossChair(ctx, f) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.d / 2;
  const [bx, by] = iso(cx, cy, 0.02);
  ellipse(ctx, bx, by, 15, 7, 'rgba(40,40,60,.25)');
  box(ctx, cx - 0.3, cy - 0.45, 0.6, 0.14, 0.4, 0.95, '#2F3542');
  box(ctx, cx - 0.3, cy - 0.3, 0.6, 0.55, 0.36, 0.12, '#3B4252');
}

function drawBookshelf(ctx, f) {
  const { x, y, w, d } = f;
  box(ctx, x, y, w, d, 0, 2.2, '#C79B72');
  onSouthFace(ctx, y + d + 0.001, () => {
    const colors = ['#E07A5F', '#81B29A', '#F2CC8F', '#3D405B', '#9C89B8', '#F28482', '#84A59D'];
    for (let shelf = 0; shelf < 4; shelf++) {
      const baseY = -(0.15 + shelf * 0.52) * SCREEN_S;
      ctx.fillStyle = '#A8805E';
      ctx.fillRect(x * SCREEN_S + 4, baseY, w * SCREEN_S - 8, 4);
      let bx = x * SCREEN_S + 8;
      let i = shelf * 3;
      while (bx < (x + w) * SCREEN_S - 16) {
        const bw = 8 + ((i * 7) % 6);
        const bh = 26 + ((i * 13) % 14);
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(bx, baseY - bh, bw, bh);
        bx += bw + 2;
        i++;
      }
    }
  });
}

function drawConferenceTable(ctx, f, env) {
  const { x, y, w, d } = f;
  for (const [lx, ly] of [[x + 0.3, y + 0.3], [x + w - 0.4, y + d - 0.4], [x + w - 0.4, y + 0.3], [x + 0.3, y + d - 0.4]]) {
    box(ctx, lx, ly, 0.12, 0.12, 0, 0.72, '#6B7280');
  }
  box(ctx, x, y, w, d, 0.72, 0.08, '#E8D5C0', { top: '#F3E4D2' });
  for (let i = 0; i < 5; i++) {
    const px = x + 0.4 + i * 0.9;
    const py = y + 0.3 + (i % 2) * 0.6;
    box(ctx, px, py, 0.35, 0.25, 0.8, 0.01, '#FFFFFF', { stroke: 'rgba(0,0,0,.1)' });
    const [lx, ly] = iso(px + 0.17, py + 0.12, 0.82);
    ctx.fillStyle = i % 2 ? '#F87171' : '#4ADE80';
    ctx.fillRect(lx - 6, ly - 1, 12, 2);
  }
  if (env.conflictActive) {
    const [cx, cy] = iso(x + w / 2, y + d / 2, 0.82);
    ctx.fillStyle = rgba('#FF4D4D', 0.12 + Math.sin(env.t * 4) * 0.06);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 120, 50, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAlarm(ctx, f, env) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.d / 2;
  box(ctx, cx - 0.05, cy - 0.05, 0.1, 0.1, 0, 1.8, '#6B7280', { stroke: false });
  const on = env.conflictActive;
  cylinder(ctx, cx, cy, 0.2, 1.8, 0.3, on ? '#FF3B3B' : '#B45353');
  if (!on) return;
  const pulse = 0.5 + Math.sin(env.t * 8) * 0.5;
  const [gx, gy] = iso(cx, cy, 1.95);
  const g = ctx.createRadialGradient(gx, gy, 2, gx, gy, 90);
  g.addColorStop(0, `rgba(255,70,70,${0.45 * pulse})`);
  g.addColorStop(1, 'rgba(255,70,70,0)');
  ctx.fillStyle = g;
  ctx.fillRect(gx - 90, gy - 90, 180, 180);
}

function drawDuck(ctx, f, env) {
  const [dx, dy] = iso(f.x + 0.15, f.y + 0.15, 0.8);
  const bob = Math.sin(env.t * 2) * 0.8;
  const edge = 'rgba(120,90,0,.5)';
  ellipse(ctx, dx, dy - 5 + bob, 7, 5, '#FFD93D', edge);
  ellipse(ctx, dx + 4, dy - 11 + bob, 4, 4, '#FFD93D', edge);
  ellipse(ctx, dx + 8, dy - 10 + bob, 2.4, 1.3, '#FF9F1C');
  ellipse(ctx, dx + 5, dy - 12 + bob, 0.8, 0.8, '#222222');
}

function drawSteam(ctx, x, y, z, t) {
  const [sx, sy] = iso(x, y, z);
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.6 + i / 3) % 1;
    ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(sx + Math.sin(k * 6 + i) * 3, sy - k * 22, 2 + k * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCounter(ctx, f, env) {
  const { x, y, w, d } = f;
  box(ctx, x, y, w, d, 0, 0.85, '#F7F3EC', { south: '#EDE5D8' });
  onSouthFace(ctx, y + d + 0.001, () => {
    for (let i = 0; i < w - 0.5; i += 0.9) {
      ctx.strokeStyle = 'rgba(0,0,0,.12)';
      ctx.strokeRect((x + i + 0.06) * SCREEN_S, -0.78 * SCREEN_S, 0.8 * SCREEN_S, 0.66 * SCREEN_S);
      ctx.fillStyle = '#C0B6A6';
      ctx.fillRect((x + i + 0.4) * SCREEN_S, -0.7 * SCREEN_S, 10, 3);
    }
  });
  box(ctx, x - 0.02, y, w + 0.04, d + 0.03, 0.85, 0.06, '#8D9AAB');
  box(ctx, x + 0.5, y + 0.15, 0.55, 0.5, 0.91, 0.62, '#3B3F4A');
  box(ctx, x + 0.62, y + 0.55, 0.3, 0.12, 1.05, 0.2, '#1F2330');
  cylinder(ctx, x + 0.78, y + 0.62, 0.07, 0.91, 0.1, '#FFFFFF');
  drawSteam(ctx, x + 0.78, y + 0.62, 1.1, env.t);
  box(ctx, x + 2.2, y + 0.15, 0.8, 0.55, 0.91, 0.42, '#E5E7EB');
  onSouthFace(ctx, y + 0.701, () => {
    ctx.fillStyle = '#1F2937';
    ctx.fillRect((x + 2.27) * SCREEN_S, -1.28 * SCREEN_S, 0.5 * SCREEN_S, 0.3 * SCREEN_S);
  });
  for (const [ox, oy, c] of [[3.6, 0.4, '#F59E0B'], [3.75, 0.5, '#EF4444'], [3.9, 0.38, '#84CC16']]) {
    const [fx, fy] = iso(x + ox, y + oy, 0.98);
    ellipse(ctx, fx, fy, 5, 5, c, 'rgba(0,0,0,.2)');
  }
}

function drawFridge(ctx, f) {
  box(ctx, f.x, f.y, f.w, f.d, 0, 2.05, '#F3F6FA');
  onSouthFace(ctx, f.y + f.d + 0.001, () => {
    ctx.fillStyle = '#CBD5E1';
    ctx.fillRect((f.x + 0.05) * SCREEN_S, -1.3 * SCREEN_S, (f.w - 0.1) * SCREEN_S, 2);
    ctx.fillRect((f.x + f.w - 0.2) * SCREEN_S, -1.9 * SCREEN_S, 4, 0.5 * SCREEN_S);
    ctx.fillRect((f.x + f.w - 0.2) * SCREEN_S, -1.15 * SCREEN_S, 4, 0.6 * SCREEN_S);
    ctx.fillStyle = '#FDE68A';
    ctx.fillRect((f.x + 0.2) * SCREEN_S, -1.75 * SCREEN_S, 18, 18);
    ctx.fillStyle = '#FBCFE8';
    ctx.fillRect((f.x + 0.45) * SCREEN_S, -1.6 * SCREEN_S, 16, 14);
  });
}

function drawVending(ctx, f, env) {
  box(ctx, f.x, f.y, f.w, f.d, 0, 2.1, '#E25D5D');
  onSouthFace(ctx, f.y + f.d + 0.001, () => {
    const X0 = (f.x + 0.1) * SCREEN_S;
    ctx.fillStyle = '#DDEFFF';
    ctx.fillRect(X0, -1.95 * SCREEN_S, 0.75 * SCREEN_S, 1.3 * SCREEN_S);
    const snacks = ['#F59E0B', '#10B981', '#8B5CF6', '#EF4444', '#3B82F6', '#F472B6'];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = snacks[(r * 3 + c) % snacks.length];
        ctx.fillRect(X0 + 6 + c * 23, -1.9 * SCREEN_S + r * 25, 16, 16);
      }
    }
    ctx.fillStyle = '#1F2937';
    ctx.fillRect((f.x + 0.9) * SCREEN_S, -1.6 * SCREEN_S, 18, 40);
    ctx.fillStyle = `rgba(74,222,128,${0.6 + Math.sin(env.t * 3) * 0.4})`;
    ctx.fillRect((f.x + 0.93) * SCREEN_S, -1.55 * SCREEN_S, 10, 5);
  });
}

function drawArcade(ctx, f, env) {
  const { x, y, w, d } = f;
  box(ctx, x, y, w, d, 0, 1.9, '#5B4BDB', { top: '#7C6CF0' });
  box(ctx, x + 0.05, y + d - 0.05, w - 0.1, 0.3, 0.85, 0.12, '#3B2FA8');
  onSouthFace(ctx, y + d + 0.001, () => {
    const X0 = (x + 0.12) * SCREEN_S;
    const sw = (w - 0.24) * SCREEN_S;
    ctx.fillStyle = '#0B1026';
    ctx.fillRect(X0, -1.7 * SCREEN_S, sw, 0.6 * SCREEN_S);
    const px = X0 + 10 + ((env.t * 40) % (sw - 20));
    const mouth = 0.3 + Math.abs(Math.sin(env.t * 8)) * 0.4;
    ctx.fillStyle = '#FDE047';
    ctx.beginPath();
    ctx.moveTo(px, -1.4 * SCREEN_S);
    ctx.arc(px, -1.4 * SCREEN_S, 8, mouth, Math.PI * 2 - mouth);
    ctx.fill();
    ctx.fillStyle = '#F472B6';
    ctx.font = 'bold 11px Fredoka, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('MERGE-MAN', X0 + sw / 2, -1.78 * SCREEN_S);
  });
}

function drawCouch(ctx, f) {
  const { x, y, w, d, color } = f;
  box(ctx, x, y, w, d, 0.05, 0.3, shade(color, -0.1));
  box(ctx, x, y, w, 0.28, 0.35, 0.55, color);
  box(ctx, x - 0.05, y, 0.25, d, 0.05, 0.6, shade(color, -0.05));
  box(ctx, x + w - 0.2, y, 0.25, d, 0.05, 0.6, shade(color, -0.05));
  const cushion = (w - 0.4) / 3;
  for (let i = 0; i < 3; i++) box(ctx, x + 0.2 + i * cushion, y + 0.28, cushion - 0.02, d - 0.3, 0.35, 0.12, shade(color, 0.12));
  box(ctx, x + 0.3, y + 0.22, 0.4, 0.16, 0.47, 0.3, '#F7D774');
}

function drawCoffeeTable(ctx, f) {
  const { x, y, w, d } = f;
  drawLegs(ctx, f, 0.3, '#A87E5A', 0.09, 0.1);
  box(ctx, x, y, w, d, 0.3, 0.06, '#DDB892');
  cylinder(ctx, x + 0.5, y + 0.35, 0.07, 0.36, 0.12, '#FFFFFF', { top: '#7B4B2A' });
  cylinder(ctx, x + 1.5, y + 0.45, 0.07, 0.36, 0.12, '#FBCFE8', { top: '#7B4B2A' });
  box(ctx, x + 0.9, y + 0.2, 0.35, 0.28, 0.36, 0.02, '#93C5FD');
}

function drawPingPong(ctx, f, env) {
  const { x, y, w, d } = f;
  drawLegs(ctx, f, 0.72, '#4B5563', 0.08, 0.18);
  box(ctx, x, y, w, d, 0.72, 0.05, '#2E8B57', { top: '#34A868' });
  const [ax, ay] = iso(x, y + d / 2, 0.771);
  const [bx2, by2] = iso(x + w, y + d / 2, 0.771);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx2, by2);
  ctx.stroke();
  box(ctx, x + w / 2 - 0.02, y - 0.05, 0.04, d + 0.1, 0.77, 0.18, '#F9FAFB', { alpha: 0.85 });
  const k = (Math.sin(env.t * 2.4) + 1) / 2;
  const [bx, by] = iso(x + 0.2 + k * (w - 0.4), y + d / 2 + Math.sin(env.t * 5) * 0.2, 0.9 + Math.abs(Math.sin(env.t * 4.8)) * 0.4);
  ellipse(ctx, bx, by, 2.6, 2.6, '#FFFFFF', 'rgba(0,0,0,.3)');
}

function drawBeanbag(ctx, f) {
  const [cx, cy] = iso(f.x + f.w / 2, f.y + f.d / 2, 0);
  ellipse(ctx, cx, cy + 2, 26, 12, 'rgba(0,0,0,.12)');
  ellipse(ctx, cx, cy - 8, 24, 14, f.color, rgba('#000000', 0.15));
  ellipse(ctx, cx - 6, cy - 16, 15, 9, shade(f.color, 0.2));
}

function drawSnackTable(ctx, f) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.d / 2;
  cylinder(ctx, cx, cy, 0.08, 0, 0.7, '#6B7280');
  cylinder(ctx, cx, cy, 0.45, 0.7, 0.05, '#FDE2C4');
  const [dx, dy] = iso(cx, cy, 0.78);
  ellipse(ctx, dx, dy - 3, 12, 6, '#F472B6', 'rgba(0,0,0,.2)');
  ellipse(ctx, dx, dy - 4, 4, 2, '#FDE2C4');
}

export const ROOM_DRAWERS = {
  managerDesk: drawManagerDesk,
  bossChair: drawBossChair,
  bookshelf: drawBookshelf,
  conferenceTable: drawConferenceTable,
  alarm: drawAlarm,
  duck: drawDuck,
  counter: drawCounter,
  fridge: drawFridge,
  vending: drawVending,
  arcade: drawArcade,
  couch: drawCouch,
  coffeeTable: drawCoffeeTable,
  pingpong: drawPingPong,
  beanbag: drawBeanbag,
  snackTable: drawSnackTable,
};
