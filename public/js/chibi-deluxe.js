// Extra-detailed chibi pieces: waist-length hair with twin buns, glossy shine,
// side-swept bangs, an off-shoulder dress with a bow and lace petticoat,
// laced boots, puff sleeves, a choker and a sparkle aura.
import { ellipse, shade } from './iso.js';
import { HY, OUT, limb } from './chibi-base.js';

const FLOWING_STYLES = new Set(['twinbuns', 'flowing', 'long']);
const SKIRT_HEM = -8;
// 'long' is the same soft hair, cut mid-back instead of at the waist.
const MID_BACK = HY + 27;

function hairBottom(look) {
  return look.style === 'long' ? MID_BACK : SKIRT_HEM - 1;
}

export function hasFlowingHair(look) {
  return FLOWING_STYLES.has(look.style);
}

function outline(ctx, fill, width = 1.4) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = OUT;
  ctx.stroke();
}

function hairGradient(ctx, look, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, look.hair);
  g.addColorStop(0.5, look.hair);
  g.addColorStop(1, look.hairTip || look.hair);
  return g;
}

function sway(o, amount = 1.2) {
  return o.pose === 'walk' ? Math.sin(o.t * 11 + o.phase) * amount : Math.sin(o.t * 1.5 + o.phase) * amount * 0.4;
}

// ── hair ────────────────────────────────────────────────────────────────────
const BACK_TIPS = [[-20, -2], [-16, 2], [-12, -3], [-7, 1.5], [-2, -3.5], [3, 1.5], [8, -3], [13, 2], [17, -2], [20, -1]];

function flowingShape(ctx, s, bottom, top) {
  ctx.moveTo(-15, top);
  ctx.bezierCurveTo(-24, HY, -22 + s, HY + 22, -20 + s, bottom - 2);
  for (const [x, dy] of BACK_TIPS) ctx.lineTo(x + s, bottom + dy);
  ctx.bezierCurveTo(22 + s, HY + 22, 24, HY, 15, top);
  ctx.closePath();
}

function strands(ctx, look, s, bottom) {
  ctx.strokeStyle = shade(look.hair, -0.35);
  ctx.lineWidth = 0.8;
  for (const x of [-15, -9, 9, 15]) {
    ctx.beginPath();
    ctx.moveTo(x * 0.9, HY + 6);
    ctx.quadraticCurveTo(x * 1.15 + s, HY + 22, x + s, bottom - 3);
    ctx.stroke();
  }
}

function shine(ctx, look, dots) {
  for (const [x, y, rx, ry] of dots) ellipse(ctx, x, HY + y, rx, ry, look.hairShine || shade(look.hair, 0.45));
}

/** Waist-length hair behind the body (front view). Drawn before the torso. */
export function drawFlowingHairBack(ctx, look, o) {
  const s = sway(o);
  const bottom = hairBottom(look);
  ctx.beginPath();
  flowingShape(ctx, s, bottom, HY - 12);
  outline(ctx, hairGradient(ctx, look, HY - 12, bottom + 1));
  strands(ctx, look, s, bottom);
}

/** From behind, the hair covers the head and falls over the back. Drawn after the torso. */
export function drawFlowingHairBackView(ctx, look, o) {
  const s = sway(o);
  ctx.beginPath();
  const bottom = hairBottom(look);
  ctx.ellipse(0, HY - 1, 17.8, 17.2, 0, Math.PI, 0);
  flowingShape(ctx, s, bottom, HY - 1);
  outline(ctx, hairGradient(ctx, look, HY - 18, bottom + 1));
  strands(ctx, look, s, bottom);
  shine(ctx, look, [[-6, -12, 3, 1.8], [5, -14, 2.2, 1.4]]);
}

