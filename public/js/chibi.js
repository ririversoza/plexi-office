// Chibi characters, drawn procedurally. Proportions follow the classic chibi
// guide: head ≈ body height (1:1), short neck, round torso with no waist,
// round joints, and simple mitten hands.
import { ellipse, shade } from './iso.js';
import { drawFace, drawFaceExtras } from './chibi-face.js';
import { HR, HY, OUT, limb } from './chibi-base.js';
import {
  drawAura, drawBootLegs, drawBuns, drawChoker, drawDress, drawFlowingHairBack, drawFlowingHairBackView,
  drawFlowingHairFront, drawPuffSleeves, hasFlowingHair,
} from './chibi-deluxe.js';

const SKINS = ['#FFE3CC', '#F9D3B4', '#EFC09A', '#D9A57E', '#B98160', '#8D5B3E'];
const HAIRS = ['#2E2A2A', '#4A3226', '#7A4E2D', '#C98F4A', '#E8C27A', '#F2B8C6', '#9CC3E6', '#B7A2E0', '#EDEDED', '#D96C4F'];
const SHIRTS = ['#9AD0C2', '#F7B2BD', '#FFD6A5', '#BDE0FE', '#CDB4DB', '#FDF2A6', '#A0C4FF', '#FFC6FF', '#CAFFBF', '#F4A261'];
const PANTS = ['#6C8EBF', '#3D405B', '#8D99AE', '#E9C46A', '#5E548E', '#F1F1F1', '#2A9D8F'];
const SHOES = ['#3F3F46', '#FFFFFF', '#E76F51', '#264653', '#8B5E3C'];
const STYLES = ['short', 'bob', 'spiky', 'long', 'bun', 'twintails', 'curly', 'ponytail', 'buzz'];
const OUTFITS = ['tee', 'hoodie', 'shirt', 'sweater', 'overalls'];

export const SIT_POSES = new Set(['desk', 'guest', 'couch', 'bench', 'beanbag', 'argue', 'bed']);
const HOLDS_MUG = new Set(['coffee', 'sip', 'snack']);
const ARMS_HIDDEN_FROM_BEHIND = new Set(['desk', 'arcade', 'couch', 'coffee', 'sip', 'snack', 'crossed']);
// Hands that touch the face are drawn over the head from the front.
const HANDS_OVER_FACE = new Set(['cheeks', 'facepalm', 'peace', 'think']);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic look for an agent. */
export function makeLook(seed, { type, role, badge }) {
  const rnd = mulberry32(seed || 1);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const look = {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    style: pick(STYLES),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    shoes: pick(SHOES),
    outfit: pick(OUTFITS),
    glasses: rnd() < 0.22,
    badge,
    accessory: null,
  };
  const r = rnd();
  if (role === 'assistant') return { ...look, accessory: 'clipboard', glasses: true, outfit: 'shirt', shirt: '#FCEBCB' };
  if (role === 'hr') return { ...look, accessory: 'flower', outfit: 'sweater', shirt: '#FBDDEA' };
  if (type === 'claude') return { ...look, accessory: 'sparkle' };
  if (type === 'codex' && r < 0.55) return { ...look, accessory: 'headphones' };
  if (type === 'cursor' && r < 0.55) return { ...look, accessory: 'beanie' };
  return look;
}

/** Manager presets. Starlight: twin buns, violet eyes, lavender dress (the default). */
export const MANAGER_PRESETS = {
  starlight: {
    skin: '#FCE3D6', hair: '#2E2553', hairTip: '#9A62E0', hairShine: '#A78BFA', style: 'twinbuns',
    eyes: 'anime', eyeColor: '#9D6BF0', outfit: 'dress', dress: '#D9C8F7', dressDark: '#4B2E8C', ribbon: '#7C3AED',
    shirt: '#D9C8F7', pants: '#4B2E8C', shoes: '#3B2A63', badge: '#9D6BF0', accessory: 'none', choker: true,
    glasses: false, aura: true, idlePose: 'hips', idleFace: 'huff',
  },
  boss: {
    skin: '#F6CFB0', hair: '#3A2A26', hairTip: '#3A2A26', hairShine: '#6B5A55', style: 'sidepart',
    eyes: 'dot', eyeColor: '#3B2C2C', outfit: 'suit', dress: '#34425E', dressDark: '#1F2937', ribbon: '#F2B84B',
    shirt: '#34425E', pants: '#2B3145', shoes: '#2A2A2E', badge: '#F2B84B', accessory: 'crown', choker: false,
    glasses: false, aura: false, idlePose: 'stand', idleFace: 'happy',
  },
};
export const MANAGER_LOOK = MANAGER_PRESETS.starlight;

