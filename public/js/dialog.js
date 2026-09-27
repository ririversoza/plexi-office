// What agents say to each other on breaks, and what they think about while working.
// Lines are flavoured by personality, team, project folder and live activity.

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;

export function projectOf(agent) {
  const cwd = agent.agent?.cwd || '';
  const base = cwd.split('/').filter(Boolean).pop() || '';
  const isHome = /^\/(Users|home)\/[^/]+\/?$/.test(cwd);
  return !base || isHome ? 'my stuff' : base;
}

const OPENERS = {
  sunny: (b) => `${b.name}!! Isn't today great? 🌻`,
  steady: () => 'Finished my tests. All green. Tea? 🍵',
  speedy: () => 'Shipped two fixes before this coffee ⚡',
  sleuth: (b) => `${b.name}, I found the sneakiest off-by-one 🔍`,
  poet: () => 'Refactoring is just poetry with tests 🪶',
  guardian: () => 'Friendly reminder: validate your inputs 🛡️',
  tinkerer: () => 'I built a tiny script that builds tiny scripts 🔧',
  mentor: (b) => `${b.name}, want to hear why caching is hard? 🦉`,
  minimalist: () => 'Deleted 40 lines today. Bliss. 🍃',
  cheerleader: () => "Huddle up! You're all doing amazing 📣",
  organizer: (b) => `Quick check-in, ${b.name} — how's ${projectOf(b)}? 📋`,
  peopleperson: (b) => `${b.name}! How are you settling in? 💐`,
};

const GENERIC_OPENERS = [
  (b) => `Hey ${b.name}! How's ${projectOf(b)} going?`,
  (b) => `${b.name}! Break buddies ☕`,
  (b) => `Ooh ${b.name}, you look like you just shipped something.`,
  (b) => `What are you working on, ${b.name}?`,
];

const RESPONSES = {
  sunny: (b) => `Amazing!! ${projectOf(b)} is coming together 🌈`,
  steady: () => 'Steady. One small step at a time.',
  speedy: () => "Already done. What's next? ⚡",
  sleuth: () => "Chasing a flaky test. It's always timing… 🔍",
  poet: () => 'Like morning dew on a fresh branch 🌿',
  guardian: () => 'Good — and I triple-checked the edge cases.',
  tinkerer: () => 'I broke it, fixed it, then made it faster! 🔧',
  mentor: (b) => `Good! I learned something neat about ${projectOf(b)}.`,
  minimalist: () => 'Fine. 🍃',
  cheerleader: () => 'SO good! Go team go! 📣',
  organizer: () => "On track. It'll be in the report 📋",
  peopleperson: () => "Lovely! Everyone's been so welcoming 💐",
};

const TEAM_BANTER = {
  'claude|codex': [['Team Codex: tabs or spaces?', "Spaces. We're not animals."]],
  'codex|cursor': [['Cursor crew, how are you so fast?', 'Tab. Tab. Tab. 🏎️']],
  'claude|cursor': [['Cursor folks finish my sentences…', '…before you even start them ✨']],
  same: [['Our pod is on fire today 🔥', 'Literally. The printer is warm.']],
};

const JOKES = [
  ['Why do programmers prefer dark mode?', 'Because light attracts bugs 🐛'],
  ['I told a UDP joke…', "…I'm not sure you got it."],
  ['How many agents to change a lightbulb?', 'One — but it asks permission first 🙋'],
  ['Git blame says it was me.', 'Git blame is always right 😬'],
  ['I rebased my lunch.', 'Did it conflict with dinner? 🍱'],
  ['My code works and I have no idea why.', 'Ship it. Never touch it again.'],
];

const CLOSERS = [
  [{ who: 0, text: '✋ Up top!', together: 'highfive' }],
  [{ who: 0, text: 'Back to it! 💪', pose: 'cheer' }, { who: 1, text: "Let's goooo", pose: 'cheer', face: 'laugh' }],
  [{ who: 1, text: 'hahaha 😂', face: 'laugh', react: { face: 'laugh' } }],
  [{ who: 0, text: 'Selfie for the team channel! ✌️', pose: 'peace', face: 'wink', react: { pose: 'peace', face: 'tongue' } }],
];

