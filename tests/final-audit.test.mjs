import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFile(join(root, ...parts), 'utf8');
const normalize = (value) => String(value)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]));
}

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(nodes)];
}

test('les slogans emploient exactement la physique et bannissent seulement les anciennes accroches', async () => {
  const [home, atp] = await Promise.all([read('index.html'), read('modele-physique-atp', 'index.html')]);
  assert.match(home, /Ta bille ne ment pas\.<br><span>La physique non plus\.<\/span>/);
  assert.match(atp, /Mackila a posé la physique\.<br>F\.A\.T\. l’emmène sur le terrain\./);
  assert.match(atp, /og:description" content="Mackila a posé la physique\. Keep l’a amenée sur le terrain\."/);
  assert.doesNotMatch(`${home}\n${atp}`, /Les maths non plus|Mackila a fait les maths|Keep les a amenées/);
});

test('le portrait responsive respecte le budget et aucun original lourd ne rejoint la release', async () => {
  const [home, about, portrait320, portrait640, social] = await Promise.all([
    read('index.html'), read('a-propos', 'index.html'),
    stat(join(root, 'assets', 'img', 'quentin-guirois-320.webp')),
    stat(join(root, 'assets', 'img', 'quentin-guirois-640.webp')),
    stat(join(root, 'assets', 'img', 'quentin-guirois-social.jpg')),
  ]);
  await assert.rejects(access(join(root, 'assets', 'img', 'quentin-guirois.jpg')));
  assert.ok(portrait320.size < portrait640.size);
  assert.ok(portrait640.size <= 102_400, portrait640.size);
  assert.ok(social.size <= 200_000, social.size);
  for (const html of [home, about]) {
    assert.match(html, /quentin-guirois-320\.webp[^\"]+320w/);
    assert.match(html, /quentin-guirois-640\.webp[^\"]+640w/);
    assert.match(html, /loading="lazy" decoding="async"/);
  }
});

test('le shell PWA critique reste petit, résilient et sans image sociale ni portrait', async () => {
  const worker = await read('service-worker.js');
  const block = worker.match(/const CRITICAL = \[([\s\S]*?)\n\];/)?.[1] || '';
  const resources = [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  let bytes = 0;
  for (const resource of resources) {
    const pathname = resource.split('?')[0].replace(/^\//, '') || 'index.html';
    bytes += (await stat(join(root, pathname))).size;
  }
  assert.ok(bytes <= 300_000, `shell critique ${bytes} octets`);
  assert.match(worker, /Promise\.allSettled\(OPTIONAL\.map/);
  assert.match(worker, /const LAZY_3D/);
  assert.doesNotMatch(block, /three-r185|drone-3d|partage-fat|quentin-guirois/);
  assert.match(worker, /versioned[\s\S]*caches\.match\(event\.request\)[\s\S]*cached \|\| fetch/);
});

test('les images de contenu et le cache des cards publiques restent bornés', async () => {
  for (const name of ['quentin-guirois-320.webp', 'quentin-guirois-640.webp', 'quentin-guirois-social.jpg', 'partage-fat.png']) {
    const entry = await stat(join(root, 'assets', 'img', name));
    assert.ok(entry.size <= 200_000, `${name}: ${entry.size}`);
  }
  const response = await read('api', 'src', 'Response.php');
  assert.match(response, /max-age=3600, stale-while-revalidate=86400/);
  assert.doesNotMatch(response, /public, max-age=31536000, immutable/);
});

test('les JSON-LD sont valides, absolus et les FAQ correspondent au contenu visible', async () => {
  const pages = [
    'index.html', 'faq-airsoft-balistique/index.html',
    'outils/choisir-gaz-airsoft-pression-temperature/index.html',
    'guides/index.html', 'guides/choisir-poids-bille-airsoft/index.html',
    'guides/regler-hop-up-airsoft/index.html', 'guides/portee-airsoft/index.html',
    'guides/joule-creep-airsoft/index.html', 'modele-physique-atp/index.html',
    'convertisseur-joules-fps/index.html', 'a-propos/index.html',
  ];
  for (const page of pages) {
    const html = await read(...page.split('/'));
    const data = jsonLd(html);
    assert.ok(data.length, page);
    for (const node of data.flatMap(nodes)) {
      for (const key of ['url', 'item', 'image', 'mainEntityOfPage']) {
        if (typeof node[key] === 'string') assert.match(node[key], /^https:\/\//, `${page}: ${key}`);
      }
      if (node['@type'] !== 'FAQPage') continue;
      for (const question of node.mainEntity || []) {
        assert.ok(normalize(html).includes(normalize(question.name)), `${page}: ${question.name}`);
        assert.ok(normalize(html).includes(normalize(question.acceptedAnswer?.text)), `${page}: réponse ${question.name}`);
      }
    }
  }
  const home = await read('index.html');
  assert.doesNotMatch(home, /"@type"\s*:\s*"FAQPage"/);
});

test('les guides et articles stratégiques exposent breadcrumbs et cartes sociales cohérentes', async () => {
  const pages = [
    'guides/index.html', 'guides/choisir-poids-bille-airsoft/index.html',
    'guides/regler-hop-up-airsoft/index.html', 'guides/portee-airsoft/index.html',
    'guides/joule-creep-airsoft/index.html', 'modele-physique-atp/index.html',
    'convertisseur-joules-fps/index.html', 'faq-airsoft-balistique/index.html', 'a-propos/index.html',
  ];
  for (const page of pages) {
    const html = await read(...page.split('/'));
    assert.match(html, /"@type":"BreadcrumbList"/, page);
    for (const property of ['og:url', 'og:title', 'og:description', 'og:image']) {
      assert.match(html, new RegExp(`property="${property}"`), `${page}: ${property}`);
    }
    assert.match(html, /name="twitter:card" content="summary_large_image"/, page);
    assert.match(html, /name="twitter:image" content="https:\/\/fps-airsoft-trajectory\.com\//, page);
  }
});

test('la galerie reste liée mais noindex hors sitemap et la génération utilise les vraies dates Git', async () => {
  const [gallery, sitemap, site, builder] = await Promise.all([
    read('tu-joues-avec-quoi', 'index.html'), read('sitemap.xml'), read('site.js'), read('bin', 'build-sitemap.mjs'),
  ]);
  assert.match(gallery, /name="robots" content="noindex,follow/);
  assert.doesNotMatch(sitemap, /tu-joues-avec-quoi/);
  assert.match(site, /tu-joues-avec-quoi/);
  assert.match(builder, /git', \['log', '-1', '--format=%cs'/);
  assert.doesNotMatch(builder, /tu-joues-avec-quoi/);
});

test('la santé accepte GET et HEAD et la maintenance applique 180 jours configurables', async () => {
  const [application, maintenance, example] = await Promise.all([
    read('api', 'src', 'Application.php'), read('bin', 'maintenance.php'), read('config', '.env.example'),
  ]);
  assert.match(application, /add\('GET', '\/health'/);
  assert.match(application, /add\('HEAD', '\/health'/);
  assert.match(maintenance, /AUDIT_RETENTION_DAYS', 180/);
  assert.match(maintenance, /TECHNICAL_LOG_RETENTION_DAYS', 180/);
  assert.match(example, /^AUDIT_RETENTION_DAYS=180$/m);
  assert.match(example, /^TECHNICAL_LOG_RETENTION_DAYS=180$/m);
});

test('le pipeline fige Lighthouse, archive ses rapports et differe HSTS includeSubDomains', async () => {
  const [workflow, htaccess, mobile, desktop] = await Promise.all([
    read('.github', 'workflows', 'production.yml'), read('.htaccess'),
    read('lighthouserc-mobile.cjs'), read('lighthouserc-desktop.cjs'),
  ]);
  assert.match(workflow, /@lhci\/cli@0\.15\.1/);
  assert.match(workflow, /npm run lighthouse:mobile/);
  assert.match(workflow, /npm run lighthouse:desktop/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /include-hidden-files: true/);
  for (const config of [mobile]) {
    assert.match(config, /performance/);
    assert.match(config, /largest-contentful-paint/);
    assert.match(config, /cumulative-layout-shift/);
    assert.match(config, /total-blocking-time/);
  }
  assert.match(desktop, /require\('\.\/lighthouserc-mobile\.cjs'\)/);
  assert.match(desktop, /preset: 'desktop'/);
  assert.match(htaccess, /Strict-Transport-Security "max-age=31536000"/);
  assert.match(htaccess, /Header add Link "<\/assets\/site\.css\?v=20260719-45>; rel=preload; as=style"/);
  assert.doesNotMatch(htaccess, /Strict-Transport-Security "[^"]*includeSubDomains/);
});

test('les correctifs Lighthouse conservent des noms accessibles et une region publique nommee', async () => {
  const [site, home, gas, advanced, gallery] = await Promise.all([
    read('site.js'), read('index.html'),
    read('outils', 'choisir-gaz-airsoft-pression-temperature', 'index.html'),
    read('simulateur-3d-airsoft', 'index.html'),
    read('tu-joues-avec-quoi', 'index.html'),
  ]);
  assert.doesNotMatch(site, /class="brand"[^>]+aria-label/);
  assert.match(home, /id="spin-auto"[^>]+title="Revenir au hop-up automatique conseillé"/);
  assert.doesNotMatch(home, /id="spin-auto"[^>]+aria-label/);
  assert.match(gallery, /data-community-grid role="region" aria-label="Cards de répliques publiées"/);
  for (const html of [home, gas, advanced, gallery]) {
    const preload = html.indexOf('<link rel="preload" href="/assets/site.css?v=20260719-45" as="style">');
    const bootstrap = html.indexOf('<script src="/theme-bootstrap.js?v=20260719-45" data-cfasync="false"></script>');
    assert.ok(preload >= 0 && preload < bootstrap);
    assert.match(html, /rel="preload" href="\/assets\/fonts\/saira-latin-400-900\.woff2" as="font" type="font\/woff2" crossorigin/);
  }
});