// ── body ────────────────────────────────────────────────────────────────────

function torsoPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-8, -28);
  ctx.quadraticCurveTo(-11.5, -19, -10.2, -10);
  ctx.quadraticCurveTo(0, -7.2, 10.2, -10);
  ctx.quadraticCurveTo(11.5, -19, 8, -28);
  ctx.quadraticCurveTo(0, -30.5, -8, -28);
  ctx.closePath();
}

function drawLegs(ctx, look, o, sitting) {
  if (sitting) {
    if (o.view === 'back') return;
    for (const lx of [-4.5, 4.5]) {
      limb(ctx, lx, -7, lx * 1.1, -2.5, look.pants, 6);
      ellipse(ctx, lx * 1.1, -0.8, 4, 2.6, look.shoes, OUT, 1.2);
    }
    return;
  }
  const lift = o.pose === 'walk' ? Math.sin(o.t * 11 + o.phase) * 2.4 : 0;
  for (const [lx, up] of [[-4.5, Math.max(0, lift)], [4.5, Math.max(0, -lift)]]) {
    limb(ctx, lx, -11, lx, -2.5 - up, look.pants, 6.4);
    ellipse(ctx, lx + 0.5, -1.2 - up, 4.2, 2.7, look.shoes, OUT, 1.2);
  }
}

function drawOutfitFill(ctx, look, front) {
  if (look.outfit === 'overalls') {
    ctx.fillStyle = look.pants;
    ctx.fillRect(-10, -20, 20, 12);
    if (front) {
      ctx.fillRect(-6, -27, 3, 8);
      ctx.fillRect(3, -27, 3, 8);
    }
  } else {
    ctx.fillStyle = look.pants;
    ctx.fillRect(-12, -13.2, 24, 6);
  }
  if (look.outfit === 'sweater') {
    ctx.fillStyle = shade(look.shirt, -0.12);
    ctx.fillRect(-12, -21, 24, 3);
  }
  if (look.outfit === 'suit' && front) {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(-4, -29);
    ctx.lineTo(4, -29);
    ctx.lineTo(0, -19);
    ctx.fill();
    ctx.fillStyle = look.badge;
    ctx.beginPath();
    ctx.moveTo(-1.5, -27.5);
    ctx.lineTo(1.5, -27.5);
    ctx.lineTo(2.2, -18);
    ctx.lineTo(0, -15.5);
    ctx.lineTo(-2.2, -18);
    ctx.fill();
  }
}

function drawOutfitDetails(ctx, look) {
  if (look.outfit === 'shirt') {
    ctx.fillStyle = '#FFFFFF';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, -27);
      ctx.lineTo(s * 5, -28.5);
      ctx.lineTo(s * 3, -24);
      ctx.fill();
    }
    for (let i = 0; i < 3; i++) ellipse(ctx, 0, -23 + i * 4, 0.8, 0.8, OUT);
  } else if (look.outfit === 'hoodie') {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.2;
    for (const s of [-2.2, 2.2]) {
      ctx.beginPath();
      ctx.moveTo(s, -27);
      ctx.lineTo(s, -21);
      ctx.stroke();
    }
    ctx.strokeStyle = shade(look.shirt, -0.2);
    ctx.beginPath();
    ctx.moveTo(-6, -16);
    ctx.quadraticCurveTo(0, -14, 6, -16);
    ctx.stroke();
  } else if (look.outfit === 'tee') {
    ctx.strokeStyle = shade(look.shirt, -0.2);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, -29, 4.2, 0.25, Math.PI - 0.25);
    ctx.stroke();
  }
  if (look.badge && look.outfit !== 'suit') {
    ctx.strokeStyle = shade(look.badge, -0.1);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-3.5, -28);
    ctx.lineTo(4.6, -20.5);
    ctx.lineTo(3.5, -28.5);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(2.4, -21, 4.6, 5.6);
    ctx.fillStyle = look.badge;
    ctx.fillRect(2.9, -20.5, 3.6, 2.2);
  }
}

