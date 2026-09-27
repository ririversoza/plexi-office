// "Customize your character" — live preview + controls for the manager's look.
import { api } from './net.js';
import { el } from './drawer.js';
import { MANAGER_PRESETS, drawChibi } from './chibi.js';

const PREVIEW_SCALE = 3.3;
const MOOD_CYCLE_S = 12;
const SKIN_SWATCHES = ['#FCE3D6', '#F9D3B4', '#EFC09A', '#D9A57E', '#B98160', '#8D5B3E'];

const OPTIONS = {
  style: [['twinbuns', 'Twin buns + long hair'], ['flowing', 'Long flowing'], ['long', 'Long'], ['bob', 'Bob'], ['short', 'Short'],
    ['ponytail', 'Ponytail'], ['bun', 'Top bun'], ['twintails', 'Twin tails'], ['curly', 'Curly'], ['spiky', 'Spiky'], ['sidepart', 'Side part'], ['buzz', 'Buzz']],
  eyes: [['anime', 'Big sparkly'], ['dot', 'Classic dots']],
  outfit: [['dress', 'Off-shoulder dress'], ['suit', 'Suit & tie'], ['hoodie', 'Hoodie'], ['sweater', 'Sweater'], ['tee', 'T-shirt'], ['shirt', 'Button-up'], ['overalls', 'Overalls']],
  accessory: [['none', 'None'], ['crown', 'Crown'], ['flower', 'Flower clip'], ['sparkle', 'Sparkle clip'], ['headphones', 'Headphones'], ['beanie', 'Beanie']],
  idlePose: [['hips', 'Hands on hips'], ['stand', 'Relaxed'], ['wave', 'Waving'], ['peace', 'Peace sign'], ['crossed', 'Arms crossed'], ['cheer', 'Cheering']],
  idleFace: [['huff', 'Huffy 💢'], ['happy', 'Happy'], ['grin', 'Big grin'], ['wink', 'Wink'], ['sparkle', 'Starry-eyed'], ['determined', 'Determined'], ['content', 'Content'], ['cat', 'Cat smile'], ['pout', 'Pout']],
};

function select(key, draft, onChange) {
  const node = el('select', { 'aria-label': key }, OPTIONS[key].map(([value, label]) => el('option', { value, selected: draft[key] === value }, label)));
  node.addEventListener('change', () => onChange({ [key]: node.value }));
  return node;
}

function color(keys, draft, onChange, label) {
  const node = el('input', { type: 'color', value: draft[keys[0]] || '#000000', 'aria-label': label || keys[0] });
  node.addEventListener('input', () => onChange(Object.fromEntries(keys.map((k) => [k, node.value.toUpperCase()]))));
  return node;
}

function toggle(key, draft, label, onChange) {
  const box = el('input', { type: 'checkbox', checked: Boolean(draft[key]) });
  box.addEventListener('change', () => onChange({ [key]: box.checked }));
  return el('label', { class: 'look-check' }, box, label);
}

