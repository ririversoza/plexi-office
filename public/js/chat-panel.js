// The office group chat, as a drawer tab: messages oldest → newest, with a composer.
import { api } from './net.js';
import { el, portrait } from './drawer.js';

const MAX_TEXT = 500;
const MENTION_RE = /(@[\p{L}\p{N}_.-]+)/u;

function time(at) {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function withMentions(text) {
  return text.split(MENTION_RE).map((part) => (MENTION_RE.test(part) ? el('b', { class: 'mention' }, part) : part));
}

export class ChatPanel {
  constructor(app, { openAgent }) {
    this.app = app;
    this.openAgent = openAgent;
    this.messages = null;
    this.managerId = 'manager';
    this.draft = '';
    this.unread = 0;
    this.onUnread = () => {};
  }

  async load() {
    if (this.messages) return;
    const { messages, managerId } = await api('GET', '/api/chat');
    this.messages = messages;
    this.managerId = managerId;
  }

  /** A new message arrived over the socket. Returns true if it's from someone else. */
  add(message) {
    if (this.messages && !this.messages.some((m) => m.id === message.id)) this.messages = [...this.messages, message].slice(-300);
    return message.from !== this.managerId;
  }

  markRead() {
    this.unread = 0;
    this.onUnread(0);
  }

  bump() {
    this.unread += 1;
    this.onUnread(this.unread);
  }

  view() {
    const list = el('ul', { class: 'chat-list' }, (this.messages || []).map((m) => this.item(m)));
    const box = el('textarea', {
      class: 'chat-input', rows: '2', maxlength: String(MAX_TEXT),
      placeholder: 'Message the office… (@Name to mention, @all for everyone, Enter to send)',
      oninput: (e) => { this.draft = e.target.value; },
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          send();
        }
      },
    });
    box.value = this.draft;
    const status = el('span', { class: 'muted chat-status' });
    const button = el('button', { class: 'btn btn-pink', type: 'button' }, 'Send');
    const send = async () => {
      const text = box.value.trim();
      if (!text) return;
      button.disabled = true;
      try {
        const message = await api('POST', '/api/chat', { text });
        this.draft = '';
        box.value = '';
        this.add(message);
        list.append(this.item(message));
        list.scrollTop = list.scrollHeight;
        status.textContent = '';
      } catch (err) {
        status.textContent = err.message;
      } finally {
        button.disabled = false;
        box.focus();
      }
    };
    button.addEventListener('click', send);
    const root = el('div', { class: 'chat' },
      this.messages?.length ? list : el('p', { class: 'muted' }, 'No messages yet. Say hi, or ask the team something. Agents read this while they work.'),
      el('div', { class: 'chat-compose' }, box, el('div', { class: 'row' }, status, button)));
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    this.inputEl = box;
    return root;
  }

  item(m) {
    const agent = this.app.agents.get(m.from);
    const who = m.from === this.managerId
      ? el('b', { class: 'chat-name you' }, `${m.name} (you)`)
      : el('button', { class: 'linkish chat-name', onclick: () => agent && this.openAgent(m.from) }, m.name);
    return el('li', { class: m.from === this.managerId ? 'from-you' : '' },
      agent ? portrait(agent, 26) : el('span', { class: 'chat-avatar' }, m.from === this.managerId ? '⭐' : '👤'),
      el('div', {}, el('div', {}, who, el('small', {}, ` ${time(m.at)}`)), el('div', { class: 'chat-text' }, withMentions(m.text))));
  }
}