/** The two buns ("odango"), with a swirl and a glossy highlight. */
export function drawBuns(ctx, look) {
  const gloss = look.hairShine || shade(look.hair, 0.45);
  for (const side of [-1, 1]) {
    const cx = side * 12.8;
    const cy = HY - 14.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(cx - side * 2, cy - 3, 1, cx, cy, 9);
    g.addColorStop(0, shade(look.hair, 0.12));
    g.addColorStop(1, shade(look.hair, -0.15));
    outline(ctx, g);
    ctx.beginPath();
    for (let k = 0; k < 24; k++) {
      const a = k * 0.55 * side;
      const r = 0.8 + k * 0.27;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.strokeStyle = shade(look.hair, -0.45);
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ellipse(ctx, cx - side * 3, cy - 3.5, 1.8, 1.1, gloss);
    ellipse(ctx, cx - side * 0.8, cy - 5.2, 0.9, 0.6, gloss);
  }
}

// Tips stay above the eyes, except one thin strand between them.
const BANGS = [[16.5, 4], [14, -3], [12.5, -1], [9.5, -6.5], [6.5, -4.5], [3.6, -8], [1.2, 5], [-0.8, -8], [-4.5, -5], [-8, -8], [-11, -4.5], [-13.5, -6], [-16, 4]];

/** Side-swept bangs (one strand between the eyes), face-framing locks and shine. */
export function drawFlowingHairFront(ctx, look, o, fx) {
  const s = sway(o, 0.6);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 15, HY - 4);
    ctx.bezierCurveTo(side * 18.5, HY + 8, side * 17.5 + s, HY + 20, side * 15 + s, HY + 27);
    ctx.lineTo(side * 13.2 + s, HY + 21);
    ctx.bezierCurveTo(side * 15, HY + 12, side * 14.5, HY + 4, side * 12.5, HY - 2);
    ctx.closePath();
    outline(ctx, hairGradient(ctx, look, HY - 4, HY + 28));
  }
  ctx.beginPath();
  ctx.moveTo(-17, HY + 4);
  ctx.bezierCurveTo(-19, HY - 23, 19, HY - 23, 17, HY + 4);
  for (const [x, y] of BANGS) ctx.lineTo(x + (Math.abs(x) < 14 ? fx : 0), HY + y);
  ctx.closePath();
  outline(ctx, hairGradient(ctx, look, HY - 20, HY + 14));
  ctx.strokeStyle = shade(look.hair, -0.4);
  ctx.lineWidth = 0.7;
  for (const x of [-9, -3, 4, 10]) {
    ctx.beginPath();
    ctx.moveTo(x * 0.6, HY - 15);
    ctx.quadraticCurveTo(x + fx * 0.5, HY - 8, x * 1.1 + fx, HY - 1);
    ctx.stroke();
  }
  const sx = fx * 0.5;
  shine(ctx, look, [[-8 + sx, -13, 2.6, 1.6], [-4 + sx, -15.5, 1.7, 1.1], [-11 + sx, -9, 1.3, 0.9], [7 + sx, -14, 1.4, 0.9]]);
}

// ── dress ───────────────────────────────────────────────────────────────────
function dressColors(look) {
  const main = look.dress || '#D9C8F7';
  return { main, dark: look.dressDark || shade(main, -0.55), ribbon: look.ribbon || shade(main, -0.35) };
}

function scallops(ctx, x0, x1, y, r, fill) {
  ctx.beginPath();
  for (let x = x0; x <= x1 + 0.01; x += r * 1.8) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI);
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = OUT;
  ctx.stroke();
}

function skirtPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(-8.6, -15);
  ctx.quadraticCurveTo(-12, -11, -14.8 + s, SKIRT_HEM);
  ctx.quadraticCurveTo(s, SKIRT_HEM + 2.4, 14.8 + s, SKIRT_HEM);
  ctx.quadraticCurveTo(12, -11, 8.6, -15);
  ctx.closePath();
}

function drawSkirt(ctx, look, o) {
  const { main, dark, ribbon } = dressColors(look);
  const s = sway(o);
  scallops(ctx, -15 + s, 15 + s, SKIRT_HEM + 1.2, 1.9, dark);
  skirtPath(ctx, s);
  const g = ctx.createLinearGradient(0, -15, 0, SKIRT_HEM);
  g.addColorStop(0, main);
  g.addColorStop(1, shade(main, -0.12));
  outline(ctx, g);
  ctx.save();
  skirtPath(ctx, s);
  ctx.clip();
  ctx.strokeStyle = shade(main, -0.22);
  ctx.lineWidth = 0.8;
  for (const x of [-6, -2, 2, 6]) {
    ctx.beginPath();
    ctx.moveTo(x * 0.8, -15);
    ctx.lineTo(x * 1.6 + s, SKIRT_HEM + 2);
    ctx.stroke();
  }
  ctx.fillStyle = ribbon;
  ctx.fillRect(-16, SKIRT_HEM - 3.2, 32, 1.5);
  ctx.restore();
}

function drawBodice(ctx, look, front) {
  const { main } = dressColors(look);
  ctx.beginPath();
  ctx.moveTo(-9.8, -25.6);
  ctx.quadraticCurveTo(0, -30.4, 9.8, -25.6);
  ctx.lineTo(9, -25);
  ctx.lineTo(-9, -25);
  ctx.closePath();
  outline(ctx, look.skin, 1.1);
  ctx.beginPath();
  ctx.moveTo(-9, -25);
  ctx.lineTo(9, -25);
  ctx.quadraticCurveTo(9.8, -19, 8.6, -15);
  ctx.lineTo(-8.6, -15);
  ctx.quadraticCurveTo(-9.8, -19, -9, -25);
  ctx.closePath();
  outline(ctx, main);
  if (front) scallops(ctx, -8.6, 8.6, -25, 1.3, shade(main, 0.5));
}

