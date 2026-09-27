import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StatusTracker, detectSignals, stripAnsi, summarizeTool, STATES } from '../server/status.js';

function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeTracker(clock) {
  const tracker = new StatusTracker({ now: clock.now, idleMs: 6000, inputGraceMs: 1500 });
  tracker.start();
  return tracker;
}

test('stripAnsi removes CSI, OSC and cursor sequences', () => {
  const raw = '\x1b[1;32mhello\x1b[0m \x1b]0;title\x07world\x1b[?25l';
  assert.equal(stripAnsi(raw), 'hello world');
});

test('detectSignals finds permission-style questions', () => {
  assert.match(detectSignals('  Do you want to proceed?\n ❯ 1. Yes').question, /Do you want to proceed\?/);
  assert.match(detectSignals('Allow command? [y/N]').question, /Allow command\?/);
  assert.equal(detectSignals('Compiling 12 files...').question, null);
});

test('detectSignals finds merge conflicts but ignores "no merge conflicts"', () => {
  assert.equal(detectSignals('CONFLICT (content): Merge conflict in src/app.ts').conflict, true);
  assert.equal(detectSignals('Automatic merge failed; fix conflicts').conflict, true);
  assert.equal(detectSignals('mergeable: CONFLICTING').conflict, true);
  assert.equal(detectSignals('Rebased cleanly, no merge conflicts.').conflict, false);
});

test('tracker is offline until started and after exit', () => {
  const clock = makeClock();
  const tracker = new StatusTracker({ now: clock.now });
  assert.equal(tracker.state(), STATES.OFFLINE);
  tracker.start();
  tracker.exit();
  assert.equal(tracker.state(), STATES.OFFLINE);
});

test('output activity means working, silence means break', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.output('\x1b[2K✻ Thinking… (3s)');
  assert.equal(tracker.state(), STATES.WORKING);
  clock.advance(7000);
  assert.equal(tracker.state(), STATES.BREAK);
});

test('pure escape-sequence output (cursor blink) does not count as activity', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  clock.advance(7000);
  tracker.output('\x1b[?25h\x1b[?25l');
  assert.equal(tracker.state(), STATES.BREAK);
});

test('question in output sends agent to the manager until input arrives', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.output('Do you want to make this edit to app.ts?\n❯ 1. Yes  2. No');
  assert.equal(tracker.state(), STATES.QUESTION);
  assert.match(tracker.snapshot().detail, /make this edit/);
  clock.advance(60_000);
  assert.equal(tracker.state(), STATES.QUESTION, 'question persists while unanswered');
  tracker.input('1');
  assert.notEqual(tracker.state(), STATES.QUESTION);
});

test('question text redrawn during the input grace window is ignored', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.output('Do you want to proceed?');
  tracker.input('\r');
  clock.advance(500);
  tracker.output('Do you want to proceed?');
  assert.notEqual(tracker.state(), STATES.QUESTION);
});

test('git conflicts take priority over everything else', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.output('Do you want to proceed?');
  tracker.setGitConflicts(['src/a.ts', 'src/b.ts']);
  const snap = tracker.snapshot();
  assert.equal(snap.state, STATES.CONFLICT);
  assert.match(snap.detail, /src\/a\.ts/);
  tracker.setGitConflicts([]);
  assert.equal(tracker.state(), STATES.QUESTION);
});

test('text-detected conflicts expire when not re-seen', () => {
  const clock = makeClock();
  const tracker = new StatusTracker({ now: clock.now, textConflictMs: 30_000 });
  tracker.start();
  tracker.output('CONFLICT (content): Merge conflict in README.md');
  assert.equal(tracker.state(), STATES.CONFLICT);
  clock.advance(31_000);
  assert.equal(tracker.state(), STATES.BREAK);
});

