// Chibi faces: eyes, brows, mouths and little manga marks (💢, tears, hearts…).
// Coordinates are relative to the head centre (0, hy); fx shifts features
// toward the side the character is facing (3/4 view).
import { ellipse, shade } from './iso.js';

const INK = '#3B2C2C';
const MOUTH = '#8B3A3A';
const TEAR = 'rgba(120,190,240,.85)';

export const EXPRESSIONS = {
  happy: { eyes: 'oval', mouth: 'smile' },
  focus: { eyes: 'narrow', mouth: 'flat' },
  surprised: { eyes: 'big', mouth: 'o' },
  worried: { eyes: 'oval', brows: 'worried', mouth: 'wavy', extras: ['sweat'] },
  sleep: { eyes: 'sleep', mouth: 'tiny' },
  grin: { eyes: 'oval', mouth: 'grin' },
  laugh: { eyes: 'closedHappy', mouth: 'grin', blush: 1.4 },
  wink: { eyes: 'wink', mouth: 'smile', extras: ['heart'] },
  sparkle: { eyes: 'star', mouth: 'grin', extras: ['sparkles'], blush: 1.3 },
  shocked: { eyes: 'dots', mouth: 'o', extras: ['anger'] },
  sad: { eyes: 'oval', brows: 'sad', mouth: 'frown' },
  content: { eyes: 'closedHappy', mouth: 'smile' },
  tongue: { eyes: 'wink', mouth: 'tongue' },
  squint: { eyes: 'squint', mouth: 'grin' },
  sleepy: { eyes: 'halfLid', mouth: 'tiny' },
  cat: { eyes: 'closedHappy', mouth: 'cat' },
  dizzy: { eyes: 'spiral', mouth: 'wavy' },
  cry: { eyes: 'closedFlat', brows: 'sad', mouth: 'frown', extras: ['tears'] },
  pout: { eyes: 'halfLid', mouth: 'pout', blush: 1.6 },
  blank: { eyes: 'dots', mouth: 'flat' },
  determined: { eyes: 'narrow', brows: 'angry', mouth: 'smile' },
  huff: { eyes: 'narrow', brows: 'angry', mouth: 'o', extras: ['exclaim'], blush: 1.2 },
};

// Eye shapes that get the detailed "anime" treatment when a look asks for it.
const ANIME_KINDS = new Set(['oval', 'narrow', 'big', 'star', 'halfLid']);

const BLINKABLE = new Set(['oval', 'narrow', 'big', 'star', 'dots', 'halfLid']);

function stroke(ctx, width = 1.4, color = INK) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function line(ctx, pts, width, color) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  stroke(ctx, width, color);
}

function starGlint(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 === 0 ? r : r * 0.35;
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
}

function openEye(ctx, kind, x, y) {
  const ry = { narrow: 2.4, big: 3.7 }[kind] || 3.1;
  ellipse(ctx, x, y, kind === 'big' ? 2.2 : 1.9, ry, INK);
  ellipse(ctx, x - 0.6, y - 1.3, 0.75, 0.75, '#FFFFFF');
}

