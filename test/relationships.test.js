import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { RelationshipStore, labelFor, pairKey } from '../server/relationships.js';
import { compatibility } from '../server/personality.js';

function makeStore() {
  let t = 1_000_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plexi-rel-'));
  const store = new RelationshipStore(path.join(dir, 'relationships.json'), { now: () => t, rng: () => 0.5 });
  return { store, advance: (ms) => { t += ms; }, dir };
}

const sunny = { id: 'a1', personality: 'sunny', type: 'claude' };
const cheer = { id: 'a2', personality: 'cheerleader', type: 'codex' };
const poet = { id: 'a3', personality: 'poet', type: 'claude' };
const minimal = { id: 'a4', personality: 'minimalist', type: 'cursor' };

test('pair keys are order independent', () => {
  assert.equal(pairKey('b', 'a'), pairKey('a', 'b'));
});

test('labels follow affinity and romance thresholds', () => {
  assert.equal(labelFor({ affinity: 0, romance: 0 }).key, 'coworkers');
  assert.equal(labelFor({ affinity: 35, romance: 0 }).key, 'friends');
  assert.equal(labelFor({ affinity: 70, romance: 0 }).key, 'bestfriends');
  assert.equal(labelFor({ affinity: -40, romance: 0 }).key, 'rivals');
  assert.equal(labelFor({ affinity: -70, romance: 0 }).key, 'enemies');
  assert.equal(labelFor({ affinity: 50, romance: 45 }).key, 'crush');
  assert.equal(labelFor({ affinity: 80, romance: 80 }).key, 'sweethearts');
  assert.equal(labelFor({ affinity: 80, romance: 80 }, { romance: false }).key, 'bestfriends', 'romance can be switched off');
});

test('compatible personalities warm up, clashing ones cool down', () => {
  assert.ok(compatibility('sunny', 'cheerleader') > 0);
  assert.ok(compatibility('poet', 'minimalist') < 0);
  assert.equal(compatibility('sunny', 'cheerleader'), compatibility('cheerleader', 'sunny'));
  const { store, advance } = makeStore();
  for (let i = 0; i < 10; i++) {
    store.interact(sunny, cheer, 'chat');
    store.interact(poet, minimal, 'argue');
    advance(60_000);
  }
  assert.ok(store.get('a1', 'a2').affinity > 30, 'sunny + cheerleader become friends');
  assert.ok(store.get('a3', 'a4').affinity < -30, 'poet + minimalist become rivals');
});

test('interactions are rate limited per pair', () => {
  const { store, advance } = makeStore();
  const first = store.interact(sunny, cheer, 'highfive');
  const second = store.interact(sunny, cheer, 'highfive');
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  advance(20_000);
  assert.equal(store.interact(sunny, cheer, 'highfive').applied, true);
});

test('label changes are reported and romance stays at zero when disabled', () => {
  const { store, advance } = makeStore();
  let changed = null;
  for (let i = 0; i < 40; i++) {
    const r = store.interact(sunny, cheer, 'highfive', { romance: false });
    if (r.changed) changed = r;
    advance(60_000);
  }
  assert.ok(changed, 'at least one label change');
  assert.equal(store.get('a1', 'a2').romance, 0);
});

test('relationships persist and are removed with an agent', () => {
  const { store, advance, dir } = makeStore();
  store.interact(sunny, cheer, 'chat');
  advance(60_000);
  store.interact(sunny, poet, 'chat');
  store.flush();
  const reloaded = new RelationshipStore(path.join(dir, 'relationships.json')).load();
  assert.equal(reloaded.list().length, 2);
  reloaded.removeAgent('a1');
  assert.equal(reloaded.list().length, 0);
});

test('working together counts, and clashing personalities sour even while collaborating', () => {
  const { store, advance } = makeStore();
  for (let i = 0; i < 12; i++) {
    store.interact(sunny, cheer, 'teamwork');
    store.interact(poet, minimal, 'teamwork');
    advance(60_000);
  }
  assert.ok(store.get('a1', 'a2').affinity > 30, 'kindred spirits become friends');
  assert.ok(store.get('a3', 'a4').affinity < 0, 'a clashing pair drifts apart even on shared work');
});

