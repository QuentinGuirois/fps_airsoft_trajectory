import { execFileSync } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(process.env.RELEASE_ROOT || sourceRoot);
const domain = 'https://fps-airsoft-trajectory.com';

const pages = [
  ['/', 'index.html', 'weekly', '1.0'],
  ['/convertisseur-joules-fps/', 'convertisseur-joules-fps/index.html', 'monthly', '0.9'],
  ['/simulateur-trajectoire-airsoft/', 'simulateur-trajectoire-airsoft/index.html', 'monthly', '0.9'],
  ['/simulateur-3d-airsoft/', 'simulateur-3d-airsoft/index.html', 'monthly', '0.9'],
  ['/outils/', 'outils/index.html', 'monthly', '0.8'],
  ['/outils/choisir-gaz-airsoft-pression-temperature/', 'outils/choisir-gaz-airsoft-pression-temperature/index.html', 'monthly', '0.9'],
  ['/guides/', 'guides/index.html', 'monthly', '0.8'],
  ['/guides/choisir-poids-bille-airsoft/', 'guides/choisir-poids-bille-airsoft/index.html', 'monthly', '0.8'],
  ['/guides/regler-hop-up-airsoft/', 'guides/regler-hop-up-airsoft/index.html', 'monthly', '0.8'],
  ['/guides/portee-airsoft/', 'guides/portee-airsoft/index.html', 'monthly', '0.8'],
  ['/guides/joule-creep-airsoft/', 'guides/joule-creep-airsoft/index.html', 'monthly', '0.8'],
  ['/modele-physique-atp/', 'modele-physique-atp/index.html', 'monthly', '0.8'],
  ['/faq-airsoft-balistique/', 'faq-airsoft-balistique/index.html', 'monthly', '0.7'],
  ['/a-propos/', 'a-propos/index.html', 'yearly', '0.6'],
  ['/mentions-legales/', 'mentions-legales/index.html', 'yearly', '0.4'],
  ['/politique-confidentialite/', 'politique-confidentialite/index.html', 'yearly', '0.4'],
];

async function lastModified(path) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', path], {
      cwd: sourceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || new Date((await stat(join(sourceRoot, path))).mtime).toISOString().slice(0, 10);
  } catch {
    return new Date((await stat(join(sourceRoot, path))).mtime).toISOString().slice(0, 10);
  }
}

const entries = [];
for (const [url, source, changefreq, priority] of pages) {
  const date = await lastModified(source);
  entries.push(`  <url><loc>${domain}${url}</loc><lastmod>${date}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`);
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
const destination = join(outputRoot, 'sitemap.xml');
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, sitemap, 'utf8');
console.log(`Sitemap généré : ${pages.length} URL vers ${destination}`);
