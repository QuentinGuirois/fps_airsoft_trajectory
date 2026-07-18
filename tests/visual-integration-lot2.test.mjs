import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('le shell rend un header, un sélecteur de thème et un footer cohérents partout', async () => {
  const [site, theme, css, offline] = await Promise.all([
    read('site.js'), read('theme.js'), read('assets', 'site.css'), read('offline.html'),
  ]);
  for (const href of [
    '/#calculateur',
    '/convertisseur-joules-fps/',
    '/outils/choisir-gaz-airsoft-pression-temperature/',
    '/guides/choisir-poids-bille-airsoft/',
    '/modele-physique-atp/',
    '/a-propos/',
  ]) assert.ok(site.includes(href), href);
  assert.match(site, /ensureSiteHeader\(\)/);
  assert.match(site, /normalizeFooter\(\)/);
  assert.match(theme, /data-theme-control/);
  assert.match(theme, /Système/);
  assert.match(theme, /Nuit/);
  assert.match(theme, /Jour/);
  assert.match(css, /\.site-footer > \.camo-strip/);
  assert.match(offline, /src="\/site\.js"/);
});

test('le cockpit, le mobile tactile et les rails de guide suivent le lot 2', async () => {
  const [home, site, css] = await Promise.all([read('index.html'), read('site.js'), read('assets', 'site.css')]);
  assert.match(home, /data-trust="calculated">Calculé · ATP/);
  assert.match(css, /grid-template-columns: minmax\(20rem, 46fr\) minmax\(0, 54fr\)/);
  assert.match(css, /\.preset-row \{[^}]*overflow-x: auto/);
  assert.match(css, /\.control-panel > \.field-grid, \.advanced \.field-grid \{ grid-template-columns: repeat\(2/);
  assert.match(css, /min-height: 2\.75rem/);
  assert.match(css, /\.control-panel \.field > label, \.control-panel \.field > \.field-label \{[^}]*min-height: 2\.2rem/);
  assert.match(site, /enhanceGuideRails/);
  assert.match(css, /\.guide-rail-cta/);
  assert.match(css, /max-width: var\(--reading\)/);
  assert.match(css, /\.brand, \.menu-toggle, \.theme-option span \{ min-height: 44px; \}/);
  assert.match(css, /\.theme-option span \{ min-height: 44px; padding-inline: \.42rem/);
  assert.match(css, /\.drone-controls button \{ min-height: 44px/);
});

test('les petits textes acide et secondaires conservent un contraste AA dans les deux thèmes', async () => {
  const css = await read('assets', 'site.css');
  assert.match(css, /--muted-dim: #7d8664/);
  assert.match(css, /--muted-dim: #5a6247/);
  assert.match(css, /--acid-text: #456900/);
  assert.ok(contrast('#7d8664', '#171c11') >= 4.5);
  assert.ok(contrast('#456900', '#e0e3cf') >= 4.5);
  assert.ok(contrast('#456900', '#eef0e2') >= 4.5);
});

test('l’outil gaz conserve son parcours et affiche résultat, provenance, comparaison et courbe', async () => {
  const [html, app] = await Promise.all([
    read('outils', 'choisir-gaz-airsoft-pression-temperature', 'index.html'),
    read('gas-pressure-app.js'),
  ]);
  assert.ok(html.indexOf('id="gas-temperature"') < html.indexOf('id="gas-brand"'));
  assert.ok(html.indexOf('id="gas-brand"') < html.indexOf('id="gas-product"'));
  assert.match(html, /id="gas-chart-primary"/);
  assert.match(html, /id="gas-chart-comparison"/);
  assert.match(html, /data-trust="external">Données documentées/);
  assert.match(app, /renderPressureChart/);
  assert.match(app, /result\.presentation\.label/);
  assert.match(app, /selectionSearchParams/);
  assert.match(app, /localStorage/);
});

test('les données gaz restent bit à bit identiques au début du lot 2', async () => {
  const source = await readFile(join(root, 'data', 'green-gas-pressure-curves.json'));
  const hash = createHash('sha256').update(source).digest('hex').toUpperCase();
  const data = JSON.parse(source);
  assert.equal(hash, '8AAB3754FFE4E8B8D12D4864C3F376CFBB1BF041F00D317CA407A58AB0CA65D8');
  assert.equal(data.products.length, 49);
  assert.equal(data.products.reduce((sum, product) => sum + product.curve.length, 0), 2744);
});

test('aucune page joueur mince n’est publiée sans profil autorisé', async () => {
  const [schema, docs, sitemap, css] = await Promise.all([
    read('data', 'operator-profile.schema.json'),
    read('docs', 'operator-cards.md'),
    read('sitemap.xml'),
    read('assets', 'site.css'),
  ]);
  await assert.rejects(stat(join(root, 'tu-joues-avec-quoi', 'index.html')));
  assert.doesNotMatch(sitemap, /tu-joues-avec-quoi/);
  assert.match(schema, /"status": \{ "const": "verified" \}/);
  assert.match(schema, /"profile": \{ "const": true \}/);
  assert.match(docs, /CHRONY/);
  assert.match(css, /\.operator-card/);
});

test('la page À propos utilise la photo réelle, le patch Keep et l’attribution réutilisable', async () => {
  const [html, css] = await Promise.all([read('a-propos', 'index.html'), read('assets', 'site.css')]);
  const portrait = await stat(join(root, 'assets', 'img', 'quentin-guirois.jpg'));
  assert.ok(portrait.size > 1_000_000);
  assert.match(html, /class="about-portrait"/);
  assert.match(html, /alt="Keep en tenue d’airsoft sur le terrain"/);
  assert.match(css, /\.about-portrait \{[^}]*aspect-ratio: 1/);
  assert.match(css, /\.about-portrait img \{[^}]*height: 100%;[^}]*object-position: 50% 35%/);
  assert.match(html, /Keep · développeur & airsofteur/);
  assert.match(html, /attribution-block mackila-attribution/);
  assert.match(html, /data-trust="external">Attribution/);
});

test('le cache et les ressources restent autonomes sans CDN', async () => {
  const [worker, css, site, gas] = await Promise.all([
    read('service-worker.js'), read('assets', 'site.css'), read('site.js'), read('gas-pressure-app.js'),
  ]);
  assert.match(worker, /fat-v3-2026-07-18-26/);
  for (const source of [worker, css, site, gas]) {
    assert.doesNotMatch(source, /https?:\/\/(?:fonts\.|cdn\.|unpkg|jsdelivr)/i);
  }
});
