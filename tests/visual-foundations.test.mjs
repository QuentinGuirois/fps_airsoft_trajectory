import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyDarkTheme,
  initTheme,
  THEME_COLOR,
} from '../theme.js';
import {
  createCalculationLoader,
  LOADER_DELAY_MS,
  LOADER_MAX_PENDING,
  pendingLoaderProgress,
} from '../calculation-loader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['node_modules', '.git', 'docs'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('le thème force toujours la palette sombre et efface l’ancien choix mémorisé', () => {
  const meta = { value: '', setAttribute(name, value) { if (name === 'content') this.value = value; } };
  const doc = {
    documentElement: { dataset: { themeMode: 'legacy' }, style: {} },
    querySelector: () => meta,
  };
  const removed = [];
  const storage = { removeItem(key) { removed.push(key); } };
  assert.equal(applyDarkTheme({ document: doc }), 'dark');
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal('themeMode' in doc.documentElement.dataset, false);
  assert.equal(doc.documentElement.style.colorScheme, 'dark');
  assert.equal(meta.value, THEME_COLOR);
  assert.deepEqual(initTheme({ document: doc, storage }), { theme: 'dark' });
  assert.deepEqual(removed, ['fat-theme']);
});

test('chaque page initialise le thème dans le head avant la feuille de style', async () => {
  const emailTemplateSegment = `${sep}api${sep}templates${sep}`;
  const files = (await walk(root)).filter((path) => path.endsWith('.html') && !path.includes(emailTemplateSegment));
  for (const path of files) {
    const html = await readFile(path, 'utf8');
    const initPosition = html.indexOf('<script src="/theme-bootstrap.js?v=20260723-47" data-cfasync="false"></script>');
    const cssPosition = html.search(/<link rel="stylesheet" href="\/assets\/site\.css\?v=20260723-47">/);
    assert.ok(initPosition > 0, path);
    assert.ok(cssPosition > initPosition, path);
    assert.match(html, /meta name="theme-color" content="#10140c"/);
  }

  const theme = await readFile(join(root, 'theme.js'), 'utf8');
  const site = await readFile(join(root, 'site.js'), 'utf8');
  assert.match(theme, /applyDarkTheme/);
  assert.doesNotMatch(theme, /data-theme-control|theme-switcher|fat:themechange/);
  assert.match(site, /document\.readyState === 'complete'/);
  assert.match(site, /registerServiceWorker/);
});

test('les tokens et composants du lot 1 sont centralisés dans site.css', async () => {
  const css = await readFile(join(root, 'assets', 'site.css'), 'utf8');
  for (const token of [
    '--ink-0: #10140c', '--ink-1: #171c11', '--ink-2: #222b18', '--ink-3: #12160d',
    '--olive: #4a5537', '--ranger: #6b7a4f', '--khaki: #b5b09a', '--paper: #e9ecdd',
    '--acid: #a8ff3f', '--curve-2: #5fd4a8', '--curve-3: #d4b95f', '--curve-4: #e07856',
    '--font-display: Saira', '--font-mono: "IBM Plex Mono"', '--font-stencil: "Saira Stencil One"',
  ]) assert.ok(css.includes(token), token);
  for (const component of ['.chip', '.trust-tag', '.field-card', '.metric-hero', '.stencil-patch', '.camo-strip', '.hatched-block', '.attribution-block']) {
    assert.ok(css.includes(component), component);
  }
  assert.doesNotMatch(css, /data-theme="light"|prefers-color-scheme:\s*light|color-scheme:\s*light/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /@supports \(offset-path: path/);
  assert.match(css, /\.calculation-loader-ball \{[\s\S]*?top: 26px;[\s\S]*?left: 78px;/);
});

test('le loader attend 300 ms, plafonne à 99 et ignore les anciennes réponses', () => {
  assert.equal(LOADER_DELAY_MS, 300);
  assert.equal(pendingLoaderProgress(0), 4);
  assert.equal(pendingLoaderProgress(1e9), LOADER_MAX_PENDING);

  const nodes = new Map([
    ['[data-loader-phrase]', { textContent: '' }],
    ['[data-loader-percent]', { textContent: '' }],
    ['[data-loader-bar]', { style: {} }],
    ['[data-loader-progress]', { attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } }],
  ]);
  const element = { hidden: true, dataset: {}, querySelector: (selector) => nodes.get(selector) || null };
  const busyTarget = { attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } };
  const timers = [];
  const repeaters = [];
  const frames = [];
  let time = 0;
  const loader = createCalculationLoader({
    element,
    busyTarget,
    now: () => time,
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimer: () => {},
    setRepeater: (callback) => { repeaters.push(callback); return repeaters.length; },
    clearRepeater: () => {},
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    reducedMotion: false,
  });

  loader.start(10, { initial: true });
  assert.equal(timers[0].delay, 300);
  assert.equal(element.hidden, true);
  assert.equal(busyTarget.attrs['aria-busy'], 'true');
  timers[0].callback();
  assert.equal(loader.getState().visible, true);
  time = 1e9;
  repeaters[0]();
  assert.equal(loader.getState().progress, 99);
  assert.equal(loader.complete(9), false);
  assert.equal(loader.getState().activeRequestId, 10);
  assert.equal(loader.complete(10), true);
  assert.equal(loader.getState().progress, 100);
  assert.equal(busyTarget.attrs['aria-busy'], 'false');
  frames.at(-1)();
  assert.equal(element.hidden, true);

  loader.start(11, { initial: false });
  loader.start(12, { initial: false });
  assert.equal(loader.complete(11), false);
  assert.equal(loader.fail(12, 'Erreur'), true);
  assert.equal(busyTarget.attrs['aria-busy'], 'false');
});