function drawTorso(ctx, look, o) {
  const front = o.view === 'front';
  torsoPath(ctx);
  ctx.fillStyle = look.shirt;
  ctx.fill();
  ctx.save();
  torsoPath(ctx);
  ctx.clip();
  drawOutfitFill(ctx, look, front);
  ctx.restore();
  torsoPath(ctx);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  if (front) drawOutfitDetails(ctx, look);
  else if (look.outfit === 'hoodie') ellipse(ctx, 0, -27, 8, 3.5, shade(look.shirt, -0.08), OUT, 1.2);
}

function handTargets(o) {
  const { t, phase: ph } = o;
  const sway = Math.sin(t * 2 + ph) * 0.8;
  switch (o.pose) {
    case 'walk': {
      const swing = Math.sin(t * 11 + ph) * 2.8;
      return [[-11, -14 + swing], [11, -14 - swing]];
    }
    case 'desk':
      if (o.expression === 'sleep') return [[-6, -19], [6, -19]];
      return [[-5.5, -18 + Math.abs(Math.sin(t * 15 + ph)) * 1.6], [5.5, -18 + Math.abs(Math.cos(t * 13 + ph)) * 1.6]];
    case 'raise':
      return [[-11, -14], [12.5, -52 + Math.sin(t * 7 + ph) * 2.2]];
    case 'guest':
      return Math.sin(t * 1.4 + ph) > 0.35 ? [[-5, -12], [12, -48 + Math.sin(t * 7) * 2]] : [[-5, -12], [5, -12]];
    case 'bench':
    case 'beanbag':
      return [[-5.5, -11.5], [5.5, -11.5]];
    case 'couch':
      return [[-5, -12], [4.5, -20]];
    case 'coffee':
    case 'sip':
    case 'snack':
      return [[-11, -14 + sway], Math.sin(t * 1.1 + ph) > 0.6 ? [3.5, -31] : [7.5, -18]];
    case 'arcade':
      return [[-4, -19 + Math.sin(t * 20 + ph) * 1.2], [4, -19 + Math.cos(t * 17 + ph) * 1.2]];
    case 'pingpong':
      return [[-10.5, -15], [12 + Math.sin(t * 4.8 + ph) * 3, -21 + Math.cos(t * 4.8 + ph) * 4]];
    case 'argue': {
      const g = Math.sin(t * 5 + ph) * 4;
      return [[-12, -26 + g], [12, -26 - g]];
    }
    case 'point':
      return [[-10, -16], [11, -38 + Math.sin(t * 3 + ph)]];
    case 'pace':
    case 'think':
      return [[-3, -19], [3, -31]];
    case 'wave':
      return [[-11, -14], [13 + Math.sin(t * 9 + ph) * 3, -46]];
    case 'peace':
      return [[-11, -14 + sway], [9, -37]];
    case 'stretch':
      return [[-6 + Math.sin(t * 2) * 1.5, -60], [6 + Math.sin(t * 2) * 1.5, -60]];
    case 'cheer': {
      const hop = Math.abs(Math.sin(t * 8 + ph)) * 3;
      return [[-15, -50 - hop], [15, -50 - hop]];
    }
    case 'cheeks':
      return [[-12.5, -36], [12.5, -36]];
    case 'facepalm':
      return [[-11, -14], [5, -41]];
    case 'crossed':
      return [[5, -19], [-5, -20]];
    case 'chat':
      return [[-11, -14], [13, -24 + Math.sin(t * 6 + ph) * 3]];
    case 'highfive':
      return [[-11, -14], [12, -50]];
    case 'bed':
      return [[-5, -12], [5, -12]];
    case 'hug':
      return [[7, -23], [14, -24]];
    case 'shrug':
      return [[-15, -28], [15, -28]];
    case 'hips':
      // hands on hips, elbows out (third/fourth values are the elbow)
      return [[-9.2, -15.8, -15.6, -20.5], [9.2, -15.8, 15.6, -20.5]];
    default:
      return [[-11.5, -14 + sway], [11.5, -14 - sway]];
  }
}

