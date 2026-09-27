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