test('claude hooks: prompt keeps working without output, stop sends to break', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.hook('prompt', {});
  clock.advance(60_000);
  assert.equal(tracker.state(), STATES.WORKING, 'busy between prompt and stop');
  tracker.hook('stop', {});
  clock.advance(1500);
  assert.equal(tracker.state(), STATES.BREAK);
});

test('claude permission notification is a question; idle notification is a break', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.hook('notification', { message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' });
  assert.equal(tracker.state(), STATES.QUESTION);
  assert.match(tracker.snapshot().detail, /permission to use Bash/);
  tracker.hook('pretool', { tool_name: 'Bash' });
  assert.equal(tracker.state(), STATES.WORKING);
  tracker.hook('notification', { message: 'Claude is waiting for your input', notification_type: 'idle_prompt' });
  clock.advance(1500);
  assert.equal(tracker.state(), STATES.BREAK);
});

test('AskUserQuestion tool use becomes a question with its text', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.hook('pretool', {
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'Which database should I use?' }] },
  });
  const snap = tracker.snapshot();
  assert.equal(snap.state, STATES.QUESTION);
  assert.equal(snap.detail, 'Which database should I use?');
});

test('turn ending with a question mark goes to the manager', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.hook('turn-complete', { 'last-assistant-message': 'Done. Should I also update the docs?' });
  assert.equal(tracker.state(), STATES.QUESTION);
});

test('tool output containing a conflict flags the conflict room', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.hook('posttool', { tool_name: 'Bash', tool_response: { stdout: 'CONFLICT (content): Merge conflict in x.js' } });
  assert.equal(tracker.state(), STATES.CONFLICT);
});

test('evaluate reports transitions exactly once', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.output('building...');
  assert.equal(tracker.evaluate().changed, true);
  assert.equal(tracker.evaluate().changed, false);
  clock.advance(7000);
  const result = tracker.evaluate();
  assert.equal(result.changed, true);
  assert.equal(result.snapshot.state, STATES.BREAK);
});

test('summarizeTool turns tool calls into short thought-bubble lines', () => {
  assert.equal(summarizeTool({ tool_name: 'Edit', tool_input: { file_path: '/repo/src/app.ts' } }), '✏️ app.ts');
  assert.equal(summarizeTool({ tool_name: 'Bash', tool_input: { command: 'npm test' } }), '$ npm test');
  assert.ok(summarizeTool({ tool_name: 'Bash', tool_input: { command: 'x'.repeat(200) } }).length <= 36);
  assert.equal(summarizeTool({}), '');
});

test('working snapshots carry the current activity until the turn ends', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.hook('pretool', { tool_name: 'Read', tool_input: { file_path: '/a/README.md' } });
  assert.equal(tracker.snapshot().activity, '📖 README.md');
  tracker.hook('stop', {});
  clock.advance(1500);
  assert.equal(tracker.snapshot().activity, undefined);
});

test('questions are detected on the rendered screen (TUIs that position text with cursor moves)', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.output('\x1b[5;3HDo\x1b[5;6Hyou\x1b[5;10Htrust'); // garbled stream: no spaces
  assert.notEqual(tracker.state(), STATES.QUESTION);
  tracker.observeScreen('> You are in /repo\n\n  Do you trust the contents of this directory?\n  › 1. Yes, continue');
  assert.equal(tracker.state(), STATES.QUESTION);
  assert.match(tracker.snapshot().detail, /trust the contents/);
  tracker.input('\r');
  clock.advance(2000);
  tracker.observeScreen('> Ready. What should we build?');
  assert.notEqual(tracker.state(), STATES.QUESTION, 'answered prompt left the screen');
});

test('a question still on screen during the input grace window is ignored', () => {
  const clock = makeClock();
  const tracker = makeTracker(clock);
  tracker.observeScreen('Allow command? [y/N]');
  tracker.input('y');
  clock.advance(300);
  tracker.observeScreen('Allow command? [y/N]');
  assert.notEqual(tracker.state(), STATES.QUESTION);
});
