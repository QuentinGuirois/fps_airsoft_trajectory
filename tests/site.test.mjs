import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const htmlFiles = (await walk(root)).filter((path) => path.endsWith('.html'));

test('chaque page indexable possède un title, une description, une canonique et un H1 unique', async () => {
  for (const path of htmlFiles.filter((item) => !item.endsWith('offline.html'))) {
    const html = await readFile(path, 'utf8');
    if (/<meta name="robots" content="[^"]*noindex/i.test(html)) continue;
    assert.match(html, /<title>[^<]{15,70}<\/title>/, path);
    assert.match(html, /<meta name="description" content="[^"]{80,180}">/, path);
    assert.match(html, /<link rel="canonical" href="https:\/\/fps-airsoft-trajectory\.com\//, path);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, path);
  }
});

test('les liens et ressources internes absolus ciblent un fichier existant', async () => {
  for (const path of htmlFiles) {
    const html = await readFile(path, 'utf8');
    const urls = [...html.matchAll(/(?:href|src)="(\/[^"?#]*)(?:[?#][^"]*)?"/g)].map((match) => match[1]);
    for (const url of urls) {
      const relative = url.replace(/^\//, '');
      const target = resolve(root, relative || 'index.html');
      assert.ok(target.startsWith(root), `${path}: ${url}`);
      let exists = false;
      try {
        const info = await stat(target);
        exists = info.isDirectory() ? Boolean(await stat(join(target, 'index.html'))) : true;
      } catch { exists = false; }
      assert.ok(exists, `${path}: lien interne introuvable ${url}`);
    }
  }
});

test('le sitemap ne contient que des URL du domaine et toutes correspondent à une page', async () => {
  const xml = await readFile(join(root, 'sitemap.xml'), 'utf8');
  const urls = [...xml.matchAll(/<loc>https:\/\/fps-airsoft-trajectory\.com(\/[^<]*)<\/loc>/g)].map((match) => match[1]);
  assert.ok(urls.length >= 10);
  for (const url of urls) {
    const target = join(root, url.replace(/^\//, ''), url.endsWith('/') ? 'index.html' : '');
    await stat(target || join(root, 'index.html'));
  }
});

test('le hop-up reste présenté en mode AUTO et le graphique utilise le format panoramique', async () => {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const app = await readFile(join(root, 'app.js'), 'utf8');
  const css = await readFile(join(root, 'assets', 'site.css'), 'utf8');

  assert.match(html, /id="spin-setting">HOP UP AUTO</);
  assert.match(html, /data-spin-delta="-250"/);
  assert.match(html, /data-spin-delta="250"/);
  assert.doesNotMatch(app, /\bcrans?\b/i);
  assert.match(css, /\.calculator-grid \{[^}]*grid-template-columns: minmax\(20rem, 46fr\) minmax\(0, 54fr\)/);
  assert.match(css, /\.chart-viewport \{[^}]*aspect-ratio: 4\.5 \/ 1/);
  assert.match(css, /\.chart-viewport \{ aspect-ratio: 3 \/ 1/);
});

test('l’outil gaz reste accessible depuis le hub et le menu briefing', async () => {
  const home = await readFile(join(root, 'index.html'), 'utf8');
  const gasPage = await readFile(join(root, 'outils', 'choisir-gaz-airsoft-pression-temperature', 'index.html'), 'utf8');
  const toolsPage = await readFile(join(root, 'outils', 'index.html'), 'utf8');
  const site = await readFile(join(root, 'site.js'), 'utf8');
  const href = '/outils/choisir-gaz-airsoft-pression-temperature/';

  assert.match(home, /<nav class="primary-nav"[^>]*>[\s\S]*href="\/outils\/"/);
  assert.match(gasPage, /href="\/outils\/" aria-current="page">Outils/);
  assert.match(toolsPage, new RegExp(`href="${href}"`));
  assert.match(site, /href: gasToolPath, label: 'Gaz & température'/);
  assert.match(site, /briefingNavigation/);
});
