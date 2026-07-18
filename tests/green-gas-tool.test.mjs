import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isUsableGasData,
  packagingOptionLabel,
  pointForTemperature,
  productsForBrand,
  psiToBar,
  resolveSelection,
  resultForSelection,
} from '../gas-pressure-tool.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await readFile(join(root, 'data', 'green-gas-pressure-curves.json'), 'utf8'));

test('le jeu green gas est valide et ses identifiants sont uniques', () => {
  assert.equal(isUsableGasData(data), true);
  assert.equal(isUsableGasData({ products: [], brands: [], sources: [] }), false);
  assert.equal(data.schemaVersion, '2.0.0');
  assert.equal(data.products.length, 49);
  assert.equal(data.brands.length, 10);
  assert.equal(data.scope.uniquePressureCurveCount, 35);
  assert.equal(new Set(data.products.map(({ id }) => id)).size, data.products.length);
  assert.equal(new Set(data.sources.map(({ id }) => id)).size, data.sources.length);
  assert.ok(data.excludedCandidates.length > 0);
});

test('chaque produit fournit 56 températures entières de −15 à 40 °C par pas exact de 1 °C', () => {
  for (const product of data.products) {
    assert.equal(product.curve.length, 56, product.id);
    assert.deepEqual(
      product.curve.map(({ temperatureC }) => temperatureC),
      Array.from({ length: 56 }, (_, index) => index - 15),
      product.id,
    );
  }
});

test('chaque ancre fabricant ou distributeur reste présente dans la courbe applicative', () => {
  for (const product of data.products) {
    const point = pointForTemperature(product, product.referenceTemperatureC);
    assert.ok(point, product.id);
    assert.ok(Math.abs(point.estimatedPsi - product.referencePsi) < 0.011, product.id);
  }
});

test('les 18 points de mesure ASG sont conservés exactement', () => {
  const asgProducts = productsForBrand(data, 'ASG Ultrair');
  assert.equal(asgProducts.length, 4);
  const uniqueAsgCurves = [...new Map(asgProducts.map((product) => [product.curveGroupId, product])).values()];
  assert.equal(uniqueAsgCurves.length, 3);
  assert.equal(uniqueAsgCurves.reduce((sum, product) => sum + product.measuredPoints.length, 0), 18);
  for (const product of asgProducts) {
    for (const measured of product.measuredPoints) {
      const point = pointForTemperature(product, measured.temperatureC);
      assert.equal(point.estimatedPsi, measured.psi, `${product.id} à ${measured.temperatureC} °C`);
      assert.equal(point.pointStatus, 'manufacturer_test_point');
    }
  }
});

test('les variantes d’un même curveGroupId partagent exactement la même courbe', () => {
  for (const curveGroupId of new Set(data.products.map((product) => product.curveGroupId))) {
    const products = data.products.filter((product) => product.curveGroupId === curveGroupId);
    const reference = products[0].curve.map(({ estimatedPsi }) => estimatedPsi);
    for (const product of products.slice(1)) {
      assert.deepEqual(product.curve.map(({ estimatedPsi }) => estimatedPsi), reference, curveGroupId);
    }
  }
});

test('les variantes métier V2 restent distinctes sans créer de fausses courbes', () => {
  const asg135 = data.products.filter(({ curveGroupId }) => curveGroupId === 'asg-ultrair-135');
  assert.equal(asg135.length, 2);
  assert.deepEqual(new Set(asg135.map(({ silicone }) => silicone)), new Set(['yes', 'no']));

  assert.equal(productsForBrand(data, 'ATM / Ama Tsu Maru').length, 11);
  assert.equal(productsForBrand(data, 'NUPROL').length, 7);
  assert.equal(productsForBrand(data, 'Puff Dino').length, 6);
  assert.equal(data.products.find(({ id }) => id === 'nuprol-premium-2-145').packagingOptions.length, 2);
  assert.equal(data.products.find(({ id }) => id === 'protechguns-green-gas').packagingOptions.length, 4);
  assert.equal(data.products.find(({ id }) => id === 'puff-dino-12kg-silicone').packagingOptions.length, 2);
});

test('toutes les courbes sont monotones croissantes', () => {
  for (const product of data.products) {
    for (let index = 1; index < product.curve.length; index += 1) {
      assert.ok(product.curve[index].estimatedPsi >= product.curve[index - 1].estimatedPsi, `${product.id} index ${index}`);
    }
  }
});

test('la conversion PSI vers bar utilise la constante imposée', () => {
  assert.equal(psiToBar(14.5037738), 1);
  assert.ok(Math.abs(psiToBar(145) - 9.997398056497545) < 1e-12);
});