test('le loader de production suit le requestId réel sans DCLogic ni attente artificielle', async () => {
  const app = await readFile(join(root, 'app.js'), 'utf8');
  const loader = await readFile(join(root, 'calculation-loader.js'), 'utf8');
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.match(app, /calculationLoader\?\.start\(requestId/);
  assert.match(app, /calculationLoader\?\.complete\(message\.requestId\)/);
  assert.match(app, /if \(message\.requestId !== state\.requestId\) return/);
  assert.match(html, /data-calculation-loader/);
  assert.match(html, /role="progressbar"/);
  assert.doesNotMatch(`${app}\n${loader}\n${html}`, /DCLogic|support\.js/);
  assert.doesNotMatch(loader, /await new Promise|sleep/);
});

test('les actifs logo et PWA ont les formats et dimensions annoncés', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
  const expected = new Map([
    ['/assets/img/icon-192.png', '192x192'],
    ['/assets/img/icon-512.png', '512x512'],
    ['/assets/img/icon-maskable-512.png', '512x512'],
  ]);
  for (const icon of manifest.icons) assert.equal(expected.get(icon.src), icon.sizes, icon.src);
  assert.equal(manifest.icons.find((icon) => icon.src.includes('maskable'))?.purpose, 'maskable');

  for (const [file, dimensions] of [
    ['icon-192.png', { width: 192, height: 192 }],
    ['icon-512.png', { width: 512, height: 512 }],
    ['icon-maskable-512.png', { width: 512, height: 512 }],
    ['partage-fat.png', { width: 1200, height: 630 }],
  ]) assert.deepEqual(pngDimensions(await readFile(join(root, 'assets', 'img', file))), dimensions, file);

  const icon192 = await readFile(join(root, 'assets', 'img', 'icon-192.png'));
  assert.ok(icon192.length > 5000, 'le rendu 192 ne doit pas être un recadrage presque vide');
  const icon512 = await readFile(join(root, 'assets', 'img', 'icon-512.png'));
  const maskable = await readFile(join(root, 'assets', 'img', 'icon-maskable-512.png'));
  assert.notDeepEqual(icon512, maskable);
  const mainLogo = await readFile(join(root, 'assets', 'img', 'icon.svg'), 'utf8');
  assert.match(mainLogo, /M6 62C30 30 62 22 78 26/);
  const maskableSource = await readFile(join(root, 'assets', 'img', 'icon-maskable.svg'), 'utf8');
  assert.match(maskableSource, /M143 334C185 267 242 242 277 252/);
  assert.match(maskableSource, /x1="137"[^>]*x2="343"/);
});

test('les polices officielles, licences et modules visuels sont disponibles hors ligne sans CDN', async () => {
  const fontFiles = [
    'saira-latin-400-900.woff2', 'saira-stencil-one-latin-400.woff2',
    'ibm-plex-mono-latin-400.woff2', 'ibm-plex-mono-latin-500.woff2', 'ibm-plex-mono-latin-600.woff2',
  ];
  for (const file of fontFiles) {
    const font = await readFile(join(root, 'assets', 'fonts', file));
    assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2', file);
  }
  for (const file of ['Inter-OFL.txt', 'Saira-OFL.txt', 'Saira-Stencil-One-OFL.txt', 'IBM-Plex-Mono-OFL.txt']) {
    assert.match(await readFile(join(root, 'assets', 'fonts', 'licenses', file), 'utf8'), /SIL OPEN FONT LICENSE/i, file);
  }

  const sw = await readFile(join(root, 'service-worker.js'), 'utf8');
  for (const resource of [...fontFiles.map((file) => `/assets/fonts/${file}`), '/theme.js?v=20260723-47', '/calculation-loader.js?v=20260723-47', '/assets/img/icon-maskable-512.png']) {
    assert.ok(sw.includes(`'${resource}'`), resource);
  }
  assert.doesNotMatch(sw, /quentin-guirois-(?:320|640)|quentin-guirois-social|partage-fat\.png/);
  assert.match(sw, /const CACHE = 'fat-v3-2026-07-23-47'/);

  const production = (await walk(root)).filter((path) => /\.(?:html|css|js|webmanifest|svg)$/.test(path));
  for (const path of production) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/, path);
  }
});