function drawHeldItems(ctx, look, o, hands) {
  const [rx, ry] = hands[1];
  if (HOLDS_MUG.has(o.pose)) {
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1;
    ctx.fillRect(rx - 2, ry - 7, 5, 6);
    ctx.strokeRect(rx - 2, ry - 7, 5, 6);
    ctx.fillStyle = look.badge || '#E07A5F';
    ctx.fillRect(rx - 2, ry - 5, 5, 1.6);
  } else if (o.pose === 'peace') {
    ctx.lineCap = 'round';
    for (const dx of [-1.6, 1.6]) limb(ctx, rx + dx * 0.4, ry - 2, rx + dx, ry - 7.5, look.skin, 1.8);
  } else if (o.pose === 'wave' || o.pose === 'highfive') {
    ctx.strokeStyle = 'rgba(74,52,56,.45)';
    ctx.lineWidth = 1;
    for (const r of [5.5, 8]) {
      ctx.beginPath();
      ctx.arc(rx, ry, r, -0.9, -0.2);
      ctx.stroke();
    }
  } else if (o.pose === 'pingpong') {
    ellipse(ctx, rx + 2, ry - 3, 4, 4.5, '#E63946', OUT, 1);
  } else if (o.pose === 'couch' && o.view === 'front') {
    ctx.fillStyle = '#2F3542';
    ctx.fillRect(rx - 3, ry - 6, 6, 8);
    ctx.fillStyle = '#7DD3FC';
    ctx.fillRect(rx - 2.2, ry - 5.2, 4.4, 5.8);
  }
  if (look.accessory === 'clipboard' && !SIT_POSES.has(o.pose) && o.pose !== 'raise') {
    const [lx, ly] = hands[0];
    ctx.fillStyle = '#B7835A';
    ctx.fillRect(lx - 4, ly - 9, 8, 10);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(lx - 3, ly - 7.5, 6, 7.5);
  }
}

function drawArms(ctx, look, o, hands) {
  const shoulders = [[-8, -25.5], [8, -25.5]];
  const dress = look.outfit === 'dress';
  hands.forEach(([hx, hy, ex, ey], i) => {
    const [sx, sy] = shoulders[i];
    limb(ctx, sx, sy, hx, hy, dress ? look.skin : look.shirt, dress ? 4.4 : 5.2, ex === undefined ? null : [ex, ey]);
    ellipse(ctx, hx, hy, 3.1, 3.1, look.skin, OUT, 1.2);
  });
  if (dress) drawPuffSleeves(ctx, look);
  drawHeldItems(ctx, look, o, hands);
}

// ── head ────────────────────────────────────────────────────────────────────
const FRINGE = [[15.5, 2], [12, -6], [7, -3.5], [3, -8], [-2, -4], [-7, -8.5], [-11, -4], [-15.5, 2]];

function capPath(ctx, fx, fringe = FRINGE) {
  ctx.beginPath();
  ctx.moveTo(-16.8, HY + 2);
  ctx.bezierCurveTo(-18, HY - 22, 18, HY - 22, 16.8, HY + 2);
  for (const [x, y] of fringe) ctx.lineTo(x + (Math.abs(x) < 14 ? fx : 0), HY + y);
  ctx.closePath();
}

function fillHair(ctx, look) {
  ctx.fillStyle = look.hair;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = OUT;
  ctx.stroke();
}

function drawHairBehind(ctx, look, o) {
  const s = look.style;
  if (s === 'twinbuns') drawBuns(ctx, look);
  if (o.view === 'front' && s === 'bob') {
    ctx.beginPath();
    ctx.ellipse(0, HY + 1, 18.8, 17.4, 0, 0, Math.PI * 2);
    fillHair(ctx, look);
  }
  if (s === 'twintails') {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 20, HY + 8, 5.5, 10.5, side * 0.35, 0, Math.PI * 2);
      fillHair(ctx, look);
    }
  }
  if (s === 'bun' && look.accessory !== 'beanie') {
    ctx.beginPath();
    ctx.arc(0, HY - 16.5, 6.5, 0, Math.PI * 2);
    fillHair(ctx, look);
  }
  if (s === 'curly') {
    for (let a = 0; a < 7; a++) {
      const ang = Math.PI * (0.95 + a * 0.185);
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * 15.5, HY + Math.sin(ang) * 15.5, 6.2, 0, Math.PI * 2);
      fillHair(ctx, look);
    }
  }
}



function drawBackHair(ctx, look) {
  const s = look.style;
  ctx.save();
  ctx.beginPath();
  const cut = s === 'bob' ? 13 : s === 'buzz' ? 5 : 9;
  ctx.rect(-40, HY - 40, 80, 40 + cut);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(0, HY - 0.5, 17.6, 16.8, 0, 0, Math.PI * 2);
  fillHair(ctx, look);
  ctx.restore();
  if (s === 'ponytail') {
    ctx.beginPath();
    ctx.ellipse(0, HY + 17, 5, 11, 0, 0, Math.PI * 2);
    fillHair(ctx, look);
  }
}

