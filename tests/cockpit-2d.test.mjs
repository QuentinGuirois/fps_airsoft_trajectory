import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

test('le cockpit conserve le canvas accessible, ses onglets, sa table et ses légendes', async () => {
  const html = await read('index.html');
  assert.match(html, /class="cockpit-scene"/);
  assert.match(html, /class="chart-viewport"/);
  assert.match(html, /id="vertical-scale-chip"[^>]*hidden>HAUTEUR ×10/);
  assert.match(html, /id="trajectory-chart" role="img" aria-label="[^"]+" aria-describedby="chart-caption chart-reference-legend"/);
  assert.equal((html.match(/data-chart-mode=/g) || []).length, 5);
  assert.match(html, /id="comparison-list"/);
  assert.match(html, /id="holdover-body"/);
});

test('les couleurs du Canvas sont relues dans les variables CSS à chaque dessin', async () => {
  const [app, css] = await Promise.all([read('app.js'), read('assets', 'site.css')]);
  for (const token of [
    '--chart-active', '--curve-2', '--curve-3', '--curve-4', '--chart-grid',
    '--chart-label', '--chart-sight', '--chart-ground', '--chart-envelope',
    '--chart-marker-useful', '--chart-marker-apex', '--chart-marker-impact',
  ]) {
    assert.match(css, new RegExp(`${token.replaceAll('-', '\\-')}:`));
    assert.match(app, new RegExp(`cssColor\\('${token.replaceAll('-', '\\-')}'`));
  }
  const themeHandler = app.match(/window\.addEventListener\('fat:themechange',[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.match(themeHandler, /drawChart/);
  assert.doesNotMatch(themeHandler, /runSimulation|simulateTrajectory|postMessage/);
});

test('la géométrie et les traits du cockpit suivent la charte 2D', async () => {
  const [app, chartData, css] = await Promise.all([read('app.js'), read('chart-data.js'), read('assets', 'site.css')]);
  assert.match(css, /aspect-ratio:\s*4\.5\s*\/\s*1/);
  assert.match(css, /aspect-ratio:\s*3\s*\/\s*1/);
  assert.match(css, /\.cockpit-scene\s*\{[^}]*position:\s*sticky/s);
  assert.match(chartData, /lineWidth:\s*index === 0 \? 3\.5 : 2/);
  assert.match(chartData, /lineDash:\s*index === 0 \? \[\] : \[10, 5\]/);
  assert.match(app, /renderReferenceLegend\(Boolean\(prepared\.trajectory\)\)/);
});

test('le partage expose toujours une URL complète et restaure les paramètres avancés', async () => {
  const [html, app] = await Promise.all([read('index.html'), read('app.js')]);
  assert.match(html, /id="share-output" hidden/);
  assert.match(html, /id="share-url" type="url" readonly/);
  assert.match(html, /id="copy-share-url"/);
  for (const parameter of ['sh', 'oh', 'lat', 'd']) {
    assert.match(app, new RegExp(`${parameter}: shot\.`));
  }
  assert.match(app, /history\.replaceState\(history\.state, '', url\)/);
  assert.match(app, /document\.execCommand\?\.\('copy'\)/);
});

test('le cache PWA contient les modules 2D avec une nouvelle version', async () => {
  const worker = await read('service-worker.js');
  assert.match(worker, /fat-v3-2026-07-18-28/);
  assert.match(worker, /'\/chart-data\.js\?v=20260718-28'/);
  assert.match(worker, /'\/app\.js\?v=20260718-28'/);
  assert.match(worker, /'\/assets\/site\.css\?v=20260718-28'/);
});
