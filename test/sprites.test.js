import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SpriteStore, validateSvg } from '../server/sprites.js';

const plant = `<?xml version="1.0"?>
<!-- Sora's bonsai -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#7DBB6E"/><stop offset="1" stop-color="#4A8F3C"/></linearGradient></defs>
  <rect x="20" y="44" width="24" height="18" rx="3" fill="#C98F4A" stroke="#3a2a26" stroke-width="2"/>
  <circle cx="32" cy="28" r="16" fill="url(#g)" stroke="#3a2a26" stroke-width="2"/>
  <use href="#g"/><text x="32" y="60" font-size="6" text-anchor="middle">Sora</text>
</svg>`;

test('a self-contained drawing is accepted as is', () => {
  const clean = validateSvg(plant);
  assert.match(clean, /^<svg/);
  assert.match(clean, /url\(#g\)/);
});

test('anything that could run code or reach outside the file is refused', () => {
  const wrap = (inner, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"${attrs}>${inner}</svg>`;
  const bad = [
    [wrap('<script>alert(1)</script>'), /script/],
    [wrap('<circle r="4"/>', ' onload="alert(1)"'), /event handlers/],
    [wrap('<rect onclick = "x()" />'), /event handlers/],
    [wrap('<foreignObject><div>hi</div></foreignObject>'), /foreignObject/],
    [wrap('<image href="https://evil.example/x.png"/>'), /embedded images/],
    [wrap('<a href="https://evil.example"><circle r="3"/></a>'), /inside the file/],
    [wrap('<use xlink:href="other.svg#x"/>'), /inside the file/],
    [wrap('<rect style="fill:url(https://evil.example/p)"/>'), /url\(\)/],
    [wrap('<style>@import "https://evil.example/a.css";</style>'), /@import|url/],
    [wrap('<a href="javascript:alert(1)">x</a>'), /javascript|inside the file/],
    [wrap('<a href="data:text/html,hi">x</a>'), /data:|inside the file/],
    [`<!DOCTYPE svg [<!ENTITY x "y">]>${wrap('<circle r="1"/>')}`, /single <svg>|DOCTYPE/],
    ['<svg viewBox="0 0 64 64"><circle r="1"/></svg>', /xmlns/],
    ['<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>', /viewBox/],
    [wrap('<circle r="1"/>').replace('0 0 64 64', '0 0 5000 64'), /within 512/],
    [`<div>${wrap('')}</div>`, /single <svg>/],
    [wrap(`<desc>${'x'.repeat(40 * 1024)}</desc>`), /32 KB/],
    ['', /empty/],
  ];
  for (const [svg, why] of bad) assert.throws(() => validateSvg(svg), why, svg.slice(0, 80));
});

test('drawings are stored per agent and slot, with a version that changes with the content', () => {
  const store = new SpriteStore(fs.mkdtempSync(path.join(os.tmpdir(), 'plexi-sprites-')));
  const v1 = store.save('a_12345678', 'desk', plant);
  assert.match(v1, /^[a-f0-9]{12}$/);
  assert.equal(store.read('a_12345678', 'desk'), validateSvg(plant));
  assert.notEqual(store.save('a_12345678', 'desk', plant.replace('#C98F4A', '#93C5FD')), v1);
  assert.equal(store.read('a_12345678', 'bed'), null);
  assert.throws(() => store.save('../../etc', 'desk', plant), /Unknown agent/);
  assert.throws(() => store.save('a_12345678', 'roof', plant), /Slot must be/);
  store.remove('a_12345678');
  assert.equal(store.read('a_12345678', 'desk'), null);
});
