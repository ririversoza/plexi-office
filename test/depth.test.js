import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DepthSorter, personNode } from '../public/js/depth.js';

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const names = (order) => order.map((n) => n.name);

test('a character sitting on a long couch is drawn after the whole couch', () => {
  // The old slicing approach let the right-hand part of the couch paint over the sitter.
  const couch = { name: 'couch', key: 21.5 + 3.45, box: box(19.9, 3.0, 23.1, 3.9) };
  const sorter = new DepthSorter([couch]);
  const sitter = { ...personNode({ x: 21.5, y: 3.75, depth: 25.25 }), name: 'sitter' };
  assert.deepEqual(names(sorter.sort([sitter])), ['couch', 'sitter']);
});

test('behind/in-front follows the floor footprint, not just x+y', () => {
  const table = { name: 'table', key: 14 + 4.1, box: box(11.6, 3.3, 16.4, 4.9) };
  const sorter = new DepthSorter([table]);
  const behind = { ...personNode({ x: 15.6, y: 2.75, depth: 18.35 }), name: 'behind' }; // larger x+y than the table
  const front = { ...personNode({ x: 12.4, y: 5.45, depth: 17.85 }), name: 'front' }; // smaller x+y than the table
  const order = names(sorter.sort([behind, front]));
  assert.ok(order.indexOf('behind') < order.indexOf('table'), order.join(','));
  assert.ok(order.indexOf('table') < order.indexOf('front'), order.join(','));
});

test('overlay parts (blankets) go over a character inside their footprint', () => {
  const base = { name: 'bed', key: 3, box: box(2, 10, 3.1, 11.9) };
  const blanket = { name: 'blanket', key: 3.2, box: box(2, 10, 3.1, 11.9), overlay: true };
  const sorter = new DepthSorter([base, blanket]);
  const sleeper = { ...personNode({ x: 2.55, y: 10.85, depth: 13.4 }), name: 'sleeper' };
  assert.deepEqual(names(sorter.sort([sleeper])), ['bed', 'sleeper', 'blanket']);
});

test('small items sitting on bigger furniture draw on top of it', () => {
  const table = { name: 'table', key: 18.1, box: box(11.6, 3.3, 16.4, 4.9) };
  const duck = { name: 'duck', key: 18.0, box: box(13.8, 3.9, 14.1, 4.2) };
  assert.deepEqual(names(new DepthSorter([duck, table]).sort([])), ['table', 'duck']);
});