/** Big glossy eye: gradient iris, pupil, two highlights, lash line with a little wing. */
function drawAnimeEye(ctx, kind, x, y, side, color) {
  const rx = 3.9;
  const ry = { big: 5.4, narrow: 4.6, halfLid: 3.8 }[kind] || 5;
  const cy = y + (kind === 'narrow' ? 0.3 : 0);
  const lidY = cy - ry + ({ narrow: 0.6, halfLid: 1.8 }[kind] || 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - rx - 2, lidY, rx * 2 + 4, ry * 2 + 4);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
  g.addColorStop(0, shade(color, -0.62));
  g.addColorStop(0.55, color);
  g.addColorStop(1, shade(color, 0.5));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  ellipse(ctx, x, cy + 0.5, 1.8, 2.7, shade(color, -0.75));
  ellipse(ctx, x, cy + ry * 0.72, rx * 0.85, 1.6, 'rgba(255,196,236,.55)');
  ctx.restore();
  ellipse(ctx, x - 1.4, Math.max(lidY + 1.8, cy - ry * 0.38), 1.6, 1.9, '#FFFFFF');
  ellipse(ctx, x + 1.4, cy + ry * 0.36, 0.8, 0.8, '#FFFFFF');
  ellipse(ctx, x + 1.6, cy - ry * 0.5, 0.5, 0.5, 'rgba(255,255,255,.8)');
  if (kind === 'star') starGlint(ctx, x - 0.2, cy - 0.3, 2.3);
  const outer = x + side * (rx + 0.7);
  const inner = x - side * (rx - 0.3);
  ctx.beginPath();
  ctx.moveTo(inner, lidY + 1.1);
  ctx.quadraticCurveTo(x, lidY - 1.3, outer, lidY + 0.5);
  ctx.lineTo(outer + side * 1.3, lidY - 0.9);
  stroke(ctx, 1.9);
  ctx.beginPath();
  ctx.arc(x, cy + ry - 1.4, rx * 0.72, 0.28 * Math.PI, 0.72 * Math.PI);
  stroke(ctx, 0.7, 'rgba(59,44,44,.45)');
}

function drawEye(ctx, kind, x, y, side, t, style) {
  if (style?.eyeStyle === 'anime' && ANIME_KINDS.has(kind)) {
    drawAnimeEye(ctx, kind, x, y, side, style.eyeColor || '#8E5BE0');
    return;
  }
  switch (kind) {
    case 'closedHappy':
      ctx.beginPath();
      ctx.arc(x, y + 1.2, 2.4, 1.15 * Math.PI, 1.85 * Math.PI);
      stroke(ctx);
      return;
    case 'sleep':
      ctx.beginPath();
      ctx.arc(x, y - 0.5, 2.2, 0.15 * Math.PI, 0.85 * Math.PI);
      stroke(ctx);
      return;
    case 'closedFlat':
      line(ctx, [[x - 2.4, y], [x + 2.4, y]]);
      return;
    case 'wink':
      if (side > 0) line(ctx, [[x - 2.4, y - 1.6], [x + 1.6, y], [x - 2.4, y + 1.6]]);
      else drawEye(ctx, 'oval', x, y, side, t, style);
      return;
    case 'squint':
      line(ctx, [[x - 2.2 * side, y - 2.2], [x + 1.8 * side, y], [x - 2.2 * side, y + 2.2]], 1.6);
      return;
    case 'dots':
      ellipse(ctx, x, y, 1.3, 1.3, INK);
      return;
    case 'spiral': {
      const pts = [];
      for (let k = 0; k < 18; k++) {
        const a = k * 0.7 + t * 6;
        const r = 0.3 + k * 0.17;
        pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
      }
      line(ctx, pts, 1);
      return;
    }
    case 'halfLid':
      ellipse(ctx, x, y + 0.8, 1.9, 2.2, INK);
      line(ctx, [[x - 2.6, y - 0.6], [x + 2.6, y - 0.6]], 1.3);
      return;
    case 'star':
      ellipse(ctx, x, y, 2.3, 3.5, INK);
      starGlint(ctx, x - 0.2, y - 0.4, 2.2);
      return;
    default:
      openEye(ctx, kind, x, y);
  }
}

function drawBrows(ctx, kind, fx, ey) {
  if (!kind) return;
  for (const side of [-1, 1]) {
    const inner = fx + side * 3.8;
    const outer = fx + side * 8.5;
    const pts = kind === 'angry' ? [[outer, ey - 7.4], [inner, ey - 5.4]] : [[outer, ey - 5.6], [inner, ey - 7.4]];
    line(ctx, pts, 1.3);
  }
}

