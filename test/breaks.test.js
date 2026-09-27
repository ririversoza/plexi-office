import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BreakScheduler } from '../server/breaks.js';

const MIN = 60_000;

function setup(config = {}) {
  let t = 0;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const breaks = new BreakScheduler({ now: clock.now, config: { enabled: true, workMinutes: 15, breakMinutes: 3, ...config } });
  return { breaks, clock };
}

const working = { state: 'working', detail: '' };
const idle = { state: 'break', detail: '' };
const question = { state: 'question', detail: 'Proceed?' };

function workFor(breaks, clock, minutes) {
  breaks.apply('a', working); // the first observation starts the clock
  for (let i = 0; i < minutes * 60; i++) {
    clock.advance(1000);
    breaks.apply('a', working);
  }
}

test('idle before the work quota is a normal break', () => {
  const { breaks, clock } = setup();
  workFor(breaks, clock, 5);
  assert.equal(breaks.apply('a', idle).detail, '');
});

test('after 15 minutes of work the next pause becomes a 3 minute scheduled break', () => {
  const { breaks, clock } = setup();
  workFor(breaks, clock, 15);
  const snap = breaks.apply('a', idle);
  assert.equal(snap.state, 'break');
  assert.match(snap.detail, /Scheduled break/);
  assert.equal(snap.breakEndsAt, clock.now() + 3 * MIN);
  clock.advance(2 * MIN);
  assert.match(breaks.apply('a', idle).detail, /Scheduled break/);
  clock.advance(1.1 * MIN);
  assert.equal(breaks.apply('a', idle).detail, '', 'break is over');
});

test('a scheduled break never hides real work or questions', () => {
  const { breaks, clock } = setup();
  workFor(breaks, clock, 15);
  breaks.apply('a', idle);
  assert.equal(breaks.apply('a', question).state, 'question');
  assert.equal(breaks.apply('a', working).state, 'working', 'new work ends the break early');
  assert.equal(breaks.apply('a', idle).detail, '', 'and the quota starts over');
});

test('disabled scheduler passes snapshots through', () => {
  const { breaks, clock } = setup({ enabled: false });
  workFor(breaks, clock, 20);
  assert.equal(breaks.apply('a', idle).detail, '');
});

test('offline resets the work counter', () => {
  const { breaks, clock } = setup();
  workFor(breaks, clock, 14);
  breaks.apply('a', { state: 'offline', detail: '' });
  workFor(breaks, clock, 2);
  assert.equal(breaks.apply('a', idle).detail, '');
});

test('config updates validate their ranges', () => {
  const { breaks } = setup();
  assert.throws(() => breaks.configure({ workMinutes: 0 }));
  assert.throws(() => breaks.configure({ breakMinutes: 500 }));
  assert.deepEqual(breaks.configure({ workMinutes: 25, breakMinutes: 5 }), { enabled: true, workMinutes: 25, breakMinutes: 5 });
});
