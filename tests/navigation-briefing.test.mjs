import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

async function pages(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await pages(path));
    else if (entry.name === 'index.html') result.push(path);
  }
  return result;
}

test('toutes les pages indexables gardent le même header progressif et trois liens réels', async () => {
  const paths = await pages();
  assert.ok(paths.length >= 14);
  for (const path of paths) {
    const html = await readFile(path, 'utf8');
    if (/<meta name="robots" content="[^"]*noindex/i.test(html)) continue;
    const header = html.match(/<header class="site-header"[\s\S]*?<\/header>/)?.[0];
    assert.ok(header, relative(root, path));
    assert.equal((header.match(/<nav class="primary-nav"/g) || []).length, 1, relative(root, path));
    assert.equal((header.match(/<a href="\/(?:#calculateur|outils\/|guides\/)"/g) || []).length, 3, relative(root, path));
    assert.match(header, /data-install-app hidden>Installer l’app/);
    assert.match(header, /data-menu-button aria-expanded="false" aria-controls="briefing-menu"/);
    assert.equal((header.match(/aria-current="page"/g) || []).length <= 1, true, relative(root, path));
  }
});

test('le header progressif expose un accès compte permanent et tactile', async () => {
  const [site, css] = await Promise.all([read('site.js'), read('assets', 'site.css')]);
  assert.match(site, /class="account-access" href="\/compte\/" aria-label="Mon compte"/);
  assert.match(site, /<span>Mon compte<\/span>/);
  assert.match(css, /\.account-access \{[^}]*min-height: 44px/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.account-access \{ width: 44px/);
});

test('les hubs Outils et Guides existent, sont indexables et ne pointent que vers des routes réelles', async () => {
  const [tools, guides] = await Promise.all([read('outils', 'index.html'), read('guides', 'index.html')]);
  for (const [html, canonical] of [[tools, '/outils/'], [guides, '/guides/']]) {
    assert.match(html, new RegExp(`<link rel="canonical" href="https://fps-airsoft-trajectory\\.com${canonical}"`));
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    assert.match(html, /"@type":"CollectionPage"/);
  }
  for (const route of ['outils', 'guides', 'convertisseur-joules-fps', 'simulateur-3d-airsoft', 'modele-physique-atp', 'a-propos', 'faq-airsoft-balistique']) {
    await stat(join(root, route, 'index.html'));
  }
});

test('le briefing expose le dialogue, les routes réelles et les comportements accessibles', async () => {
  const site = await read('site.js');
  assert.match(site, /role', 'dialog'/);
  assert.match(site, /aria-modal', 'true'/);
  assert.match(site, /aria-labelledby', 'briefing-menu-title'/);
  assert.match(site, /aria-controls="briefing-menu"/);
  assert.match(site, /focusable\.at\(-1\)/);
  assert.match(site, /event\.key === 'Escape'/);
  assert.match(site, /has-briefing-menu/);
  assert.match(site, /window\.scrollTo\(0, menuScrollY\)/);
  assert.match(site, /briefingMenu\.hidden = true/);
  assert.match(site, /briefingMenu\.hidden = false/);
  for (const href of ['/#calculateur', '/compte/', '/convertisseur-joules-fps/', '/outils/choisir-gaz-airsoft-pression-temperature/', '/guides/', '/simulateur-3d-airsoft/', '/tu-joues-avec-quoi/']) assert.ok(site.includes(href), href);
});

test('le dernier setup reste honnête et ne déduit jamais une portée de l’énergie', async () => {
  const [site, app, advanced] = await Promise.all([read('site.js'), read('app.js'), read('advanced-3d-app.js')]);
  assert.match(site, /fat-shot-v3/);
  assert.match(site, /fat-last-summary-v3/);
  assert.match(site, /PORTÉE —/);
  assert.match(site, /AUCUN SETUP ENREGISTRÉ/);
  assert.match(site, /summaryMatches/);
  assert.match(site, /data-trust="calculated">Calculé/);
  assert.doesNotMatch(site, /usefulRangeM\s*=\s*[^;]*energyJ/);
  for (const source of [app, advanced]) {
    assert.match(source, /fat-last-summary-v3/);
    assert.match(source, /usefulRangeM/);
    assert.match(source, /calculatedAt: new Date\(\)\.toISOString\(\)/);
  }
});

test('animations, reduced motion, PWA et fond CSS respectent la salle de briefing', async () => {
  const [css, site, worker] = await Promise.all([read('assets', 'site.css'), read('site.js'), read('service-worker.js')]);
  for (const name of ['fatMenuIn', 'fatScan', 'fatTracer']) assert.match(css, new RegExp(`@keyframes ${name}`));
  assert.match(css, /\.briefing-grid[^}]*rotateX\(64deg\) rotateZ\(-14deg\)/);
  assert.match(css, /\.briefing-tracer[^}]*offset-path: path/);
  assert.match(css, /prefers-reduced-motion:[\s\S]*\.briefing-tracer, \.briefing-pwa-status > span \{ display: none !important/);
  assert.doesNotMatch(`${site}\n${css}`, /three\.js|three-r185/i);
  assert.match(site, /SERVICE WORKER EN INITIALISATION/);
  assert.match(site, /HORS CONNEXION PRÊT/);
  assert.match(worker, /fat-v3-2026-07-23-47/);
  assert.match(worker, /'\/outils\/'/);
  assert.match(worker, /'\/guides\/'/);
});

test('l’installation mobile reste visible avec invite native ou instructions Safari', async () => {
  const [site, css] = await Promise.all([read('site.js'), read('assets', 'site.css')]);
  assert.match(site, /function appIsInstalled\(\)/);
  assert.match(site, /display-mode: standalone/);
  assert.match(site, /window\.navigator\.standalone === true/);
  assert.match(site, /beforeinstallprompt/);
  assert.match(site, /Sur l’écran d’accueil/);
  assert.match(site, /Installer l’application/);
  assert.match(site, /refreshInstallButtons\(\);/);
  assert.match(site, /service-worker\.js\?v=20260723-47/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.nav-install\[data-install-mode\] \{ display: inline-flex/);
  assert.match(css, /\.pwa-install-guide\[hidden\] \{ display: none/);
});

test('le pseudo joueur est traité comme l’identité principale de chaque card', async () => {
  const [component, css] = await Promise.all([read('assets', 'js', 'replica-card.js'), read('assets', 'site.css')]);
  assert.match(component, /header\.append\(element\(doc, 'span', 'replica-pseudo', data\.user\.pseudo\), avatar\)/);
  assert.match(css, /\.replica-pseudo \{[^}]*border-left: 3px solid var\(--acid\)/);
  assert.match(css, /\.replica-pseudo \{[^}]*font: 800 \.82rem\/1 var\(--font-display\)/);
});

test('les trois petites corrections visuelles restent protégées', async () => {
  const [site, css] = await Promise.all([read('site.js'), read('assets', 'site.css')]);
  assert.match(site, /converter\.insertAdjacentElement\('afterend', trust\)/);
  assert.match(css, /\.guide-rail-cta \.button-primary, \.guide-rail-cta \.button-primary:hover \{ color: var\(--on-acid\)/);
  assert.match(css, /\.gas-kind-pill\[data-tone="published"\][^}]*background: var\(--acid\); color: var\(--on-acid\)/);
});
