import { ValidationError } from './store.js';

/**
 * The manager's character look, as saved in data/settings.json under manager.look.
 * Everything is allow-listed: hex colours, known styles, booleans.
 */
const COLOR_KEYS = ['skin', 'hair', 'hairTip', 'hairShine', 'eyeColor', 'shirt', 'pants', 'shoes', 'dress', 'dressDark', 'ribbon', 'badge'];
const ENUMS = {
  style: ['twinbuns', 'flowing', 'long', 'bob', 'short', 'ponytail', 'bun', 'twintails', 'curly', 'spiky', 'sidepart', 'buzz'],
  eyes: ['anime', 'dot'],
  outfit: ['dress', 'suit', 'tee', 'hoodie', 'shirt', 'sweater', 'overalls'],
  accessory: ['none', 'crown', 'flower', 'sparkle', 'headphones', 'beanie'],
  idlePose: ['hips', 'stand', 'wave', 'peace', 'crossed', 'cheer'],
  idleFace: ['huff', 'happy', 'grin', 'wink', 'sparkle', 'determined', 'content', 'cat', 'pout'],
};
const BOOL_KEYS = ['choker', 'aura', 'glasses'];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function sanitizeLook(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Look must be an object.');
  const out = {};
  for (const key of COLOR_KEYS) {
    if (input[key] === undefined) continue;
    if (!HEX_RE.test(String(input[key]))) throw new ValidationError(`${key} must be a colour like #A78BFA.`);
    out[key] = String(input[key]).toUpperCase();
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (input[key] === undefined) continue;
    if (!allowed.includes(input[key])) throw new ValidationError(`${key} must be one of: ${allowed.join(', ')}.`);
    out[key] = input[key];
  }
  for (const key of BOOL_KEYS) {
    if (input[key] !== undefined) out[key] = Boolean(input[key]);
  }
  return out;
}
