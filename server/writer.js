/**
 * The office writer: asks a local OpenAI-compatible model (LM Studio, Ollama…)
 * to write in-character break-room conversations and agent canons.
 * Everything the model returns is validated before it reaches the office.
 */
const TIMEOUT_MS = 45_000;
const MAX_LINES = 8;
const MAX_LINE_CHARS = 110;

export const FACES = ['happy', 'focus', 'surprised', 'worried', 'grin', 'laugh', 'wink', 'sparkle', 'shocked', 'sad', 'content',
  'tongue', 'squint', 'sleepy', 'cat', 'dizzy', 'cry', 'pout', 'blank', 'determined', 'huff'];
export const POSES = ['chat', 'wave', 'nod', 'think', 'peace', 'stretch', 'cheer', 'cheeks', 'facepalm', 'crossed', 'shrug', 'point', 'argue', 'hug'];
const TOGETHER = ['highfive', 'hug'];
export const TONE_TO_KIND = { warm: 'chat', funny: 'joke', celebratory: 'highfive', tense: 'argue', reconciling: 'makeup' };

/** Pulls the JSON object out of a model reply (drops <think> blocks, code fences, chatter). */
export function parseModelJson(text) {
  const cleaned = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The model did not return JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `names` are the two speakers' names; a leading "Name:" the model sometimes adds is stripped. */
export function validateDialogue(obj, names = []) {
  const prefix = names.length ? new RegExp(`^\\s*(?:${names.map(escapeRe).join('|')})\\s*[:：]\\s*`, 'i') : null;
  const lines = (Array.isArray(obj?.lines) ? obj.lines : [])
    .filter((l) => l && (l.who === 0 || l.who === 1) && typeof l.text === 'string' && l.text.trim())
    .slice(0, MAX_LINES)
    .map((l) => ({
      who: l.who,
      text: (prefix ? l.text.replace(prefix, '') : l.text).replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS),
      face: FACES.includes(l.face) ? l.face : 'happy',
      pose: POSES.includes(l.pose) ? l.pose : 'chat',
      ...(TOGETHER.includes(l.together) && { together: l.together }),
    }));
  if (lines.length < 2) throw new Error('The conversation was too short.');
  return lines;
}

const DIALOGUE_SCHEMA = {
  type: 'object',
  properties: {
    tone: { type: 'string', enum: Object.keys(TONE_TO_KIND) },
    lines: {
      type: 'array',
      minItems: 3,
      maxItems: 7,
      items: {
        type: 'object',
        properties: {
          who: { type: 'integer', enum: [0, 1] },
          text: { type: 'string' },
          face: { type: 'string', enum: FACES },
          pose: { type: 'string', enum: POSES },
        },
        required: ['who', 'text', 'face', 'pose'],
      },
    },
  },
  required: ['tone', 'lines'],
};

const CANON_SCHEMA = {
  type: 'object',
  properties: {
    hometown: { type: 'string' },
    backstory: { type: 'string' },
    hobbies: { type: 'array', items: { type: 'string' } },
    likes: { type: 'array', items: { type: 'string' } },
    dislikes: { type: 'array', items: { type: 'string' } },
    speechStyle: { type: 'string' },
    quirk: { type: 'string' },
    secret: { type: 'string' },
    goal: { type: 'string' },
  },
  required: ['hometown', 'backstory', 'hobbies', 'likes', 'dislikes', 'speechStyle', 'quirk', 'secret', 'goal'],
};

export class Writer {
  constructor() {
    this.busy = false;
  }

  async chatJson({ baseUrl, model }, system, user, schema, name) {
    const body = {
      model,
      temperature: 0.9,
      max_tokens: 900,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name, schema } },
    };
    const post = (payload) => fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let res = await post(body);
    if (res.status === 400) {
      // Some servers don't support structured output; fall back to plain JSON instructions.
      const { response_format: _unused, ...plain } = body;
      res = await post(plain);
    }
    if (!res.ok) throw new Error(`The model server answered ${res.status}.`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message || {};
    // Thinking models on LM Studio can put the structured answer in reasoning_content.
    const candidates = [msg.content, msg.reasoning_content, msg.reasoning].filter((c) => typeof c === 'string' && c.trim());
    for (const text of candidates) {
      try {
        return parseModelJson(text);
      } catch {
        // try the next field
      }
    }
    throw new Error('The model did not return JSON.');
  }

  /** One request at a time so a slow local model never piles up. */
  async exclusive(fn) {
    if (this.busy) throw new Error('The writer is busy.');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  writeDialogue(llm, ctx) {
    return this.exclusive(async () => {
      const system = [
        'You write short, wholesome, funny conversations between two AI coding agents who are coworkers at Plexi Office, a cozy chibi office sim.',
        'Stay true to each character sheet: their speech style, likes, dislikes, quirks and history together. Let their relationship show.',
        'Keep it PG. Each line under 90 characters. Refer to agents by name or by their listed pronouns. No markdown.',
        'Output JSON only.',
      ].join(' ');
      const setting = ctx.room === 'conflict'
        ? 'the Merge Conflict Room — they are stuck on a merge conflict together; make it a comedic squabble that resolves or ends in a standoff'
        : 'the break room, relaxing between tasks';
      const user = [
        `Setting: ${setting}.`,
        `Speaker 0:\n${ctx.briefA}\nCurrently: ${ctx.doingA}`,
        `Speaker 1:\n${ctx.briefB}\nCurrently: ${ctx.doingB}`,
        `Relationship: ${ctx.relationship}.`,
        ctx.history ? `Things they said to each other recently (don't repeat these):\n${ctx.history}` : 'This is one of their first chats.',
        `Their manager is ${ctx.managerName}.`,
        `Write 4–6 lines, speakers taking turns naturally, starting with speaker 0. Pick a face from: ${FACES.join(', ')}; a pose from: ${POSES.join(', ')}.`,
        'Set "tone" to warm, funny, celebratory, tense or reconciling.',
      ].join('\n\n');
      const out = await this.chatJson(llm, system, user, DIALOGUE_SCHEMA, 'dialogue');
      return { lines: validateDialogue(out, ctx.names || []), tone: Object.hasOwn(TONE_TO_KIND, out.tone) ? out.tone : 'warm' };
    });
  }

  writeCanon(llm, ctx) {
    return this.exclusive(async () => {
      const system = 'You create playful, wholesome character sheets for chibi AI coding agents in a cozy office sim. Output JSON only.';
      const user = [
        `Write a canon for ${ctx.name}, a ${ctx.roleLabel} on ${ctx.team}.`,
        `Personality: ${ctx.personality}.`,
        `Pronouns: ${ctx.pronouns}.`,
        'Backstory: 2–3 sentences. Hometown: a whimsical techy place. Up to 4 hobbies, likes and dislikes (short phrases).',
        'Speech style: how they talk, so a writer can imitate it. Quirk, secret and goal: one sentence each, charming and PG.',
      ].join('\n');
      return this.chatJson(llm, system, user, CANON_SCHEMA, 'canon');
    });
  }
}
