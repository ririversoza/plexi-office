/**
 * When a coding agent ends a turn without reporting, should the office file a report
 * for them? Only for a real stretch of work: not a quick reply, not a question for the
 * manager, and not if they already reported during it.
 */
export const AUTO_REPORT = Object.freeze({ minTurnMs: 90_000, minChars: 40, maxChars: 600 });

/** Returns the report text to file, or null. */
export function autoReportText({ role, startedAt, now, lastReportAt = 0, state, lastMessage }) {
  if (role !== 'worker' || !startedAt) return null;
  if (now - startedAt < AUTO_REPORT.minTurnMs) return null;
  if (lastReportAt >= startedAt) return null;
  if (state === 'question') return null;
  const text = String(lastMessage ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < AUTO_REPORT.minChars) return null;
  const summary = text.length > AUTO_REPORT.maxChars ? `${text.slice(0, AUTO_REPORT.maxChars - 1)}…` : text;
  return `(auto) ${summary}`;
}

const WAKE_ITEM_CHARS = 400;

/** One line (typed into her terminal, where a newline would submit early) telling the Assistant Manager what came in. */
export function wakePrompt(messages) {
  const items = messages.map((m) => {
    const time = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const text = m.text.replace(/\s+/g, ' ').trim();
    return `${m.name} (${time}): ${text.length > WAKE_ITEM_CHARS ? `${text.slice(0, WAKE_ITEM_CHARS - 1)}…` : text}`;
  });
  return `[Office] ${messages.length === 1 ? 'New report' : `${messages.length} new reports`} for you. ${items.join(' | ')} `
    + '| Handle it as the Assistant Manager: note it for your progress report, and tell the manager now if someone is blocked '
    + 'or has a PR ready for review. Don\'t assign or merge anything the manager hasn\'t asked for. Keep your reply short.';
}