function drawMouth(ctx, kind, fx, my) {
  switch (kind) {
    case 'o':
      ellipse(ctx, fx, my + 0.5, 1.4, 1.7, MOUTH);
      return;
    case 'tiny':
      ellipse(ctx, fx, my + 0.6, 1, 0.9, MOUTH);
      return;
    case 'grin':
      ctx.beginPath();
      ctx.moveTo(fx - 3, my - 0.8);
      ctx.quadraticCurveTo(fx, my - 0.2, fx + 3, my - 0.8);
      ctx.quadraticCurveTo(fx, my + 4.4, fx - 3, my - 0.8);
      ctx.fillStyle = MOUTH;
      ctx.fill();
      ellipse(ctx, fx, my + 1.9, 1.5, 0.9, '#F28B9A');
      return;
    case 'tongue':
      ctx.beginPath();
      ctx.arc(fx, my - 0.8, 2.4, 0.2 * Math.PI, 0.8 * Math.PI);
      stroke(ctx);
      ellipse(ctx, fx + 0.6, my + 1.8, 1.3, 1.5, '#F28B9A', MOUTH, 0.8);
      return;
    case 'cat':
      ctx.beginPath();
      ctx.moveTo(fx - 3, my - 0.2);
      ctx.quadraticCurveTo(fx - 1.5, my + 1.8, fx, my);
      ctx.quadraticCurveTo(fx + 1.5, my + 1.8, fx + 3, my - 0.2);
      stroke(ctx, 1.2);
      return;
    case 'wavy':
      ctx.beginPath();
      ctx.moveTo(fx - 2.6, my + 1);
      ctx.quadraticCurveTo(fx - 1.3, my - 0.6, fx, my + 0.6);
      ctx.quadraticCurveTo(fx + 1.3, my + 1.8, fx + 2.6, my);
      stroke(ctx, 1.2);
      return;
    case 'frown':
      ctx.beginPath();
      ctx.arc(fx, my + 2.4, 2.2, 1.2 * Math.PI, 1.8 * Math.PI);
      stroke(ctx, 1.2);
      return;
    case 'pout':
      line(ctx, [[fx - 2, my + 0.8], [fx - 0.7, my], [fx + 0.7, my + 0.8], [fx + 2, my]], 1.1);
      return;
    case 'flat':
      line(ctx, [[fx - 1.8, my + 0.5], [fx + 1.8, my + 0.5]], 1.2);
      return;
    default:
      ctx.beginPath();
      ctx.arc(fx, my - 0.8, 2.4, 0.2 * Math.PI, 0.8 * Math.PI);
      stroke(ctx, 1.3);
  }
}

function drawHeart(ctx, x, y, s, color) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.7, y - s * 1.4, x, y - s * 0.5);
  ctx.bezierCurveTo(x + s * 0.7, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawSweat(ctx, hy) {
  ctx.beginPath();
  ctx.moveTo(16, hy - 10);
  ctx.quadraticCurveTo(20, hy - 3, 16, hy - 1.5);
  ctx.quadraticCurveTo(12.5, hy - 3, 16, hy - 10);
  ctx.fillStyle = '#9ED8F5';
  ctx.fill();
  stroke(ctx, 0.8, '#5AA9D6');
}

/** The classic manga "vein" mark. */
function drawAnger(ctx, hy, t, phase) {
  const pulse = 1 + Math.sin(t * 8 + phase) * 0.12;
  ctx.save();
  ctx.translate(13, hy - 13);
  ctx.scale(pulse, pulse);
  ctx.beginPath();
  for (const [[ax, ay], [bx, by]] of [[[-4, -1], [-1, -1]], [[1, -1], [4, -1]], [[-4, 1.5], [-1, 1.5]], [[1, 1.5], [4, 1.5]]]) {
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + bx) / 2, ay + (ay < 0 ? -2 : 2), bx, by);
  }
  stroke(ctx, 1.4, '#E5484D');
  ctx.restore();
}

function drawSparkles(ctx, hy, t, phase) {
  for (let i = 0; i < 3; i++) {
    const a = t * 2 + phase + (i * Math.PI * 2) / 3;
    ctx.save();
    ctx.translate(Math.cos(a) * 22, hy - 8 + Math.sin(a) * 12);
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const r = k % 2 === 0 ? 2.8 : 0.8;
      const ang = (k * Math.PI) / 4;
      ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    ctx.closePath();
    ctx.fillStyle = '#FDE047';
    ctx.fill();
    ctx.restore();
  }
}