test('le filtrage marque vers modèles ne retourne que les produits publiables de la marque', () => {
  const nimrod = productsForBrand(data, 'Nimrod Tactical');
  assert.equal(nimrod.length, 4);
  assert.ok(nimrod.every(({ brand }) => brand === 'Nimrod Tactical'));
  assert.deepEqual(
    productsForBrand(data, 'NUPROL').map(({ model }) => model),
    productsForBrand(data, 'NUPROL').map(({ model }) => model).toSorted((first, second) => first.localeCompare(second, 'fr')),
  );
  assert.deepEqual(
    data.brands.map(({ brand }) => brand),
    data.brands.map(({ brand }) => brand).toSorted((first, second) => first.localeCompare(second, 'fr')),
  );
});

test('le conditionnement change le libellé mais jamais la pression', () => {
  const base = { temperatureC: 12, brand: 'NUPROL', gas: 'nuprol-premium-2-145' };
  const full = resultForSelection(data, { ...base, packageIndex: 0 });
  const mini = resultForSelection(data, { ...base, packageIndex: 1 });
  assert.equal(full.estimatedPsi, mini.estimatedPsi);
  assert.notEqual(packagingOptionLabel(full.packagingOption), packagingOptionLabel(mini.packagingOption));
  assert.match(packagingOptionLabel(mini.packagingOption), /2\.MINI/);
});

test('aucune référence en quarantaine ne rejoint les produits sélectionnables', () => {
  assert.ok(!data.products.some(({ model }) => /Vertex|Maintenance Gas/i.test(model)));
  assert.ok(!data.products.some(({ brand }) => ['VORSK', 'Novritsch', 'Elite Force / Umarex'].includes(brand)));
  assert.ok(data.excludedCandidates.some(({ models }) => models.includes('Predator Vertex')));
  assert.ok(data.excludedCandidates.some(({ models }) => models.includes('Maintenance Gas')));
});

test('les paramètres URL restaurent la température, la marque et le gaz avant localStorage', () => {
  const restored = resolveSelection(
    data,
    '?t=12&brand=NUPROL&gas=nuprol-3zero-175&pack=0',
    { t: 30, brand: 'Abbey', gas: 'abbey-predator-ultra', pack: 1 },
  );
  assert.deepEqual(restored, {
    temperatureC: 12,
    brand: 'NUPROL',
    gas: 'nuprol-3zero-175',
    packageIndex: 0,
  });
});

test('les sélections locales servent de repli quand l’URL est vide', () => {
  const restored = resolveSelection(data, '', { t: 7, brand: 'Abbey', gas: 'abbey-predator-ultra', pack: 1 });
  assert.deepEqual(restored, { temperatureC: 7, brand: 'Abbey', gas: 'abbey-predator-ultra', packageIndex: 1 });
});

test('les anciennes URL Puff Dino sont migrées vers les identifiants V2', () => {
  assert.deepEqual(
    resolveSelection(data, '?t=20&brand=Puff%20Dino&gas=puff-dino-12kg-171', {}),
    { temperatureC: 20, brand: 'Puff Dino', gas: 'puff-dino-12kg-silicone', packageIndex: 0 },
  );
});

test('la page gaz expose son SEO, ses données structurées et son interface accessible', async () => {
  const html = await readFile(join(root, 'outils', 'choisir-gaz-airsoft-pression-temperature', 'index.html'), 'utf8');
  assert.match(html, /<h1[^>]*>[^<]*quel gaz airsoft choisir selon la température/i);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="description"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/fps-airsoft-trajectory\.com\/outils\/choisir-gaz-airsoft-pression-temperature\/">/);
  assert.match(html, /"@type":"SoftwareApplication"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /id="gas-temperature"[^>]*step="1"/);
  assert.match(html, /id="gas-temperature-range"[^>]*step="1"/);
  assert.match(html, /id="gas-package"/);
  assert.match(html, /id="gas-silicone-badge"/);
  assert.match(html, /id="gas-result-confidence"/);
  assert.match(html, /49 références/);
  const structuredData = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(structuredData['@graph'].find(({ '@type': type }) => type === 'FAQPage').mainEntity.length, 8);
});

test('le service worker met en cache l’outil et sa donnée pour le mode hors ligne', async () => {
  const worker = await readFile(join(root, 'service-worker.js'), 'utf8');
  assert.match(worker, /\/outils\/choisir-gaz-airsoft-pression-temperature\//);
  assert.match(worker, /\/data\/green-gas-pressure-curves\.json/);
  assert.match(worker, /\/gas-pressure-tool\.js/);
  assert.match(worker, /\/gas-pressure-app\.js/);
  assert.match(worker, /caches\.match\(url\.pathname\)/);
});

test('la mise en page mobile contient les tableaux sans élargir la grille à 320 px', async () => {
  const css = await readFile(join(root, 'assets', 'site.css'), 'utf8');
  assert.match(css, /\.prose \{[^}]*min-width: 0/);
  assert.match(css, /\.content-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.gas-compare-result \{[^}]*overflow-x: auto/);
});