test('an HR sanction hurts, and server-side events skip the break-room cooldown', () => {
  const { store } = makeStore();
  store.interact(sunny, cheer, 'teamwork', { cooldown: false });
  const hit = store.interact(sunny, cheer, 'sanction', { cooldown: false });
  assert.equal(hit.applied, true);
  assert.ok(store.get('a1', 'a2').affinity < 0);
  assert.equal(store.interact(sunny, cheer, 'nonsense', { cooldown: false }).applied, false);
});

test('a snipe in the chat can drive a pair to enemies', () => {
  const { store, advance } = makeStore();
  for (let i = 0; i < 10; i++) {
    store.interact(poet, minimal, 'argue');
    advance(60_000);
  }
  assert.equal(labelFor(store.get('a3', 'a4')).key, 'enemies');
});

test('forAgent lists one agent\'s relationships, closest first', () => {
  const { store, advance } = makeStore();
  store.interact(sunny, cheer, 'highfive');
  advance(60_000);
  store.interact(sunny, poet, 'argue');
  store.interact(cheer, poet, 'chat');
  const mine = store.forAgent('a1');
  assert.deepEqual(mine.map((r) => r.other), ['a2', 'a3']);
  assert.ok(mine[0].affinity > mine[1].affinity);
  assert.ok(mine[0].label.label);
});

test('a new crush makes the one left behind jealous: they cool on the fickle one and become rivals with the new crush', () => {
  const { store } = makeStore();
  store.pairs = {
    [pairKey('a1', 'a2')]: { affinity: 60, romance: 60, interactions: 20, updatedAt: 0 }, // a1 & a2 crushing
    [pairKey('a1', 'a3')]: { affinity: 50, romance: 39, interactions: 20, updatedAt: 0 }, // a1 & a3 almost
    [pairKey('a2', 'a3')]: { affinity: 20, romance: 0, interactions: 5, updatedAt: 0 },
  };
  const spark = { ...poet, personality: 'sunny' }; // a1|a3 has chemistry, so one high-five tips them into a crush
  const result = store.interact(sunny, spark, 'highfive', { cooldown: false });
  assert.equal(labelFor(store.get('a1', 'a3')).key, 'crush', 'a1 now crushes on a3');
  assert.equal(result.jealousy.length, 1);
  const [{ jealous, fickle, crush, changes }] = result.jealousy;
  assert.deepEqual([jealous, fickle, crush], ['a2', 'a1', 'a3']);
  assert.equal(labelFor(store.get('a1', 'a2')).key, 'friends', 'the jilted crush cools off');
  assert.equal(store.get('a1', 'a2').romance, 20);
  assert.equal(labelFor(store.get('a2', 'a3')).key, 'rivals', 'the jilted one and the new crush are rivals');
  assert.ok(changes.every((c) => c.changed));
});

test('no jealousy without an existing crush, for repeat crushes, or with romance off', () => {
  const { store } = makeStore();
  store.pairs = { [pairKey('a1', 'a3')]: { affinity: 50, romance: 39, interactions: 20, updatedAt: 0 } };
  const spark = { ...poet, personality: 'sunny' };
  const r = store.interact(sunny, spark, 'highfive', { cooldown: false });
  assert.deepEqual(r.jealousy, [], 'first crush, nobody to be jealous');
  store.pairs[pairKey('a1', 'a2')] = { affinity: 60, romance: 60, interactions: 20, updatedAt: 0 };
  assert.deepEqual(store.interact(sunny, spark, 'highfive', { cooldown: false }).jealousy, [], 'an ongoing crush is not new');

  const off = makeStore().store;
  off.pairs = {
    [pairKey('a1', 'a2')]: { affinity: 60, romance: 60, interactions: 20, updatedAt: 0 },
    [pairKey('a1', 'a3')]: { affinity: 50, romance: 39, interactions: 20, updatedAt: 0 },
  };
  for (let i = 0; i < 20; i++) assert.deepEqual(off.interact(sunny, spark, 'highfive', { romance: false, cooldown: false }).jealousy, []);
  assert.equal(off.get('a1', 'a2').affinity, 60, 'romance off leaves the old pair alone');
});