function drawHairFront(ctx, look, o, fx) {
  const s = look.style;
  if (look.accessory === 'beanie') return;
  if (hasFlowingHair(look)) {
    if (o.view === 'back') drawFlowingHairBackView(ctx, look, o);
    else drawFlowingHairFront(ctx, look, o, fx);
    if (o.view === 'back' && s === 'twinbuns') drawBuns(ctx, look);
    return;
  }
  if (o.view === 'back') {
    drawBackHair(ctx, look);
  } else if (s === 'curly') {
    for (let a = 0; a < 8; a++) {
      const ang = Math.PI * (1.08 + a * 0.12);
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * 13 + fx * 0.4, HY - 2 + Math.sin(ang) * 12, 5.4, 0, Math.PI * 2);
      fillHair(ctx, look);
    }
  } else if (s === 'buzz') {
    capPath(ctx, fx, [[15.5, -4], [8, -9], [0, -10], [-8, -9], [-15.5, -4]]);
    fillHair(ctx, look);
  } else if (s === 'sidepart') {
    capPath(ctx, fx, [[16, 1], [13, -7], [4, -9], [-6, -6], [-12, -1], [-16, 2]]);
    fillHair(ctx, look);
  } else {
    capPath(ctx, fx);
    fillHair(ctx, look);
    if (s === 'bob') {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(side * 15.8 - 3, HY - 4, 6, 17, 3);
        fillHair(ctx, look);
      }
    }
  }
  if (s === 'spiky') {
    ctx.beginPath();
    ctx.moveTo(-13, HY - 10);
    ctx.lineTo(-9, HY - 24);
    ctx.lineTo(-4, HY - 14);
    ctx.lineTo(1, HY - 27);
    ctx.lineTo(5, HY - 14);
    ctx.lineTo(10, HY - 23);
    ctx.lineTo(13, HY - 10);
    fillHair(ctx, look);
  }
}

function drawSparkle(ctx, cx, cy, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 5 : 1.6;
    const a = (i * Math.PI) / 4;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawBeanie(ctx, color) {
  ctx.beginPath();
  ctx.moveTo(-17.6, HY - 3);
  ctx.bezierCurveTo(-18, HY - 25, 18, HY - 25, 17.6, HY - 3);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-18.2, HY - 7, 36.4, 6.5, 3);
  ctx.fillStyle = shade(color, -0.18);
  ctx.fill();
  ctx.stroke();
  ellipse(ctx, 0, HY - 21, 4.2, 4.2, '#FFFFFF', OUT, 1.2);
}

function drawCrown(ctx) {
  ctx.beginPath();
  ctx.moveTo(-8, HY - 15);
  ctx.lineTo(-8, HY - 23);
  ctx.lineTo(-4, HY - 19);
  ctx.lineTo(0, HY - 25);
  ctx.lineTo(4, HY - 19);
  ctx.lineTo(8, HY - 23);
  ctx.lineTo(8, HY - 15);
  ctx.closePath();
  ctx.fillStyle = '#F7C948';
  ctx.fill();
  ctx.strokeStyle = '#A67C00';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ellipse(ctx, 0, HY - 18, 1.5, 1.5, '#E5484D');
}

