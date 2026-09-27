// Draws the office every frame: camera, depth sorting, characters, overlays, picking.
import { ZU, iso } from './iso.js';
import { drawChibi } from './chibi.js';
import { FACING_VIEW } from './entities.js';
import { FLOOR_KINDS, chairBackBox, drawBedPart, drawChairPart, drawFurniture } from './furniture.js';
import { DepthSorter, personNode } from './depth.js';
import { drawDorm, drawFloor, drawGlass, drawWalls, glassPieces } from './scene.js';
import { FLOOR2_Z, ROOMS, dormFurniture, furniture } from './world.js';

// HR sanctions show on the name tag: a yellow card for a warning, a red one for a suspension.
const SANCTION_BADGES = { warning: '🟨', suspension: '🟥' };
const MAX_DPR = 1.5;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.4;
const CAMERA_LERP = 6;
const NAME_ZOOM = 0.62;

const STATE_BUBBLES = {
  question: { icon: '?', bg: '#FFD35A', fg: '#6B4E00', bounce: true },
  conflict: { icon: '⚔', bg: '#FF7A7A', fg: '#FFFFFF', bounce: true },
};
const BREAK_ICONS = { couch: '📱', beanbag: '😌', coffee: '☕', sip: '☕', arcade: '🕹️', pingpong: '🏓', snack: '🍩' };
const STATE_DOT = { working: '#4ADE80', break: '#FBBF24', question: '#FFD35A', conflict: '#F87171', offline: '#A1A1AA' };
const ROOM_WORDS = { manager: 'waiting', conflict: 'stuck', break: 'chilling' };
const ROOM_OF_STATE = { question: 'manager', conflict: 'conflict', break: 'break' };
const FLOOR2_LIFT = FLOOR2_Z * ZU;
const DIM_BELOW = 'rgba(24,20,52,0.55)';

function hexagon(x0, y0, x1, y1, bot, top) {
  return [iso(x0, y0, top), iso(x1, y0, top), iso(x1, y0, bot), iso(x1, y1, bot), iso(x0, y1, bot), iso(x0, y1, top)];
}

function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const box = (x, y, w, d) => ({ x0: x, y0: y, x1: x + w, y1: y + d });
const footprint = (f) => box(f.x, f.y, f.w, f.d);

/** Office drawables with floor footprints, for the depth sorter. */
function buildStaticDrawables() {
  const list = [];
  for (const f of furniture) {
    if (FLOOR_KINDS.has(f.kind)) continue;
    const key = f.x + f.w / 2 + f.y + f.d / 2;
    if (f.kind === 'chair') {
      const s = f.seat;
      list.push({ key: s.x + s.y - 0.05, box: box(s.x - 0.24, s.y - 0.24, 0.48, 0.48), zTop: 1, draw: (ctx) => drawChairPart(ctx, f, 'base') });
      const b = chairBackBox(s);
      list.push({ key: b.x + b.w / 2 + b.y + b.d / 2, box: box(b.x, b.y, b.w, b.d), zTop: 1.1, draw: (ctx) => drawChairPart(ctx, f, 'back') });
    } else {
      list.push({ key, box: footprint(f), f });
    }
  }
  for (const p of glassPieces()) {
    const b = p.axis === 'x' ? box(p.x, p.y - 0.05, 1, 0.1) : box(p.x - 0.05, p.y, 0.1, 1);
    list.push({ key: p.key, box: b, zTop: 2, draw: (ctx) => drawGlass(ctx, p) });
  }
  return list;
}

