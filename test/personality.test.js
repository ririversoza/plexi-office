import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHETYPES, pickArchetype, buildPersonaPrompt, describePersonality } from '../server/personality.js';

const worker = { id: 'a_1', name: 'Mochi', type: 'claude', role: 'worker', personality: 'sunny', cwd: '/tmp' };

test('every archetype has the fields the UI and prompt rely on', () => {
  for (const [key, a] of Object.entries(ARCHETYPES)) {
    for (const field of ['title', 'emoji', 'traits', 'workStyle', 'quirk', 'catchphrase']) {
      assert.ok(a[field], `${key} missing ${field}`);
    }
    assert.equal(a.traits.length, 3, `${key} should have 3 traits`);
  }
});

test('pickArchetype is deterministic per seed and only picks worker archetypes', () => {
  assert.equal(pickArchetype(42), pickArchetype(42));
  for (let seed = 1; seed < 200; seed++) assert.ok(!ARCHETYPES[pickArchetype(seed)].staffOnly);
});

test('worker prompt includes name, personality, memory usage and a quality guardrail', () => {
  const prompt = buildPersonaPrompt(worker, { managerName: 'riri', memoryEnabled: true });
  assert.match(prompt, /You are Mochi/);
  assert.match(prompt, /riri/);
  assert.match(prompt, new RegExp(ARCHETYPES.sunny.title));
  assert.match(prompt, /plexi memory search/);
  assert.match(prompt, /never .*code quality/i);
});

test('memory instructions are omitted when memory is disabled', () => {
  const prompt = buildPersonaPrompt(worker, { managerName: 'riri', memoryEnabled: false });
  assert.doesNotMatch(prompt, /plexi memory/);
});

test('assistant manager and HR get their job descriptions', () => {
  const assistant = buildPersonaPrompt({ ...worker, name: 'Juniper', role: 'assistant', personality: 'organizer' }, { managerName: 'riri' });
  assert.match(assistant, /Assistant Manager/);
  assert.match(assistant, /plexi status --tails/);
  const hr = buildPersonaPrompt({ ...worker, name: 'Poppy', role: 'hr', personality: 'peopleperson' }, { managerName: 'riri', defaultCwd: '/Users/x' });
  assert.match(hr, /plexi hire/);
  assert.match(hr, /\/Users\/x/);
});

test('describePersonality falls back gracefully for unknown keys', () => {
  assert.equal(describePersonality('nope').title, ARCHETYPES.steady.title);
});

test('agents learn that chat and work shape their relationships, and how to tag a vibe', () => {
  const prompt = buildPersonaPrompt(worker, { managerName: 'riri' });
  assert.match(prompt, /--vibe friendly\|joke\|thanks\|snipe/);
  assert.match(prompt, /plexi whoami/);
  assert.match(prompt, /rivals or enemies/);
});
