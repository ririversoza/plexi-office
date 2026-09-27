import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { ValidationError } from './store.js';

/**
 * Agents draw their own desk and bed decorations as SVG. The office only ever shows
 * them as images (<img>/drawImage), where browsers run no scripts and load nothing
 * external; these checks and the response headers are a second fence for anyone who
 * opens the file directly. Stored as data/sprites/<agentId>-<slot>.svg.
 */
const DIR = path.join(DATA_DIR, 'sprites');
export const SPRITE_SLOTS = Object.freeze(['desk', 'bed']);
export const MAX_SVG_BYTES = 32 * 1024;
const MAX_SIDE = 512;

const FORBIDDEN = [
  [/<script\b/i, 'no <script>'],
  [/<foreignObject\b/i, 'no <foreignObject>'],
  [/<(iframe|embed|object|audio|video|image|feImage)\b/i, 'no embedded images or media'],
  [/\son[a-z]+\s*=/i, 'no event handlers (onclick, onload, …)'],
  [/<!ENTITY|<!DOCTYPE/i, 'no DOCTYPE or entities'],
  [/<\?(?!xml\b)/i, 'no processing instructions'],
  [/javascript:|data:(?!image\/(png|gif|jpeg|webp);base64,)/i, 'no javascript: or data: links'],
  [/(?:href|src)\s*=\s*["']\s*(?!#)/i, 'links may only point inside the file (href="#id")'],
  [/url\(\s*["']?\s*(?!#)/i, 'url() may only point inside the file (url(#id))'],
  [/@import/i, 'no @import'],
];

/** Returns the SVG (trimmed) if it's a safe, self-contained drawing, else throws a ValidationError saying why. */
export function validateSvg(input) {
  const svg = String(input ?? '').replace(/^﻿/, '').trim();
  if (!svg) throw new ValidationError('The SVG is empty.');
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES) throw new ValidationError(`Keep the SVG under ${MAX_SVG_BYTES / 1024} KB.`);
  const body = svg.replace(/^<\?xml[^>]*\?>\s*/i, '').replace(/^(<!--[\s\S]*?-->\s*)+/, '');
  if (!/^<svg\b[^>]*>/i.test(body) || !/<\/svg>\s*$/i.test(body)) throw new ValidationError('It must be a single <svg>…</svg> document.');
  const open = /^<svg\b[^>]*>/i.exec(body)[0];
  if (!/\sxmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(open)) {
    throw new ValidationError('Add xmlns="http://www.w3.org/2000/svg" to the <svg> tag.');
  }
  const viewBox = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/.exec(open);
  if (!viewBox) throw new ValidationError('Give the <svg> a viewBox, e.g. viewBox="0 0 64 64".');
  if (Number(viewBox[1]) > MAX_SIDE || Number(viewBox[2]) > MAX_SIDE) throw new ValidationError(`Keep the viewBox within ${MAX_SIDE}×${MAX_SIDE}.`);
  // The xmlns URL itself is the one allowed absolute URL.
  const scan = body.replace(/xmlns(:\w+)?\s*=\s*["'][^"']*["']/g, '');
  for (const [re, why] of FORBIDDEN) if (re.test(scan)) throw new ValidationError(`That SVG isn't allowed: ${why}.`);
  return body;
}

export class SpriteStore {
  constructor(dir = DIR) {
    this.dir = dir;
  }

  file(agentId, slot) {
    if (!SPRITE_SLOTS.includes(slot)) throw new ValidationError(`Slot must be one of: ${SPRITE_SLOTS.join(', ')}.`);
    if (!/^a_[a-f0-9]{8}$/.test(agentId)) throw new ValidationError('Unknown agent.');
    return path.join(this.dir, `${agentId}-${slot}.svg`);
  }

  /** Saves a validated SVG; returns a short version string for cache-busting. */
  save(agentId, slot, svg) {
    const clean = validateSvg(svg);
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.file(agentId, slot);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, clean);
    fs.renameSync(tmp, file);
    return crypto.createHash('sha256').update(clean).digest('hex').slice(0, 12);
  }

  read(agentId, slot) {
    try {
      return fs.readFileSync(this.file(agentId, slot), 'utf8');
    } catch {
      return null;
    }
  }

  remove(agentId) {
    for (const slot of SPRITE_SLOTS) fs.rmSync(this.file(agentId, slot), { force: true });
  }
}