function drawAccessory(ctx, look, o, fx) {
  const front = o.view === 'front';
  switch (look.accessory) {
    case 'sparkle':
      drawSparkle(ctx, front ? -10 + fx : 10, front ? HY - 11 : HY - 9, look.badge || '#D97757');
      break;
    case 'headphones':
      ctx.strokeStyle = '#3A3F4B';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, HY, 18.6, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      for (const side of [-1, 1]) ellipse(ctx, side * 17.6, HY + 2, 4.2, 5.6, '#3A3F4B', look.badge, 1.6);
      break;
    case 'beanie':
      drawBeanie(ctx, look.badge);
      break;
    case 'flower': {
      const [cx, cy] = front ? [-11 + fx, HY - 10] : [11, HY - 9];
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI) / 5;
        ellipse(ctx, cx + Math.cos(a) * 3, cy + Math.sin(a) * 3, 2.6, 2.6, '#F9A8D4', OUT, 0.6);
      }
      ellipse(ctx, cx, cy, 1.8, 1.8, '#FDE047');
      break;
    }
    case 'crown':
      drawCrown(ctx);
      break;
    default:
      break;
  }
  if (look.glasses && front) {
    ctx.strokeStyle = '#3F3F46';
    ctx.lineWidth = 1.3;
    for (const ex of [fx - 6, fx + 6]) {
      ctx.beginPath();
      ctx.arc(ex, HY + 2.5, 4.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(fx - 1.6, HY + 2);
    ctx.lineTo(fx + 1.6, HY + 2);
    ctx.stroke();
  }
}


function drawHead(ctx, look, o) {
  const fx = o.view === 'front' ? 2.2 : 0;
  ctx.save();
  if (o.pose === 'bed') {
    ctx.translate(0, 4);
    ctx.rotate(-0.28);
  } else if (o.expression === 'sleep' && o.pose === 'desk') {
    ctx.translate(0, 3);
    ctx.rotate(0.14);
  } else if (o.pose === 'nod') {
    ctx.translate(0, Math.abs(Math.sin(o.t * 6 + o.phase)) * 1.8);
  } else if (o.expression === 'laugh') {
    ctx.translate(0, Math.abs(Math.sin(o.t * 12)) * -1.2);
  } else if (o.headTilt) {
    ctx.translate(0, HY);
    ctx.rotate(o.headTilt);
    ctx.translate(0, -HY);
  }
  drawHairBehind(ctx, look, o);
  for (const side of [-1, 1]) ellipse(ctx, side * 15.8, HY + 2, 3.2, 3.9, look.skin, OUT, 1.2);
  ctx.beginPath();
  ctx.ellipse(0, HY, HR + 0.5, HR - 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = look.skin;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  const faceOpts = { fx, hy: HY, t: o.t, phase: o.phase, eyeStyle: look.eyes, eyeColor: look.eyeColor };
  if (o.view === 'front') drawFace(ctx, o.expression, faceOpts);
  drawHairFront(ctx, look, o, fx);
  drawAccessory(ctx, look, o, fx);
  drawFaceExtras(ctx, o.expression, faceOpts);
  ctx.restore();
}

/**
 * Draws a chibi with feet at (o.x, o.y).
 * o: { view: 'front'|'back', flip, pose (arm gesture), sitting, sitLow, expression, t, phase, scale, ring, happyHop, headTilt }
 */
export function drawChibi(ctx, look, o) {
  const sitting = o.sitting ?? SIT_POSES.has(o.pose);
  const sitLow = o.sitLow ?? o.pose === 'beanbag';
  const s = o.scale || 1;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(o.flip ? -s : s, s);
  if (!sitting) ellipse(ctx, 0, 0, 12, 4.4, 'rgba(40,30,60,.16)');
  if (o.ring) ellipse(ctx, 0, sitting ? 4 : 0, 16, 6, null, o.ring, 2.2);
  let bounce = Math.sin(o.t * 2 + o.phase) * 0.5;
  if (o.pose === 'walk') bounce = -Math.abs(Math.sin(o.t * 11 + o.phase)) * 2;
  else if (o.happyHop) bounce = -Math.abs(Math.sin(o.t * 9)) * 5;
  const drop = sitting ? (sitLow ? 10 : 6) : 0;
  ctx.translate(0, bounce + drop - (o.lift || 0));

  const hands = handTargets(o);
  const armsBehind = o.view === 'back' && ARMS_HIDDEN_FROM_BEHIND.has(o.pose);
  const armsOverHead = o.view === 'front' && HANDS_OVER_FACE.has(o.pose);
  const dress = look.outfit === 'dress';
  if (o.view === 'front' && hasFlowingHair(look)) drawFlowingHairBack(ctx, look, o);
  if (dress) drawBootLegs(ctx, look, o, sitting);
  else drawLegs(ctx, look, o, sitting);
  if (armsBehind) drawArms(ctx, look, o, hands);
  if (dress) drawDress(ctx, look, o);
  else drawTorso(ctx, look, o);
  if (!armsBehind && !armsOverHead) drawArms(ctx, look, o, hands);
  drawHead(ctx, look, o);
  if (dress && look.choker && o.view === 'front') drawChoker(ctx, look);
  if (armsOverHead) drawArms(ctx, look, o, hands);
  if (look.aura) drawAura(ctx, o);
  ctx.restore();
}

/** Head-and-shoulders portrait for UI avatars. */
export function drawPortrait(canvas, look, { expression = 'happy', t = 0 } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || canvas.width;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const scale = size / 48;
  drawChibi(ctx, look, { x: size / 2, y: size * 1.42, view: 'front', flip: false, pose: 'stand', expression, t, phase: 0, scale });
}