function drawBow(ctx, look, front) {
  const { ribbon } = dressColors(look);
  ctx.fillStyle = ribbon;
  ctx.fillRect(-8.8, -16.8, 17.6, 2.4);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 0.7;
  ctx.strokeRect(-8.8, -16.8, 17.6, 2.4);
  if (!front) return;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 3.3, -15.8);
    ctx.rotate(side * 0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.4, 2.2, 0, 0, Math.PI * 2);
    outline(ctx, ribbon, 1);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(side * 0.6, -14.8);
    ctx.lineTo(side * 3.2, -9.6);
    ctx.lineTo(side * 1.4, -10.4);
    ctx.lineTo(side * 0.2, -14.6);
    ctx.closePath();
    outline(ctx, shade(ribbon, -0.1), 0.8);
  }
  ellipse(ctx, 0, -15.6, 1.5, 1.7, shade(ribbon, 0.15), OUT, 1);
}

/** Off-shoulder dress: bodice, bow and a layered skirt. Replaces the torso. */
export function drawDress(ctx, look, o) {
  const front = o.view === 'front';
  drawSkirt(ctx, look, o);
  drawBodice(ctx, look, front);
  drawBow(ctx, look, front);
}

/** Puff sleeves sit over the tops of the (bare) arms. */
export function drawPuffSleeves(ctx, look) {
  const { main } = dressColors(look);
  for (const side of [-1, 1]) {
    ellipse(ctx, side * 9.4, -24.2, 3.3, 2.8, main, OUT, 1.1);
    scallops(ctx, side * 9.4 - 2.5, side * 9.4 + 2.5, -21.8, 0.9, shade(main, 0.5));
  }
}

/** A choker with a tiny flower, just under the chin. Drawn after the head. */
export function drawChoker(ctx, look) {
  const { ribbon, dark } = dressColors(look);
  ctx.fillStyle = dark;
  ctx.fillRect(-3.6, -27.2, 7.2, 1.5);
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    ellipse(ctx, Math.cos(a) * 1.1, -25.1 + Math.sin(a) * 1.1, 0.9, 0.9, ribbon);
  }
  ellipse(ctx, 0, -25.1, 0.6, 0.6, '#FDE68A');
}

/** Short legs with laced boots peeking out under the skirt. */
export function drawBootLegs(ctx, look, o, sitting) {
  if (sitting && o.view === 'back') return;
  const boots = look.shoes || '#3B2A63';
  const laces = shade(boots, 0.65);
  const lift = o.pose === 'walk' && !sitting ? Math.sin(o.t * 11 + o.phase) * 2.2 : 0;
  for (const [lx, up] of [[-4.2, Math.max(0, lift)], [4.2, Math.max(0, -lift)]]) {
    limb(ctx, lx, sitting ? -5 : -8, lx, -5 - up, look.skin, 4.4);
    ctx.beginPath();
    ctx.roundRect(lx - 2.9, -6.4 - up, 5.8, 5.4, 1.8);
    outline(ctx, boots, 1.1);
    ellipse(ctx, lx + 0.9, -1.3 - up, 3.7, 2.2, boots, OUT, 1.1);
    ctx.strokeStyle = laces;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (const y of [-5.4, -3.6]) {
      ctx.moveTo(lx - 1.4, y - up);
      ctx.lineTo(lx + 1.4, y + 1.2 - up);
      ctx.moveTo(lx + 1.4, y - up);
      ctx.lineTo(lx - 1.4, y + 1.2 - up);
    }
    ctx.stroke();
  }
}

/** Twinkling four-point stars around the character. */
export function drawAura(ctx, o) {
  for (let i = 0; i < 6; i++) {
    const a = i * 1.047 + o.t * 0.25;
    const r = 25 + (i % 3) * 6;
    const x = Math.cos(a) * r;
    const y = -34 + Math.sin(a) * r * 0.75;
    const size = 1.2 + 1.8 * Math.abs(Math.sin(o.t * 2 + i * 1.7));
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.95)' : 'rgba(196,167,255,.95)';
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const rr = k % 2 === 0 ? size * 2 : size * 0.45;
      const ang = (k * Math.PI) / 4;
      ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
}
