import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneSeries } from '../drone-3d.js';
import { advancedDeviceAdvice } from '../advanced-device.js';
import {
  ADVANCED_TRANSITION_MS,
  consumeAdvancedTransition,
  createAdvancedTransition,
  markAdvancedTransition,
} from '../advanced-transition.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

function result(requestId, offset = 0) {
  return {
    requestId,
    simulation: {
      points: [
        { x: 0, y: 1.5, z: 0 },
        { x: 20 + offset, y: 1.8, z: offset / 100 },
        { x: 50 + offset, y: 0, z: offset / 50 },
      ],
    },
  };
}

function transitionFixture() {
  const attributes = new Map();
  const listeners = new Map();
  const node = () => ({
    style: {}, textContent: '', hidden: true,
    setAttribute(name, value) { attributes.set(name, value); },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    focus() {},
  });
  const phrase = node();
  const percent = node();
  const bar = node();
  const progress = node();
  const skip = node();
  const nodes = {
    '[data-advanced-loader-phrase]': phrase,
    '[data-advanced-loader-percent]': percent,
    '[data-advanced-loader-bar]': bar,
    '[data-advanced-loader-progress]': progress,
    '[data-advanced-loader-skip]': skip,
  };
  const element = {
    hidden: true,
    dataset: {},
    setAttribute(name) { if (name === 'hidden') this.hidden = true; },
    querySelector(selector) { return nodes[selector] || null; },
  };
  return { element, listeners, progress, percent, bar };
}

