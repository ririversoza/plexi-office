import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { DEFAULT_BREAKS } from './breaks.js';
import { DEFAULT_PERMISSIONS } from './permissions.js';

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export const DEFAULT_SOCIAL = Object.freeze({ romance: true });
/** OpenAI-compatible LLM for Supermemory (e.g. LM Studio at http://localhost:1234/v1). Not a secret. */
export const DEFAULT_MEMORY_LLM = Object.freeze({ baseUrl: '', model: '' });
/** Who writes break-room conversations: built-in scripts, or a local model. */
export const DEFAULT_WRITER = Object.freeze({ mode: 'script', baseUrl: '', model: '', everySeconds: 120 });
/** How often the local model may write a chat; everything in between uses the scripts. */
export const WRITER_INTERVALS = Object.freeze([60, 120, 300, 600]);

/**
 * Office settings persisted to data/settings.json:
 * { breaks: { enabled, workMinutes, breakMinutes }, social: { romance }, memoryLlm: { baseUrl, model },
 *   manager: { look }, permissions: see server/permissions.js }   (look: see server/look.js; null = the default Starlight look)
 */
export function loadSettings(file = SETTINGS_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      breaks: { ...DEFAULT_BREAKS, ...(parsed.breaks || {}) },
      social: { ...DEFAULT_SOCIAL, ...(parsed.social || {}) },
      memoryLlm: { ...DEFAULT_MEMORY_LLM, ...(parsed.memoryLlm || {}) },
      writer: { ...DEFAULT_WRITER, ...(parsed.writer || {}) },
      manager: { look: parsed.manager?.look || null },
      permissions: { ...DEFAULT_PERMISSIONS, ...(parsed.permissions || {}) },
    };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[settings] could not read ${file}: ${err.message}; using defaults`);
    return { breaks: { ...DEFAULT_BREAKS }, social: { ...DEFAULT_SOCIAL }, memoryLlm: { ...DEFAULT_MEMORY_LLM }, writer: { ...DEFAULT_WRITER }, manager: { look: null },
      permissions: { ...DEFAULT_PERMISSIONS } };
  }
}

export function saveSettings(settings, file = SETTINGS_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, file);
}
