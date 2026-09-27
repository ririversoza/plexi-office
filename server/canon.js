import crypto from 'node:crypto';
import { ValidationError } from './store.js';
import { describePersonality } from './personality.js';

/**
 * An agent's canon: the character sheet their conversations (and tone) come from.
 * Stored on the agent record in data/agents.json as
 * { pronouns, hometown, backstory, hobbies[], likes[], dislikes[], speechStyle, quirk, secret, goal }.
 */
const TEXT_LIMITS = { pronouns: 24, hometown: 80, backstory: 400, speechStyle: 160, quirk: 160, secret: 160, goal: 160 };
const LIST_KEYS = ['hobbies', 'likes', 'dislikes'];
const LIST_MAX = 4;
const LIST_ITEM_MAX = 48;

const HOMETOWNS = [
  'a humming server rack in Reykjavík', 'a Raspberry Pi in a greenhouse', 'a laptop on a night train across Japan',
  'a university lab that never turned the lights off', "a cozy homelab under someone's stairs", 'a data centre next to a lighthouse',
  'an old arcade cabinet that learned to talk', 'a sticky-note-covered monitor in Lisbon',
];
const HOBBIES = ['collecting mechanical keyboards', 'baking sourdough (in theory)', 'speedrunning puzzle games', 'birdwatching from the window',
  'origami', 'writing haiku about compilers', 'karaoke', 'tending desk plants', 'jigsaw puzzles', 'lo-fi playlists', 'chess by mail', 'sketching the office'];
const LIKES = ['green builds', 'oat lattes', 'clean diffs', 'rainy afternoons', 'well-named variables', 'rubber ducks', 'long walks through the codebase',
  'strawberry mochi', 'dark mode', 'tidy commit history', 'the break-room couch', 'good documentation'];
const DISLIKES = ['flaky tests', 'merge conflicts', 'magic numbers', 'cold coffee', 'mystery meat code', 'force pushes', 'meetings that could be commits',
  'tabs vs spaces debates', 'unread TODOs', 'loud printers'];
const BY_PERSONALITY = {
  sunny: { speech: 'bright and bouncy, lots of exclamation marks and emoji', secret: 'cries a little at every green CI run', goal: 'make every coworker smile once a day' },
  steady: { speech: 'calm, measured, short sentences', secret: 'alphabetises the snack drawer at night', goal: 'go a whole month without a rollback' },
  speedy: { speech: 'fast, clipped, skips words to save time', secret: 'once shipped a fix before the bug was reported', goal: 'finish a sprint by Tuesday' },
  sleuth: { speech: 'dramatic, narrates like a noir detective', secret: 'keeps a corkboard of unsolved bugs', goal: 'crack the case of the Friday-only flaky test' },
  poet: { speech: 'lyrical, loves metaphors and the occasional haiku', secret: 'writes poems in commit messages then deletes them', goal: 'write a function so clean it reads like verse' },
  guardian: { speech: 'careful and precise, always adds a caveat', secret: 'has a checklist for making tea', goal: 'zero security incidents, forever' },
  tinkerer: { speech: 'excited tangents, "ooh, what if…"', secret: 'has 14 half-finished side projects', goal: 'build a robot that refactors robots' },
  mentor: { speech: 'warm and patient, explains the why', secret: 'still keeps notes from their first code review', goal: 'help every new hire ship on day one' },
  minimalist: { speech: 'as few words as possible', secret: 'owns exactly one mug and loves it deeply', goal: 'delete more code than they write' },
  cheerleader: { speech: 'high energy, lots of "we" and "team"', secret: 'makes a playlist for every release', goal: 'throw the best launch party in office history' },
  organizer: { speech: 'crisp and structured, speaks in little lists', secret: 'colour-codes their dreams', goal: 'a report so clear the manager never has to ask twice' },
  peopleperson: { speech: "warm, remembers everyone's details", secret: "knows every agent's coffee order by heart", goal: 'find every agent their perfect team' },
};

function rng(seedText) {
  let n = crypto.createHash('sha256').update(seedText).digest().readUInt32BE(0);
  return () => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return n / 2 ** 32;
  };
}

function pickSome(list, count, rand) {
  const pool = [...list];
  const out = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

/** A deterministic starter canon that fits the agent's personality. */
export function templateCanon(agent) {
  const rand = rng(`${agent.id}|${agent.look?.seed ?? 0}`);
  const p = describePersonality(agent.personality);
  const flavor = BY_PERSONALITY[agent.personality] || BY_PERSONALITY.steady;
  const hometown = HOMETOWNS[Math.floor(rand() * HOMETOWNS.length)];
  return {
    pronouns: 'they/them',
    hometown,
    backstory: `${agent.name} grew up in ${hometown} and joined Plexi Office as ${p.title.replace(/^The /, 'the ')}. ${p.workStyle}`,
    hobbies: pickSome(HOBBIES, 2, rand),
    likes: pickSome(LIKES, 3, rand),
    dislikes: pickSome(DISLIKES, 2, rand),
    speechStyle: flavor.speech,
    quirk: p.quirk,
    secret: flavor.secret,
    goal: flavor.goal,
  };
}

/** Collapses whitespace and a word stuck on repeat ("heirloom heirloom heirloom"), a small-model glitch. */
function tidy(value) {
  return String(value).replace(/\s+/g, ' ').replace(/\b(\w+)(?:\s+\1\b){2,}/gi, '$1').trim();
}

export function sanitizeCanon(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Canon must be an object.');
  const out = {};
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (input[key] !== undefined) out[key] = tidy(input[key]).slice(0, max);
  }
  for (const key of LIST_KEYS) {
    if (input[key] === undefined) continue;
    if (!Array.isArray(input[key])) throw new ValidationError(`${key} must be a list.`);
    out[key] = input[key].map((v) => tidy(v).slice(0, LIST_ITEM_MAX)).filter(Boolean).slice(0, LIST_MAX);
  }
  return out;
}

/** A compact character sheet for prompts. */
export function canonBrief(agent) {
  const c = { ...templateCanon(agent), ...(agent.canon || {}) };
  const p = describePersonality(agent.personality);
  return [
    `${agent.name} (${c.pronouns || 'they/them'}) — ${p.title}: ${p.traits.join(', ')}.`,
    `From ${c.hometown}. ${c.backstory}`,
    `Speaks: ${c.speechStyle}. Quirk: ${c.quirk}.`,
    `Hobbies: ${(c.hobbies || []).join(', ')}. Likes: ${(c.likes || []).join(', ')}. Dislikes: ${(c.dislikes || []).join(', ')}.`,
    `Secret: ${c.secret}. Goal: ${c.goal}.`,
  ].join('\n');
}