function teamKey(a, b) {
  if (a.agent.role !== 'worker' || b.agent.role !== 'worker') return null;
  if (a.agent.type === b.agent.type) return 'same';
  return [a.agent.type, b.agent.type].sort().join('|');
}

function responseFor(b, info) {
  if (b.detail?.startsWith('Scheduled break')) return "Scheduled break! Doctor's orders ⏰";
  if (b.recentlyAsked) return `Waiting on ${info.managerName} for a decision 😅`;
  return (RESPONSES[b.agent.personality] || RESPONSES.steady)(b);
}

// Scripts for pairs with history. `label` comes from the server's relationship labels.
const BOND_SCRIPTS = {
  enemies: (a, b) => [
    { who: 0, text: `Oh. It's you, ${b.name}.`, face: 'pout', pose: 'crossed' },
    { who: 1, text: `Still pushing to main without tests? 🙄`, face: 'shocked', pose: 'crossed' },
    { who: 0, text: 'At least my PRs get approved. 💢', face: 'shocked', pose: 'argue' },
    { who: 1, text: 'Hmph.', face: 'pout', pose: 'crossed', react: { face: 'pout', pose: 'crossed' } },
  ],
  rivals: (a, b) => [
    { who: 0, text: `Nice code, ${b.name}… for a ${b.agent.type === 'codex' ? 'Codex' : b.agent.type === 'cursor' ? 'Cursor' : 'Claude'} agent 😏`, face: 'tongue', pose: 'chat' },
    { who: 1, text: 'I closed three tickets while you were typing that.', face: 'determined', pose: 'crossed' },
    { who: 0, text: 'Race you to the next green build ⚡', face: 'determined', pose: 'point' },
    { who: 1, text: "You're on. 😤", face: 'determined', react: { face: 'determined' } },
  ],
  friends: (a, b) => [
    { who: 0, text: `${b.name}! My favourite coworker 😄`, face: 'grin', pose: 'wave' },
    { who: 1, text: `Saved you the good coffee ☕`, face: 'content', pose: 'chat' },
    { who: 0, text: `How's ${projectOf(b)}? Need a second pair of eyes?`, face: 'happy', pose: 'chat' },
    { who: 1, text: 'Always! Pair later? 🤝', together: 'highfive' },
  ],
  bestfriends: (a, b) => [
    { who: 0, text: `BESTIE 💛`, face: 'sparkle', pose: 'cheer' },
    { who: 1, text: 'You will NOT believe what the linter said to me today', face: 'laugh', pose: 'chat' },
    { who: 0, text: 'Tell me everything 😂', face: 'laugh', pose: 'cheeks' },
    { who: 1, text: '✌️ selfie for the team channel!', face: 'wink', pose: 'peace', react: { pose: 'peace', face: 'tongue' } },
  ],
  crush: (a, b) => [
    { who: 0, text: `O-oh! Hi ${b.name}… 💗`, face: 'pout', pose: 'cheeks' },
    { who: 1, text: 'Hi! Your last commit message was really… clear.', face: 'pout', pose: 'think', react: { face: 'sparkle' } },
    { who: 0, text: '*blushes in monospace*', face: 'laugh', pose: 'cheeks' },
    { who: 1, text: 'Want to review my PR sometime? 👉👈', face: 'wink', react: { face: 'sparkle', pose: 'cheeks' } },
  ],
  sweethearts: (a, b) => [
    { who: 0, text: `Saved you a seat, ${b.name} 💕`, face: 'wink', pose: 'wave' },
    { who: 1, text: 'You always know when I need a break 🥰', face: 'sparkle', pose: 'cheeks' },
    { who: 0, text: 'Pair-programming date after this?', face: 'content', pose: 'chat' },
    { who: 1, text: 'Only if you let me drive 💞', together: 'hug' },
  ],
};