function randomHex() {
  return `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
}

function randomLook() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const main = randomHex();
  return {
    ...MANAGER_PRESETS.starlight,
    style: pick(OPTIONS.style)[0], hair: randomHex(), hairTip: randomHex(), eyeColor: randomHex(), skin: pick(SKIN_SWATCHES),
    outfit: pick(OPTIONS.outfit)[0], dress: main, shirt: main, ribbon: randomHex(),
    accessory: pick(OPTIONS.accessory)[0], idlePose: pick(OPTIONS.idlePose)[0], idleFace: pick(OPTIONS.idleFace)[0],
  };
}

export class Customizer {
  constructor(app) {
    this.app = app;
    this.dialog = document.getElementById('look-dialog');
    this.canvas = document.getElementById('look-canvas');
    this.controls = document.getElementById('look-controls');
    this.error = document.getElementById('look-error');
    this.view = 'front';
    this.walking = false;
    this.draft = null;
    this.frame = null;
    document.getElementById('look-turn').addEventListener('click', () => { this.view = this.view === 'front' ? 'back' : 'front'; });
    document.getElementById('look-walk').addEventListener('click', () => { this.walking = !this.walking; });
    document.getElementById('look-cancel').addEventListener('click', () => this.dialog.close());
    document.getElementById('look-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.save();
    });
    this.dialog.addEventListener('close', () => cancelAnimationFrame(this.frame));
  }

  open() {
    this.draft = { ...MANAGER_PRESETS.starlight, ...(this.app.settings.manager?.look || {}) };
    this.error.textContent = '';
    this.renderControls();
    this.dialog.showModal();
    this.animate();
  }

  update(changes) {
    this.draft = { ...this.draft, ...changes };
  }

  applyPreset(look) {
    this.draft = { ...look };
    this.renderControls();
  }

  renderControls() {
    const d = this.draft;
    const on = (changes) => this.update(changes);
    const row = (label, ...inputs) => el('div', { class: 'look-row' }, el('span', {}, label), el('div', { class: 'look-inputs' }, inputs));
    const skins = el('div', { class: 'swatches' }, SKIN_SWATCHES.map((c) => el('button', {
      type: 'button',
      class: `swatch${d.skin === c ? ' on' : ''}`,
      style: `background:${c}`,
      'aria-label': `Skin tone ${c}`,
      onclick: () => {
        this.update({ skin: c });
        this.renderControls();
      },
    })));
    this.controls.replaceChildren(
      el('div', { class: 'look-presets' },
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => this.applyPreset(MANAGER_PRESETS.starlight) }, '🌙 Starlight'),
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => this.applyPreset(MANAGER_PRESETS.boss) }, '👑 Classic boss'),
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => this.applyPreset(randomLook()) }, '🎲 Surprise me')),
      el('h3', {}, 'Hair'),
      row('Style', select('style', d, on)),
      row('Colour · tips · shine', color(['hair'], d, on, 'Hair colour'), color(['hairTip'], d, on, 'Hair tips'), color(['hairShine'], d, on, 'Hair shine')),
      el('h3', {}, 'Face'),
      row('Eyes', select('eyes', d, on), color(['eyeColor'], d, on, 'Eye colour')),
      row('Skin', skins, color(['skin'], d, on, 'Skin colour')),
      row('Idle mood', select('idleFace', d, on)),
      el('h3', {}, 'Outfit'),
      row('Style', select('outfit', d, on)),
      row('Main · trim · ribbon', color(['dress', 'shirt'], d, on, 'Main colour'), color(['dressDark', 'pants'], d, on, 'Trim colour'), color(['ribbon', 'badge'], d, on, 'Ribbon colour')),
      row('Boots', color(['shoes'], d, on, 'Boot colour')),
      el('h3', {}, 'Extras'),
      row('Accessory', select('accessory', d, on)),
      row('Pose', select('idlePose', d, on)),
      row('', toggle('choker', d, 'Choker', on), toggle('aura', d, 'Sparkles', on), toggle('glasses', d, 'Glasses', on)),
    );
  }

  animate() {
    const ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    const draw = (now) => {
      const t = now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = ctx.createRadialGradient(w / 2, h * 0.55, 10, w / 2, h * 0.55, w * 0.7);
      g.addColorStop(0, '#F3E8FF');
      g.addColorStop(1, '#D8C4FA');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const d = this.draft;
      const expression = t % MOOD_CYCLE_S > 10.8 ? 'wink' : d.idleFace || 'happy';
      drawChibi(ctx, d, {
        x: w / 2, y: h * 0.9, view: this.view, flip: false, pose: this.walking ? 'walk' : d.idlePose || 'stand',
        expression, t, phase: 0, scale: PREVIEW_SCALE,
      });
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }

  async save() {
    try {
      const settings = await api('PATCH', '/api/settings', { manager: { look: this.draft } });
      this.app.settings = settings;
      this.app.applyManagerLook(settings.manager?.look);
      this.dialog.close();
      this.app.toast({ title: '✨ Looking good!', text: 'Your new look is saved.' });
    } catch (err) {
      this.error.textContent = err.message;
    }
  }
}
