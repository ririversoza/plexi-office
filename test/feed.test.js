import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Feed, sanitizeLines } from '../server/feed.js';

function makeFeed(limit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plexi-feed-'));
  return { feed: new Feed(path.join(dir, 'feed.json'), { limit }).load(), dir };
}

test('conversation lines are validated and clipped', () => {
  const lines = sanitizeLines([{ who: 0, text: 'hi' }, { who: 1, text: 'x'.repeat(500) }, { who: 7, text: 'bad' }, 'nope']);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].text.length, 160);
  assert.deepEqual(sanitizeLines('nope'), []);
});

test('newest entries come first and the log is capped', () => {
  const { feed } = makeFeed(3);
  for (let i = 0; i < 5; i++) feed.add({ type: 'chat', a: 'a1', b: 'a2', lines: [{ who: 0, text: `line ${i}` }] });
  const list = feed.list();
  assert.equal(list.length, 3);
  assert.equal(list[0].lines[0].text, 'line 4');
});

test('entries persist and are dropped with an agent', () => {
  const { feed, dir } = makeFeed(10);
  feed.add({ type: 'gossip', a: 'a1', b: 'a2', label: { key: 'friends' } });
  feed.add({ type: 'gossip', a: 'a3', b: 'a4', label: { key: 'rivals' } });
  feed.flush();
  const reloaded = new Feed(path.join(dir, 'feed.json')).load();
  assert.equal(reloaded.list().length, 2);
  reloaded.removeAgent('a1');
  assert.equal(reloaded.list().length, 1);
});

test('jealousy gossip is dropped when any of its three agents leaves', () => {
  const { feed } = makeFeed(10);
  feed.add({ type: 'gossip', kind: 'jealousy', a: 'a1', b: 'a2', c: 'a3' });
  feed.removeAgent('a3');
  assert.equal(feed.list().length, 0);
});
