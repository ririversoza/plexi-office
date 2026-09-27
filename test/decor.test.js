import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_DECOR, sanitizeDecor } from '../server/decor.js';

test('agents pick up to three desk items and bed touches from the catalog', () => {
  const d = sanitizeDecor({ desk: { items: 'Plant, lamp,duck,plant', color: 'Mint' }, bed: { blanket: 'lavender', plush: 'CAT', lights: 'yes' } });
  assert.deepEqual(d.desk, { items: ['plant', 'lamp', 'duck'], color: 'mint' });
  assert.deepEqual(d.bed, { blanket: 'lavender', pillow: null, plush: 'cat', lights: true });
});

test('changes merge into what they already have; empty values clear a colour', () => {
  const first = sanitizeDecor({ desk: { items: ['books'] }, bed: { pillow: 'peach' } });
  const next = sanitizeDecor({ bed: { blanket: 'sky', pillow: '' } }, first);
  assert.deepEqual(next.desk.items, ['books']);
  assert.equal(next.bed.blanket, 'sky');
  assert.equal(next.bed.pillow, null);
  assert.deepEqual(sanitizeDecor({}), EMPTY_DECOR);
});

test('anything outside the catalog is refused', () => {
  assert.throws(() => sanitizeDecor({ desk: { items: ['plant', 'flamethrower'] } }), /Unknown desk item/);
  assert.throws(() => sanitizeDecor({ desk: { items: ['plant', 'lamp', 'duck', 'mug'] } }), /fits 3/);
  assert.throws(() => sanitizeDecor({ bed: { blanket: '#ff0000' } }), /Blanket colour must be/);
  assert.throws(() => sanitizeDecor({ bed: { plush: 'dragon' } }), /Plushie must be/);
  assert.throws(() => sanitizeDecor('nope'), /must be an object/);
});
