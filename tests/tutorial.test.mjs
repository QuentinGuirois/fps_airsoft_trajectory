import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TUTORIAL_STORAGE_KEY,
  TUTORIAL_STEPS,
  findAvailableStep,
  shouldOfferTutorial,
  tutorialPreference,
  unionRects,
} from '../calculator-tutorial.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

function fakeStorage(value = null) {
  return {
    getItem(key) {
      assert.equal(key, TUTORIAL_STORAGE_KEY);
      return value;
    },
  };
}

test('le tutoriel contient les sept étapes éditoriales dans l’ordre prévu', () => {
  assert.equal(TUTORIAL_STORAGE_KEY, 'fat-tutorial-v1');
  assert.deepEqual(TUTORIAL_STEPS.map(({ anchor }) => anchor), [
    'masse', 'energie', 'hopup', 'angle', 'avance', 'comparer', 'partager',
  ]);
  assert.equal(TUTORIAL_STEPS.length, 7);
  for (const step of TUTORIAL_STEPS) {
    assert.ok(step.title.length > 3);
    assert.ok(step.body.length > 40);
  }
});

test('la proposition de première visite respecte uniquement completed et dismissed', () => {
  assert.equal(tutorialPreference(fakeStorage()), null);
  assert.equal(tutorialPreference(fakeStorage('completed')), 'completed');
  assert.equal(tutorialPreference(fakeStorage('dismissed')), 'dismissed');
  assert.equal(tutorialPreference(fakeStorage('inconnu')), null);
  assert.equal(shouldOfferTutorial(fakeStorage()), true);
  assert.equal(shouldOfferTutorial(fakeStorage('completed')), false);
  assert.equal(shouldOfferTutorial(fakeStorage('dismissed')), false);
  assert.equal(shouldOfferTutorial({ getItem() { throw new Error('bloqué'); } }), true);
});

test('la géométrie regroupe les champs et ignore les cibles absentes', () => {
  assert.deepEqual(unionRects([
    { left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 },
    { left: 120, top: 15, right: 220, bottom: 90, width: 100, height: 75 },
  ]), { left: 10, top: 15, right: 220, bottom: 90, width: 210, height: 75 });
  assert.equal(unionRects([{ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }]), null);
  const steps = [{ anchor: 'a' }, { anchor: 'b' }, { anchor: 'c' }];
  assert.equal(findAvailableStep(steps, 0, 1, ({ anchor }) => anchor === 'c'), 2);
  assert.equal(findAvailableStep(steps, 2, -1, ({ anchor }) => anchor === 'a'), 0);
  assert.equal(findAvailableStep(steps, 0, 1, () => null), -1);
});

test('les vrais champs du calculateur portent les ancres et le lancement reste visible', async () => {
  const html = await read('index.html');
  assert.match(html, /data-tutorial-launch[^>]*>\s*Comment utiliser le calculateur \?/);
  for (const anchor of TUTORIAL_STEPS.map(({ anchor }) => anchor)) {
    assert.ok(html.includes(`data-tuto="${anchor}"`), anchor);
  }
  assert.match(html, /data-tuto-include="energie"/);
  assert.match(html, /<script type="module" src="\/calculator-tutorial\.js"><\/script>/);
});

test('le guidage est accessible, résilient et n’intervient pas dans les calculs', async () => {
  const [source, site, css] = await Promise.all([
    read('calculator-tutorial.js'),
    read('site.js'),
    read('assets', 'site.css'),
  ]);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /scrollTo\(\{ top: desired/);
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.doesNotMatch(source, /physics-core|simulation-worker|\.value\s*=/);
  assert.match(site, /Relancer le tutoriel/);
  assert.match(site, /data-tutorial-launch/);
  assert.match(css, /\.tutorial-veil-top/);
  assert.match(css, /\.tutorial-veil-left/);
  assert.match(css, /\.tutorial-veil-right/);
  assert.match(css, /\.tutorial-veil-bottom/);
  assert.match(css, /@keyframes fatPulse/);
  assert.match(css, /prefers-reduced-motion:[\s\S]*\.tutorial-spotlight/);
});

test('le module est précaché et la version PWA est incrémentée', async () => {
  const worker = await read('service-worker.js');
  assert.match(worker, /const CACHE = 'fat-v3-2026-07-18-25'/);
  assert.match(worker, /'\/calculator-tutorial\.js'/);
});