function buildDormDrawables() {
  const list = [];
  for (const f of dormFurniture) {
    if (FLOOR_KINDS.has(f.kind)) continue;
    if (f.kind === 'bed' || f.kind === 'bedroll') {
      const k = f.spot.x + f.spot.y;
      list.push({ key: k - 0.06, box: footprint(f), zTop: 1, draw: (ctx, env) => drawBedPart(ctx, f, 'base', env) });
      list.push({ key: k + 0.06, box: footprint(f), zTop: 1, overlay: true, draw: (ctx, env) => drawBedPart(ctx, f, 'blanket', env) });
    } else {
      list.push({ key: f.x + f.w / 2 + f.y + f.d / 2, box: footprint(f), f });
    }
  }
  return list;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.zoom = 1.1;
    this.cam = { x: 0, y: 0 };
    this.pan = { x: 0, y: 0 };
    this.officeSorter = new DepthSorter(buildStaticDrawables());
    this.floorItems = furniture.filter((f) => FLOOR_KINDS.has(f.kind));
    this.dormSorter = new DepthSorter(buildDormDrawables());
    this.dormFloorItems = dormFurniture.filter((f) => FLOOR_KINDS.has(f.kind));
    this.marker = null;
    this.resize();
  }

  resize() {
    // Retina at 2x quadruples the pixels drawn every frame; 1.5x stays crisp and runs much cooler.
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  setZoom(z) {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  }

  clientToIso(px, py) {
    return { x: (px - this.w / 2) / this.zoom + this.cam.x, y: (py - this.h / 2) / this.zoom + this.cam.y };
  }

  isoToClient(ix, iy) {
    return { x: (ix - this.cam.x) * this.zoom + this.w / 2, y: (iy - this.cam.y) * this.zoom + this.h / 2 };
  }

  /** Client pixel → world ground position on the given floor. */
  screenToWorld(px, py, floor = 1) {
    const p = this.clientToIso(px, py);
    if (floor === 2) p.y += FLOOR2_LIFT;
    const [ux] = iso(1, 0);
    const a = p.x / ux;
    const b = p.y / (ux / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  follow(target, dt) {
    const [tx, ty] = iso(target.x, target.y, 1 + (target.floor === 2 ? FLOOR2_Z : 0));
    const k = 1 - Math.exp(-dt * CAMERA_LERP);
    this.cam.x += (tx + this.pan.x - this.cam.x) * k;
    this.cam.y += (ty + this.pan.y - this.cam.y) * k;
  }

  render(scene) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, this.h);
    bg.addColorStop(0, '#D9EEF7');
    bg.addColorStop(1, '#F1F7FB');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.w, this.h);

    const z = this.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, this.dpr * (this.w / 2 - this.cam.x * this.zoom), this.dpr * (this.h / 2 - this.cam.y * this.zoom));
    const { env } = scene;
    const floor = scene.viewFloor || 1;
    const onFloor = (f) => [scene.manager, ...scene.agents].filter((p) => (p.floor || 1) === f && !p.hidden);
    drawFloor(ctx);
    for (const f of this.floorItems) drawFurniture(ctx, f, env);
    if (floor === 1) this.drawMarker(ctx, scene.t);
    drawWalls(ctx, env);
    this.drawSorted(ctx, this.officeSorter, onFloor(1), scene);
    if (floor === 1) {
      this.drawOverlays(ctx, { ...scene, agents: scene.agents.filter((a) => (a.floor || 1) === 1 && !a.hidden) });
      this.drawRoomSigns(ctx, scene);
      return;
    }
    // Upstairs: dim the office and draw the dorm deck on top of it.
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = DIM_BELOW;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
    ctx.save();
    ctx.translate(0, -FLOOR2_LIFT);
    drawDorm(ctx, env);
    for (const f of this.dormFloorItems) drawFurniture(ctx, f, env);
    this.drawMarker(ctx, scene.t);
    this.drawSorted(ctx, this.dormSorter, onFloor(2), scene);
    this.drawOverlays(ctx, { ...scene, agents: scene.agents.filter((a) => a.floor === 2 && !a.hidden) });
    ctx.restore();
  }

  drawSorted(ctx, sorter, people, scene) {
    for (const item of sorter.sort(people.map(personNode))) {
      if (item.person) this.drawPerson(ctx, item.person, scene);
      else if (item.draw) item.draw(ctx, scene.env);
      else drawFurniture(ctx, item.f, scene.env);
    }
  }

  drawOverlays(ctx, scene) {
    this.drawBonds(ctx, scene);
    for (const a of scene.agents) this.drawOverlay(ctx, a, scene);
    // Speech goes last so conversations read on top of everything else.
    for (const a of scene.agents) if (a.speech) this.drawSpeech(ctx, a);
    if ((scene.manager.floor || 1) === (scene.viewFloor || 1) && !scene.manager.hidden) this.drawManagerTag(ctx, scene.manager, scene.t);
  }


  drawPerson(ctx, p, scene) {
    const [sx, sy] = iso(p.x, p.y, 0);
    const { view, flip } = FACING_VIEW[p.facing] || FACING_VIEW.S;
    const highlighted = p.id && (scene.hoverId === p.id || scene.selectedId === p.id);
    drawChibi(ctx, p.look, {
      x: sx,
      y: sy,
      view,
      flip,
      pose: p.pose,
      sitting: p.sitting,
      sitLow: p.sitLow,
      lift: p.lift,
      expression: p.expression || 'happy',
      t: scene.t,
      phase: p.phase,
      ring: highlighted ? p.style?.color : null,
      happyHop: p.state === 'question' && p.nearManager && !p.sitting,
    });
  }

  drawMarker(ctx, t) {
    if (!this.marker) return;
    const age = t - this.marker.t;
    if (age > 0.8) {
      this.marker = null;
      return;
    }
    const [mx, my] = iso(this.marker.x, this.marker.y, 0.01);
    ctx.strokeStyle = `rgba(242,184,75,${1 - age / 0.8})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(mx, my, 10 + age * 18, 5 + age * 9, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  pill(ctx, x, y, text, { bg = 'rgba(255,255,255,.92)', fg = '#374151', size = 11, bold = true, border } = {}) {
    ctx.font = `${bold ? 700 : 500} ${size}px Nunito, system-ui`;
    const w = ctx.measureText(text).width + size * 1.3;
    const h = size * 1.75;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = bg;
    ctx.fill();
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  drawRoomSigns(ctx, scene) {
    const counts = { manager: 0, conflict: 0, break: 0 };
    for (const a of scene.agents) {
      const room = ROOM_OF_STATE[a.state];
      if (room) counts[room]++;
    }
    const inv = 1 / Math.sqrt(this.zoom);
    for (const [id, r] of Object.entries(ROOMS)) {
      const [sx, sy] = iso((r.door[0] + r.door[1]) / 2, 8, 2.45);
      const n = counts[id];
      const urgent = n > 0 && id !== 'break';
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(inv, inv);
      this.pill(ctx, 0, 0, `${r.icon}  ${r.name}${n ? `  ·  ${n} ${ROOM_WORDS[id]}` : ''}`, {
        bg: urgent ? r.accent : 'rgba(255,255,255,.95)', fg: urgent ? '#FFFFFF' : '#374151', size: 13, border: r.accent,
      });
      ctx.restore();
    }
  }

  /** Wraps text to at most `maxLines` lines of `maxWidth` px. */
  wrap(ctx, text, maxWidth, maxLines = 3) {
    const words = text.split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, '')}…`;
    }
    return lines;
  }

  /** Speech bubble with a tail pointing at the speaker. */
  speechBubble(ctx, x, y, text, accent) {
    ctx.font = '700 11px Nunito, system-ui';
    const lines = this.wrap(ctx, text, 150);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18;
    const h = lines.length * 14 + 10;
    const top = y - h - 6;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, top, w, h, 10);
    ctx.moveTo(x - 5, top + h);
    ctx.lineTo(x + 1, top + h + 7);
    ctx.lineTo(x + 5, top + h);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = accent || 'rgba(74,52,56,.45)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = '#3B3340';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, x, top + 12 + i * 14));
  }

  /** Cloud-shaped thought bubble with trailing dots. */
  thoughtBubble(ctx, x, y, text, t) {
    ctx.font = 'italic 600 11px Nunito, system-ui';
    const lines = this.wrap(ctx, text, 120, 2);
    const w = Math.max(40, ...lines.map((l) => ctx.measureText(l).width)) + 20;
    const h = lines.length * 13 + 14;
    const cx = x + 10;
    const cy = y - h / 2 - 16 + Math.sin(t * 2) * 1.2;
    ctx.fillStyle = 'rgba(255,255,255,.96)';
    ctx.strokeStyle = 'rgba(74,52,56,.35)';
    ctx.lineWidth = 1.3;
    const bumps = Math.max(3, Math.round(w / 16));
    ctx.beginPath();
    for (let i = 0; i < bumps; i++) {
      const bx = cx - w / 2 + (i + 0.5) * (w / bumps);
      ctx.moveTo(bx + h * 0.32, cy - h / 2 + 2);
      ctx.arc(bx, cy - h / 2 + 2, h * 0.32, 0, Math.PI * 2);
      ctx.moveTo(bx + h * 0.32, cy + h / 2 - 2);
      ctx.arc(bx, cy + h / 2 - 2, h * 0.32, 0, Math.PI * 2);
    }
    ctx.moveTo(cx - w / 2 + h / 2, cy);
    ctx.arc(cx - w / 2 + 2, cy, h / 2, 0, Math.PI * 2);
    ctx.moveTo(cx + w / 2 - 2 + h / 2, cy);
    ctx.arc(cx + w / 2 - 2, cy, h / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    for (const [dx, dy, r] of [[-2, 12, 3.2], [-6, 19, 2]]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy - 14, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#5B5563';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, cx, cy - ((lines.length - 1) * 13) / 2 + i * 13));
  }

  bubble(ctx, x, y, { icon, bg, fg, text }, t, bounce) {
    const by = y + (bounce ? -Math.abs(Math.sin(t * 5)) * 4 : 0);
    ctx.font = text ? '600 11px Nunito, system-ui' : '700 15px Fredoka, system-ui';
    const content = text || icon;
    const w = Math.max(24, ctx.measureText(content).width + 14);
    const h = text ? 22 : 24;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, by - h, w, h, 11);
    ctx.moveTo(x - 4, by - 1);
    ctx.lineTo(x, by + 5);
    ctx.lineTo(x + 4, by - 1);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(74,52,56,.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(content, x, by - h / 2 + 0.5);
  }

  bubbleFor(a) {
    if (STATE_BUBBLES[a.state]) return STATE_BUBBLES[a.state];
    if (a.state === 'break' && !a.moving) return { icon: BREAK_ICONS[a.pose] || '☕', bg: '#FFF7E6', fg: '#6B4E00' };
    if (a.state === 'working') {
      const icon = { assistant: '📋', hr: '💐' }[a.agent.role] || '···';
      return { icon, bg: '#FFFFFF', fg: a.style.color };
    }
    return null;
  }

  drawSleepZs(ctx, a, t) {
    ctx.fillStyle = 'rgba(120,120,160,.8)';
    ctx.font = '700 12px Fredoka, system-ui';
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.5 + i / 3 + a.phase) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.fillText('z', 14 + k * 12, -14 - k * 24);
    }
    ctx.globalAlpha = 1;
  }

  drawNameTag(ctx, a, hovered) {
    ctx.font = '700 11px Nunito, system-ui';
    const badge = SANCTION_BADGES[a.agent?.sanction?.level];
    const w = ctx.measureText(a.name).width + 26 + (badge ? 16 : 0);
    ctx.beginPath();
    ctx.roundRect(-w / 2, -8, w, 17, 8.5);
    ctx.fillStyle = hovered ? a.style.color : 'rgba(255,255,255,.9)';
    ctx.fill();
    ctx.fillStyle = STATE_DOT[a.state] || STATE_DOT.offline;
    ctx.beginPath();
    ctx.arc(-w / 2 + 9, 0.5, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hovered ? '#FFFFFF' : '#374151';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.name, badge ? -3 : 5, 1);
    if (badge) ctx.fillText(badge, w / 2 - 12, 1);
  }

  drawOverlay(ctx, a, scene) {
    const [sx, sy] = iso(a.x, a.y, 0);
    const headTop = sy - 66 + (a.pose === 'walk' ? 0 : 6) - (a.lift || 0);
    const hovered = scene.hoverId === a.id;
    const inv = 1 / Math.sqrt(this.zoom);
    ctx.save();
    ctx.translate(sx, headTop);
    ctx.scale(inv, inv);
    if (this.zoom >= NAME_ZOOM || hovered) this.drawNameTag(ctx, a, hovered);
    if (a.speech || (a.convo && !a.convo.pending)) {
      // speech is drawn in its own pass; listeners stay quiet
    } else if (a.state === 'offline') {
      this.drawSleepZs(ctx, a, scene.t);
    } else if (a.thought && !STATE_BUBBLES[a.state]) {
      this.thoughtBubble(ctx, 0, -8, a.thought.text, scene.t);
    } else {
      const b = this.bubbleFor(a);
      if (b) this.bubble(ctx, 0, -14, b, scene.t, b.bounce);
      if (a.thought) this.thoughtBubble(ctx, 24, -30, a.thought.text, scene.t);
    }
    if (hovered && a.detail && (a.state === 'question' || a.state === 'conflict')) {
      const detail = a.detail.length > 70 ? `${a.detail.slice(0, 68)}…` : a.detail;
      this.pill(ctx, 0, -52, detail, { size: 11, bold: false, bg: '#FFFFFF', border: a.style.color });
    }
    ctx.restore();
  }

  /** Floating hearts between sweethearts, little 💢 sparks between enemies. */
  drawBonds(ctx, scene) {
    if (!scene.relationship) return;
    const list = scene.agents.filter((a) => !a.moving && a.state !== 'offline');
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.floor !== b.floor || Math.hypot(a.x - b.x, a.y - b.y) > 2.2) continue;
        const key = scene.relationship(a.id, b.id)?.label?.key;
        const icon = { sweethearts: '💕', crush: '💗', enemies: '💢' }[key];
        if (!icon) continue;
        const [ax, ay] = iso(a.x, a.y, 0);
        const [bx, by] = iso(b.x, b.y, 0);
        for (let k = 0; k < 2; k++) {
          const phase = (scene.t * 0.6 + k * 0.5 + a.phase) % 1;
          ctx.globalAlpha = 1 - phase;
          ctx.fillText(icon, (ax + bx) / 2 + Math.sin(phase * 6 + k) * 6, (ay + by) / 2 - 60 - phase * 26);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  drawSpeech(ctx, a) {
    const [sx, sy] = iso(a.x, a.y, 0);
    const headTop = sy - 66 + (a.pose === 'walk' ? 0 : 6) - (a.lift || 0);
    const inv = 1 / Math.sqrt(this.zoom);
    ctx.save();
    ctx.translate(sx, headTop);
    ctx.scale(inv, inv);
    this.speechBubble(ctx, 0, -12, a.speech.text, a.style.color);
    ctx.restore();
  }

  drawManagerTag(ctx, m, t) {
    const [sx, sy] = iso(m.x, m.y, 0);
    const inv = 1 / Math.sqrt(this.zoom);
    ctx.save();
    ctx.translate(sx, sy - 78 - Math.abs(Math.sin(t * 3)) * 3);
    ctx.scale(inv, inv);
    ctx.fillStyle = '#F2B84B';
    ctx.beginPath();
    ctx.moveTo(-6, -6);
    ctx.lineTo(6, -6);
    ctx.lineTo(0, 2);
    ctx.fill();
    this.pill(ctx, 0, -16, `${m.name} (you)`, { bg: '#F2B84B', fg: '#FFFFFF', size: 11 });
    ctx.restore();
  }

  /** What's under the pointer: an agent, the memory vault, or nothing. */
  pick(px, py, scene) {
    const z = this.zoom;
    const floor = scene.viewFloor || 1;
    const hits = scene.agents.filter((a) => {
      if ((a.floor || 1) !== floor || a.hidden) return false;
      const [ix, iy] = iso(a.x, a.y, floor === 2 ? FLOOR2_Z : 0);
      const c = this.isoToClient(ix, iy - (a.lift || 0));
      return px > c.x - 17 * z && px < c.x + 17 * z && py > c.y - 64 * z && py < c.y + 6 * z;
    });
    if (hits.length) {
      hits.sort((a, b) => b.depth - a.depth);
      return { type: 'agent', id: hits[0].id };
    }
    for (const f of floor === 1 ? furniture : []) {
      if (!f.interactive) continue;
      const hull = hexagon(f.x, f.y, f.x + f.w, f.y + f.d, 0, 2.1).map(([x, y]) => this.isoToClient(x, y));
      if (pointInPolygon(px, py, hull)) return { type: f.interactive };
    }
    return null;
  }

  /** Did the pointer land on the manager (you)? */
  pickManager(px, py, m) {
    if (!m || m.hidden) return false;
    const [ix, iy] = iso(m.x, m.y, m.floor === 2 ? FLOOR2_Z : 0);
    const c = this.isoToClient(ix, iy);
    const z = this.zoom;
    return px > c.x - 17 * z && px < c.x + 17 * z && py > c.y - 64 * z && py < c.y + 6 * z;
  }

  flashMarker(x, y, t) {
    this.marker = { x, y, t };
  }
}
