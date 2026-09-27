import { ValidationError } from './store.js';
import { COLORS, DESK_ITEMS, MAX_DESK_ITEMS, PLUSHIES } from '../public/js/decor-catalog.js';

export { COLORS, DESK_ITEMS, MAX_DESK_ITEMS, PLUSHIES };

/** An agent's own desk and bed decorations (see public/js/decor-catalog.js). Nothing is set until they choose. */
export const EMPTY_DECOR = Object.freeze({
  desk: { items: [], color: null }, bed: { blanket: null, pillow: null, plush: 'none', lights: false }, sprites: { desk: null, bed: null },
});

function color(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const key = String(value).trim().toLowerCase();
  if (!Object.hasOwn(COLORS, key)) throw new ValidationError(`${label} must be one of: ${Object.keys(COLORS).join(', ')}.`);
  return key;
}

function deskItems(value) {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : String(value).split(',');
  const keys = [...new Set(list.map((v) => String(v).trim().toLowerCase()).filter(Boolean))];
  const unknown = keys.filter((k) => !Object.hasOwn(DESK_ITEMS, k));
  if (unknown.length) throw new ValidationError(`Unknown desk item(s): ${unknown.join(', ')}. Pick from: ${Object.keys(DESK_ITEMS).join(', ')}.`);
  if (keys.length > MAX_DESK_ITEMS) throw new ValidationError(`Your desk fits ${MAX_DESK_ITEMS} things; pick your favourites.`);
  return keys;
}

/**
 * Merges a partial change into the current decor, validating every value against the catalog.
 * `sprites` (versions of the agent's own SVGs) only ever comes from the server, never from input.
 */
export function sanitizeDecor(input = {}, current = EMPTY_DECOR, { sprites } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Decor must be an object.');
  const base = { desk: { ...EMPTY_DECOR.desk, ...(current?.desk || {}) }, bed: { ...EMPTY_DECOR.bed, ...(current?.bed || {}) } };
  const desk = input.desk || {};
  const bed = input.bed || {};
  const plush = bed.plush === undefined ? undefined : String(bed.plush).trim().toLowerCase();
  if (plush !== undefined && !Object.hasOwn(PLUSHIES, plush)) throw new ValidationError(`Plushie must be one of: ${Object.keys(PLUSHIES).join(', ')}.`);
  const pick = (next, prev) => (next === undefined ? prev : next);
  const drawn = { ...EMPTY_DECOR.sprites, ...(current?.sprites || {}), ...(sprites || {}) };
  const next = {
    desk: {
      items: pick(deskItems(desk.items), base.desk.items),
      color: pick(color(desk.color, 'Desk colour'), base.desk.color),
    },
    bed: {
      blanket: pick(color(bed.blanket, 'Blanket colour'), base.bed.blanket),
      pillow: pick(color(bed.pillow, 'Pillow colour'), base.bed.pillow),
      plush: pick(plush, base.bed.plush),
      lights: bed.lights === undefined ? base.bed.lights : Boolean(bed.lights),
    },
    sprites: drawn,
  };
  if (next.desk.items.includes('custom') && !drawn.desk) throw new ValidationError('Draw your desk piece first: plexi decor draw --desk FILE.svg');
  if (next.bed.plush === 'custom' && !drawn.bed) throw new ValidationError('Draw your bed piece first: plexi decor draw --bed FILE.svg');
  return next;
}
