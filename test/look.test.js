import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLook } from '../server/look.js';

test('keeps valid look fields', () => {
  const look = sanitizeLook({
    hair: '#2E2553', style: 'twinbuns', eyes: 'anime', eyeColor: '#9D6BF0', outfit: 'dress',
    choker: true, aura: false, idlePose: 'hips', idleFace: 'huff',
  });
  assert.equal(look.style, 'twinbuns');
  assert.equal(look.choker, true);
  assert.equal(look.aura, false);
  assert.equal(look.idleFace, 'huff');
});

test('drops unknown keys and rejects bad values', () => {
  assert.deepEqual(sanitizeLook({ hair: '#123456', evil: '<script>' }), { hair: '#123456' });
  assert.throws(() => sanitizeLook({ hair: 'red; background:url(x)' }), /hair/);
  assert.throws(() => sanitizeLook({ style: 'mohawk' }), /style/);
  assert.throws(() => sanitizeLook({ idlePose: 'moonwalk' }), /idlePose/);
  assert.throws(() => sanitizeLook('nope'), /object/);
});
