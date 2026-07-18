import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, 'green-gas-pressure-curves.json'), 'utf8'));

assert.equal(data.temperatureGrid.stepC, 1);
assert.equal(data.scope.publishableProductCount, data.products.length);
assert.equal(data.products.length, 49);
assert.equal(data.brands.length, 10);
assert.equal(data.scope.uniquePressureCurveCount, 35);
assert.equal(new Set(data.products.map((product) => product.id)).size, data.products.length);

for (const product of data.products) {
  assert.equal(product.curve.length, 56, `${product.id}: 56 températures attendues`);
  assert.equal(product.curve[0].temperatureC, -15);
  assert.equal(product.curve.at(-1).temperatureC, 40);
  for (let index = 1; index < product.curve.length; index += 1) {
    assert.equal(product.curve[index].temperatureC - product.curve[index - 1].temperatureC, 1);
    assert.ok(product.curve[index].estimatedPsi >= product.curve[index - 1].estimatedPsi, `${product.id}: courbe non monotone`);
  }
  const anchor = product.curve.find((point) => point.temperatureC === product.referenceTemperatureC);
  assert.ok(anchor, `${product.id}: ancre absente`);
  assert.ok(Math.abs(anchor.estimatedPsi - product.referencePsi) < 0.011, `${product.id}: ancre altérée`);
  assert.ok(product.sourceIds.every((sourceId) => data.sources.some((source) => source.id === sourceId)), `${product.id}: source manquante`);
  assert.ok(product.curveGroupId, `${product.id}: groupe de courbe absent`);
  assert.ok(Array.isArray(product.packagingOptions) && product.packagingOptions.length > 0, `${product.id}: conditionnement absent`);
}

for (const curveGroupId of new Set(data.products.map((product) => product.curveGroupId))) {
  const group = data.products.filter((product) => product.curveGroupId === curveGroupId);
  const referenceCurve = group[0].curve.map((point) => point.estimatedPsi);
  for (const product of group.slice(1)) {
    assert.deepEqual(product.curve.map((point) => point.estimatedPsi), referenceCurve, `${curveGroupId}: variantes à courbes divergentes`);
  }
}

assert.ok(!data.products.some((product) => product.model.includes('Vertex')));
assert.ok(data.excludedCandidates.some((candidate) => candidate.models.includes('Predator Vertex')));

for (const product of data.products.filter((item) => item.brand === 'ASG Ultrair')) {
  for (const measured of product.measuredPoints) {
    const generated = product.curve.find((point) => point.temperatureC === measured.temperatureC);
    assert.equal(generated.estimatedPsi, measured.psi, `${product.id}: point ASG altéré`);
    assert.equal(generated.pointStatus, 'manufacturer_test_point');
  }
}

console.log(`OK — ${data.products.length} produits, ${data.brands.length} marques, ${data.products.length * 56} points validés.`);
