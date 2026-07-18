import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureShareButton, isCoarseTouchDevice, shareLink } from '../assets/js/share-link.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

function controls() {
  return {
    output: { hidden: true },
    input: {
      value: '',
      focused: false,
      selected: false,
      focus() { this.focused = true; },
      select() { this.selected = true; },
    },
    feedback: { textContent: '' },
  };
}

test('sur ordinateur, le bouton copie le lien sans ouvrir le partage natif', async () => {
  const ui = controls();
  const calls = { copied: '', shared: 0 };
  const result = await shareLink({
    url: 'https://fps-airsoft-trajectory.com/?m=0.36&j=1.90',
    ...ui,
    navigatorRef: {
      maxTouchPoints: 0,
      share: async () => { calls.shared += 1; },
      clipboard: { writeText: async (value) => { calls.copied = value; } },
    },
    matchMediaRef: () => ({ matches: false }),
  });
  assert.equal(result.method, 'clipboard');
  assert.equal(calls.shared, 0);
  assert.match(calls.copied, /m=0\.36/);
  assert.equal(ui.output.hidden, false);
  assert.equal(ui.input.value, calls.copied);
  assert.match(ui.feedback.textContent, /Lien copié/);
});

test('le partage natif est réservé à un appareil tactile à pointeur grossier', async () => {
  const ui = controls();
  let payload;
  assert.equal(isCoarseTouchDevice({
    navigatorRef: { maxTouchPoints: 5 },
    matchMediaRef: () => ({ matches: true }),
  }), true);
  const result = await shareLink({
    url: 'https://fps-airsoft-trajectory.com/outils/?t=12',
    title: 'F.A.T.',
    ...ui,
    navigatorRef: {
      maxTouchPoints: 5,
      canShare: () => true,
      share: async (data) => { payload = data; },
    },
    matchMediaRef: () => ({ matches: true }),
  });
  assert.equal(result.method, 'native');
  assert.equal(payload.url, ui.input.value);
  assert.equal(ui.feedback.textContent, 'Lien partagé.');
});

test('sans Clipboard, le lien reste visible, focalisé et sélectionné', async () => {
  const ui = controls();
  const result = await shareLink({
    url: 'https://fps-airsoft-trajectory.com/#calculateur',
    ...ui,
    navigatorRef: { maxTouchPoints: 0 },
    documentRef: { execCommand: () => false },
    matchMediaRef: () => ({ matches: false }),
  });
  assert.equal(result.method, 'manual');
  assert.equal(ui.output.hidden, false);
  assert.equal(ui.input.focused, true);
  assert.equal(ui.input.selected, true);
  assert.match(ui.feedback.textContent, /Ctrl\+C/);
});

test('le libellé de partage reflète la capacité tactile sans user-agent', () => {
  const button = { textContent: '' };
  configureShareButton(button, {
    navigatorRef: { maxTouchPoints: 0 },
    matchMediaRef: () => ({ matches: false }),
  });
  assert.equal(button.textContent, 'Copier le lien');
  configureShareButton(button, {
    navigatorRef: { maxTouchPoints: 2 },
    matchMediaRef: () => ({ matches: true }),
  });
  assert.equal(button.textContent, 'Partager');
});

test('le gaz conserve le partage tandis que les calculateurs enregistrent côté compte', async () => {
  const [app, gas, advanced, home, gasHtml, advancedHtml] = await Promise.all([
    read('app.js'),
    read('gas-pressure-app.js'),
    read('advanced-3d-app.js'),
    read('index.html'),
    read('outils', 'choisir-gaz-airsoft-pression-temperature', 'index.html'),
    read('simulateur-3d-airsoft', 'index.html'),
  ]);
  assert.match(gas, /assets\/js\/share-link\.js/);
  assert.doesNotMatch(gas, /navigator\.share\s*\(/);
  assert.doesNotMatch(app, /assets\/js\/share-link\.js/);
  assert.doesNotMatch(advanced, /assets\/js\/share-link\.js/);
  assert.match(app, /trajectoryRepository\.create/);
  assert.match(advanced, /trajectoryRepository\.create/);
  assert.match(home, /id="share-shot"[^>]*>ENREGISTRER/);
  assert.doesNotMatch(home, /id="share-url"/);
  assert.match(gasHtml, /id="gas-share-url" type="url" readonly/);
  assert.match(advancedHtml, /data-advanced-save>Enregistrer<\/button>/);
  assert.doesNotMatch(advancedHtml, /advanced-share-url|Copier le lien/);
});