test('la page avancée expose le SEO exact, une landing utile et aucune vue 2D', async () => {
  const [html, sitemap] = await Promise.all([read('simulateur-3d-airsoft', 'index.html'), read('sitemap.xml')]);
  assert.match(html, /<title>Simulateur 3D de trajectoire airsoft \| F\.A\.T\.<\/title>/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.match(html, /<h1>Simulateur 3D de trajectoire airsoft<\/h1>/);
  assert.match(html, /<meta name="description" content="[^"]{80,180}">/);
  assert.match(html, /rel="canonical" href="https:\/\/fps-airsoft-trajectory\.com\/simulateur-3d-airsoft\/"/);
  assert.match(html, /"@type":"SoftwareApplication"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /Mackila · Airsoft Trajectory Project/);
  assert.match(html, /Le chronographe, les impacts sur cible et les règles de l’organisateur restent prioritaires/);
  assert.doesNotMatch(html, /<canvas|data-chart-mode|data-view-mode="2d"/i);
  assert.match(sitemap, /<loc>https:\/\/fps-airsoft-trajectory\.com\/simulateur-3d-airsoft\/<\/loc>/);
});

test('la home garde son CTA compact et ajoute le lien 3D explicite exact', async () => {
  const [home, site] = await Promise.all([read('index.html'), read('site.js')]);
  assert.match(home, /href="#calculateur">Passer mon setup au banc<\/a>/);
  assert.match(home, /href="\/simulateur-3d-airsoft\/" data-advanced-entry>Passer au simulateur 3D avancé<\/a>/);
  assert.match(site, /markAdvancedTransition\(\)/);
  assert.doesNotMatch(site, /href: '\/simulateur-3d-airsoft\/', label: 'Simulateur 3D'/);
});

test('la transition de cinq secondes ne s’active que pour une entrée explicite et peut être passée', async () => {
  assert.equal(ADVANCED_TRANSITION_MS, 5000);
  const storage = new Map();
  const store = {
    setItem: (key, value) => storage.set(key, value),
    getItem: (key) => storage.get(key) ?? null,
    removeItem: (key) => storage.delete(key),
  };
  markAdvancedTransition(store, 1000);
  assert.equal(consumeAdvancedTransition(store, 2000), true);
  assert.equal(consumeAdvancedTransition(store, 2000), false);

  let directFrames = 0;
  const directFixture = transitionFixture();
  const direct = createAdvancedTransition({
    element: directFixture.element,
    explicit: false,
    requestFrame: () => { directFrames += 1; return 1; },
    cancelFrame() {},
  });
  assert.equal(await direct.start(), 'direct');
  assert.equal(directFrames, 0);
  assert.equal(directFixture.element.hidden, true);

  const skipFixture = transitionFixture();
  const frames = [];
  const explicit = createAdvancedTransition({
    element: skipFixture.element,
    explicit: true,
    now: () => 0,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame() {},
  });
  const gate = explicit.start();
  assert.equal(skipFixture.element.hidden, false);
  skipFixture.listeners.get('click')();
  assert.equal(await gate, 'skip');
  assert.equal(skipFixture.progress.setAttribute instanceof Function, true);
});

test('la progression explicite atteint 100 seulement après les cinq secondes produit', async () => {
  const fixture = transitionFixture();
  const frames = [];
  let clock = 0;
  const transition = createAdvancedTransition({
    element: fixture.element,
    explicit: true,
    durationMs: 5000,
    now: () => clock,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame() {},
  });
  const gate = transition.start();
  frames.shift()();
  frames.shift()();
  clock = 4999;
  frames.shift()();
  assert.notEqual(fixture.percent.textContent, '100 %');
  clock = 5000;
  frames.shift()();
  assert.equal(await gate, 'elapsed');
  assert.equal(fixture.percent.textContent, '100 %');
});

test('la représentation commune conserve une active et au plus trois copies comparées', () => {
  const active = result(1);
  const comparisons = [1, 2, 3, 4].map((index) => ({ label: `Copie ${index}`, result: result(index + 1, index) }));
  const before = structuredClone(comparisons);
  const series = sceneSeries(active, comparisons);
  assert.equal(series.length, 4);
  assert.deepEqual(series.map((item) => item.colorRole), ['active', 'curve2', 'curve3', 'curve4']);
  assert.deepEqual(series.map((item) => item.result.requestId), [1, 2, 3, 4]);
  assert.deepEqual(comparisons, before);
});

test('comparaison, sélection, retrait, caméra et thème ne déclenchent aucun calcul ATP', async () => {
  const app = await read('advanced-3d-app.js');
  assert.match(app, /result: structuredClone\(state\.latestResult\)/);
  assert.match(app, /state\.droneApi\?\.updateResult\(state\.latestResult, state\.comparisons\)/);
  assert.match(app, /function setCamera\(name\) \{[\s\S]*?state\.droneApi\?\.setCamera\(name\)/);
  assert.match(app, /fat:themechange[\s\S]*?setTheme\(droneThemeColors\(\)\)/);
  assert.doesNotMatch(app, /function setCamera[\s\S]{0,300}postMessage/);
  assert.doesNotMatch(app, /legend\.addEventListener[\s\S]{0,900}postMessage/);
});

test('les conseils reposent sur le viewport et les capacités de pointage, jamais sur le user-agent', async () => {
  assert.deepEqual(advancedDeviceAdvice({ width: 390, height: 844, coarsePointer: true, hoverNone: true }), {
    phoneLike: true, portrait: true, constrained: false,
  });
  assert.deepEqual(advancedDeviceAdvice({ width: 844, height: 390, coarsePointer: true, hoverNone: true }), {
    phoneLike: true, portrait: false, constrained: true,
  });
  assert.deepEqual(advancedDeviceAdvice({ width: 768, height: 1024, coarsePointer: true, hoverNone: true }), {
    phoneLike: false, portrait: false, constrained: false,
  });
  assert.equal(advancedDeviceAdvice({ width: 359, height: 700 }).constrained, true);
  const [device, app, html] = await Promise.all([read('advanced-device.js'), read('advanced-3d-app.js'), read('simulateur-3d-airsoft', 'index.html')]);
  assert.doesNotMatch(`${device}\n${app}`, /userAgent|navigator\.platform/);
  assert.match(html, /Pour profiter de la vue 3D, passe ton téléphone en paysage\./);
  assert.match(html, /Continuer en portrait/);
});

test('la scène occupe le viewport, reste locale et rejoint la PWA sans précharger Three', async () => {
  const [css, html, app, worker] = await Promise.all([
    read('assets', 'site.css'), read('simulateur-3d-airsoft', 'index.html'), read('advanced-3d-app.js'), read('service-worker.js'),
  ]);
  assert.match(css, /\.advanced-stage \{[\s\S]*?min-height: calc\(100dvh - 4\.5rem\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(app, /import\('\.\/drone-3d\.js'\)/);
  assert.doesNotMatch(app, /^import .*drone-3d/m);
  assert.doesNotMatch(html, /three\.module|OrbitControls|<script[^>]+(?:https?:)?\/\//i);
  const core = worker.match(/const CORE = \[[\s\S]*?\n\];/)?.[0] || '';
  const lazy = worker.match(/const LAZY_3D = \[[\s\S]*?\n\];/)?.[0] || '';
  for (const resource of ['/simulateur-3d-airsoft/', '/advanced-3d-app.js', '/advanced-device.js', '/advanced-transition.js']) {
    assert.ok(core.includes(`'${resource}'`), resource);
  }
  assert.doesNotMatch(core, /three-r185|drone-3d\.js/);
  assert.match(lazy, /three-r185/);
  assert.match(lazy, /drone-3d\.js/);
  assert.match(worker, /fat-v3-2026-07-18-26/);
});

test('WebGL, Worker et import cassé débouchent sur un panneau utile sans moteur bis', async () => {
  const [app, html] = await Promise.all([read('advanced-3d-app.js'), read('simulateur-3d-airsoft', 'index.html')]);
  assert.match(app, /root\.dataset\.webgl = detectWebGL\(\) \? 'available' : 'unavailable'/);
  assert.match(app, /WebGL n’est pas disponible/);
  assert.match(app, /Le module 3D n’a pas pu être chargé/);
  assert.match(app, /Aucun moteur de remplacement n’est chargé/);
  assert.doesNotMatch(app, /simulateTrajectory|runLocalSimulation|<canvas/i);
  assert.match(html, /data-advanced-fallback/);
  assert.match(html, /href="\/#calculateur">Ouvrir le simulateur compact<\/a>/);
});