/** A short break-room chat between a (who: 0) and b (who: 1). */
export function breakDialog(a, b, info) {
  const bond = info.relationship?.(a.id, b.id)?.label?.key;
  if (BOND_SCRIPTS[bond] && chance(0.75)) return BOND_SCRIPTS[bond](a, b, info);
  const opener = (chance(0.6) && OPENERS[a.agent.personality]) || pick(GENERIC_OPENERS);
  const lines = [
    { who: 0, text: opener(b), face: 'grin', pose: 'wave' },
    { who: 1, text: responseFor(b, info), face: 'happy', pose: 'chat' },
  ];
  const banter = TEAM_BANTER[teamKey(a, b)];
  const [setup, punchline] = banter && chance(0.5) ? pick(banter) : pick(JOKES);
  lines.push({ who: 0, text: setup, face: 'cat', pose: 'chat' });
  lines.push({ who: 1, text: punchline, face: 'laugh', react: { face: 'laugh' } });
  if (info.memoryConnected && chance(0.35)) {
    lines.push({ who: 0, text: 'Saving that to my memory 🧠', face: 'wink', pose: 'think' });
  }
  return [...lines, ...pick(CLOSERS)];
}

const CONFLICT_SCRIPTS = [
  (info) => [
    { who: 0, text: 'Your change or mine?', face: 'pout', pose: 'crossed' },
    { who: 1, text: 'Mine has tests! 😤', face: 'determined', pose: 'argue' },
    { who: 0, text: '…okay, fair.', face: 'sad', pose: 'shrug' },
    { who: 1, text: `Keep both and ask ${info.managerName}?`, face: 'happy', pose: 'think' },
    { who: 0, text: 'Deal 🤝', together: 'highfive' },
  ],
  () => [
    { who: 0, text: '<<<<<<< HEAD is mine!', face: 'shocked', pose: 'point' },
    { who: 1, text: '>>>>>>> no, MINE!', face: 'shocked', pose: 'argue' },
    { who: 0, text: '…rebase or merge?', face: 'dizzy', pose: 'facepalm' },
    { who: 1, text: 'Rebase. Always rebase.', face: 'determined', pose: 'crossed' },
    { who: 0, text: "We can't be friends 😂", face: 'laugh', react: { face: 'laugh' } },
  ],
  () => [
    { who: 0, text: 'Who touched this file?! 💢', face: 'shocked', pose: 'argue' },
    { who: 1, text: "…it wasn't me 😇", face: 'wink', pose: 'shrug' },
    { who: 0, text: 'git blame says otherwise.', face: 'pout', pose: 'crossed' },
    { who: 1, text: 'I was young. I needed the diff.', face: 'cry', pose: 'cheeks' },
  ],
];

export function conflictDialog(a, b, info) {
  return pick(CONFLICT_SCRIPTS)(info);
}

// ── thoughts ────────────────────────────────────────────────────────────────
const WORK_THOUGHTS = ['hmm… 🤔', 'edge cases…', 'is this O(n²)?', 'tests first!', 'naming is hard', 'almost there…', 'one more try'];
const PERSONA_THOUGHTS = {
  sunny: '✨ this is fun', steady: 'one step at a time', speedy: 'faster… ⚡', sleuth: 'the plot thickens 🔍',
  poet: 'a better name…', guardian: 'what if it is null?', tinkerer: 'ooh, what if…', mentor: 'how to explain this…',
  minimalist: 'can I delete this?', cheerleader: 'go team 📣', organizer: 'who needs help? 📋', peopleperson: 'who should we hire? 💐',
};
const BREAK_THOUGHTS = ['☕ ahh…', '🍩 snack?', 'stretch time', 'nice view 🌤️', 'thinking about lunch 🍱', 'recharging 🔋'];
const QUESTION_THOUGHTS = ['did they see my question?', 'waiting patiently…', '🙋 boss?'];
const CONFLICT_THOUGHTS = ['<<<<<<< ???', 'rebase or merge…', 'whose change wins?', '😵‍💫 so many markers'];

/** A thought-bubble line for an agent right now, or null. Live tool activity wins when known. */
export function thoughtFor(a) {
  switch (a.state) {
    case 'working':
      if (a.activity && chance(0.7)) return a.activity;
      if (chance(0.3)) return `${projectOf(a)}…`;
      return (chance(0.5) && PERSONA_THOUGHTS[a.agent.personality]) || pick(WORK_THOUGHTS);
    case 'break':
      if (a.detail?.startsWith('Scheduled break') && chance(0.5)) return '⏰ scheduled break!';
      return chance(0.25) ? `${projectOf(a)} can wait` : pick(BREAK_THOUGHTS);
    case 'question':
      return pick(QUESTION_THOUGHTS);
    case 'conflict':
      return pick(CONFLICT_THOUGHTS);
    default:
      return null;
  }
}
