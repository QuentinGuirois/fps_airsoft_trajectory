import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectWebGL } from '../render-capabilities.js';
import { sceneMarkers, scenePointSignature } from '../drone-3d.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

test('la détection WebGL accepte un contexte valide et échoue sans exception', () => {
  let lost = false;
  const available = detectWebGL({
    documentRef: {
      createElement: () => ({
        getContext: (name) => name === 'webgl2' ? { getExtension: () => ({ loseContext: () => { lost = true; } }) } : null,
        remove() {},
      }),
    },
  });
  assert.equal(available, true);
  assert.equal(lost, true);
  assert.equal(detectWebGL({ documentRef: { createElement: () => ({ getContext: () => null, remove() {} }) } }), false);
  assert.equal(detectWebGL({ documentRef: { createElement: () => { throw new Error('bloqué'); } } }), false);
});

test('les marqueurs et la signature 3D utilisent exactement les points Worker reçus', () => {
  const points = [
    { x: 0, y: 1.5, z: 0 },
    { x: 10, y: 1.8, z: .1 },
    { x: 20, y: 0, z: .3 },
  ];
  const markers = sceneMarkers(points);
  assert.equal(markers.start, points[0]);
  assert.equal(markers.apex, points[1]);
  assert.equal(markers.impact, points[2]);
  assert.equal(scenePointSignature(points), '0|1.5|0;10|1.8|0.1;20|0|0.3');
});

test('le chunk 3D est uniquement importé au premier clic et partage latestResult', async () => {
  const [app, html, worker] = await Promise.all([read('app.js'), read('index.html'), read('service-worker.js')]);
  assert.match(app, /droneModulePromise \|\|= import\('\.\/drone-3d\.js'\)/);
  assert.doesNotMatch(app, /^import .*drone-3d/m);
  assert.doesNotMatch(html, /drone-3d\.js|three\.module|OrbitControls/);
  assert.match(app, /result: state\.latestResult/);
  assert.match(app, /state\.droneApi\.updateResult\(state\.latestResult, state\.comparisons\)/);
  const core = worker.match(/const CORE = \[[\s\S]*?\n\];/)?.[0] || '';
  assert.doesNotMatch(core, /drone-3d|three-r185|OrbitControls/);
});

test('la 3D libère ses ressources, écoute la visibilité et respecte reduced motion', async () => {
  const source = await read('drone-3d.js');
  for (const expected of [
    'ResizeObserver', 'IntersectionObserver', "visibilitychange", 'cancelAnimationFrame',
    'controls.dispose()', 'renderer.dispose()', 'forceContextLoss', 'reducedMotion',
  ]) assert.ok(source.includes(expected), expected);
  assert.match(source, /if \(!reducedMotion\) replay\(\)/);
  assert.match(source, /if \(reducedMotion\) \{[\s\S]*?setBallAt\(1\)/);
});

test('Three.js r185.1 et OrbitControls sont auto-hébergés avec licence', async () => {
  const files = [
    ['assets', 'vendor', 'three-r185', 'build', 'three.module.min.js'],
    ['assets', 'vendor', 'three-r185', 'build', 'three.core.min.js'],
    ['assets', 'vendor', 'three-r185', 'examples', 'jsm', 'controls', 'OrbitControls.js'],
  ];
  const sizes = await Promise.all(files.map((parts) => stat(join(root, ...parts)).then((entry) => entry.size)));
  assert.ok(sizes.every((size) => size > 1000));
  assert.match(await read('assets', 'vendor', 'three-r185', 'README.txt'), /three@0\.185\.1/);
  assert.match(await read('assets', 'vendor', 'three-r185', 'LICENSE.txt'), /MIT License/);
  assert.match(await read(...files[2]), /from '\.\.\/\.\.\/\.\.\/build\/three\.module\.min\.js'/);
});

test('le cache différé référence tous les modules 3D sans les précacher', async () => {
  const worker = await read('service-worker.js');
  assert.match(worker, /fat-v3-2026-07-18-16/);
  for (const path of [
    '/drone-3d.js',
    '/assets/vendor/three-r185/build/three.module.min.js',
    '/assets/vendor/three-r185/build/three.core.min.js',
    '/assets/vendor/three-r185/examples/jsm/controls/OrbitControls.js',
  ]) assert.ok(worker.includes(`'${path}'`), path);
  assert.match(worker, /event\.data\?\.type !== 'CACHE_3D'/);
  assert.match(worker, /if \(!await cache\.match\(url\)\) await cache\.add\(url\)/);
});