function drawTears(ctx, fx, hy, t, phase) {
  const drip = (t * 1.5 + phase) % 1;
  for (const side of [-1, 1]) {
    const x = fx + side * 6;
    line(ctx, [[x, hy + 4], [x, hy + 9]], 1.8, TEAR);
    ellipse(ctx, x, hy + 9 + drip * 6, 1.3, 1.8, TEAR);
  }
}

function blushLines(ctx, cx, cy) {
  for (let i = -1; i <= 1; i++) line(ctx, [[cx + i * 1.6 - 0.6, cy + 0.9], [cx + i * 1.6 + 0.6, cy - 0.9]], 0.7, 'rgba(236,72,120,.55)');
}

/** Draws the face for `expression` (a key of EXPRESSIONS). eyeStyle 'anime' swaps in the detailed eyes. */
export function drawFace(ctx, expression, { fx, hy, t, phase, eyeStyle, eyeColor }) {
  const e = EXPRESSIONS[expression] || EXPRESSIONS.happy;
  const anime = eyeStyle === 'anime';
  const ey = hy + (anime ? 2 : 2.5);
  const blink = BLINKABLE.has(e.eyes) && (t + phase * 3) % 4.2 < 0.12;
  const eyes = blink ? 'closedFlat' : e.eyes;
  const style = { eyeStyle, eyeColor };
  drawEye(ctx, eyes, fx - 6, ey, -1, t, style);
  drawEye(ctx, eyes, fx + 6, ey, 1, t, style);
  drawBrows(ctx, e.brows, fx, ey - (anime ? 1.2 : 0));
  const blush = e.blush || 1;
  const blushColor = `rgba(255,120,130,${0.38 * Math.min(blush, 1.3)})`;
  ellipse(ctx, fx - 10, hy + 7.5, 3.2 * blush, 1.9 * blush, blushColor);
  ellipse(ctx, fx + 10, hy + 7.5, 3.2 * blush, 1.9 * blush, blushColor);
  if (anime) {
    blushLines(ctx, fx - 10, hy + 7.5);
    blushLines(ctx, fx + 10, hy + 7.5);
  }
  drawMouth(ctx, e.mouth, fx, hy + 9.5);
  if (e.extras?.includes('tears')) drawTears(ctx, fx, hy, t, phase);
}

/** Marks that float around the head (shown from the front and the back). */
/** Three little "!!" marks bursting from the top of the head. */
function drawExclaim(ctx, hy, t) {
  const pop = 1 + Math.abs(Math.sin(t * 3)) * 0.1;
  for (const [angle, len] of [[-2.55, 6], [-2.15, 7.5], [-1.75, 6]]) {
    ctx.save();
    ctx.translate(-8, hy - 8);
    ctx.rotate(angle);
    ctx.scale(pop, pop);
    ctx.beginPath();
    ctx.roundRect(15, -1.5, len, 3, 1.2);
    ctx.fillStyle = '#C4A7FF';
    ctx.fill();
    stroke(ctx, 0.9, '#5B3FA0');
    ctx.restore();
  }
}

export function drawFaceExtras(ctx, expression, { hy, t, phase }) {
  const extras = EXPRESSIONS[expression]?.extras || [];
  if (extras.includes('exclaim')) drawExclaim(ctx, hy, t);
  if (extras.includes('sweat')) drawSweat(ctx, hy);
  if (extras.includes('anger')) drawAnger(ctx, hy, t, phase);
  if (extras.includes('heart')) drawHeart(ctx, 20, hy - 6 - Math.abs(Math.sin(t * 3 + phase)) * 3, 2.6, '#F472B6');
  if (extras.includes('sparkles')) drawSparkles(ctx, hy, t, phase);
}
