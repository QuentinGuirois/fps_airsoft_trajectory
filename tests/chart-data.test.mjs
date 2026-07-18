import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATP_TOLERANCE_M,
  buildChartValues,
  buildTrajectoryGuides,
  buildTrajectoryMarkers,
  chartYDomain,
  fitChartDomain,
  prepareChartSeries,
} from '../chart-data.js';
import { pointAtDistance, simulateTrajectory } from '../physics-core.js';

test('la vue trajectoire affiche une hauteur au-dessus du sol sans domaine négatif', () => {
  const simulation = simulateTrajectory();
  const series = buildChartValues(simulation, 'trajectory');
  const domain = chartYDomain([series]);

  assert.equal(series.unit, 'm');
  assert.ok(series.values.every((point) => point.y >= 0));
  assert.equal(domain.minY, 0);
  assert.ok(domain.maxY > Math.max(...series.values.map((point) => point.y)));
});

test('la vue écart visée conserve les valeurs signées utiles au zérotage', () => {
  const simulation = simulateTrajectory({ zeroDistanceM: 35, hopPercent: 0 });
  const series = buildChartValues(simulation, 'sight');
  const muzzle = series.values[0];
  const zeroPoint = pointAtDistance(series.values, 35);

  assert.equal(series.unit, 'cm');
  assert.ok(muzzle.y < 0, 'la bouche est sous la ligne de visée à cause de la hauteur d’optique');
  assert.ok(zeroPoint);
  assert.ok(Math.abs(zeroPoint.y) < 2, 'la trajectoire doit croiser la visée près du zéro demandé');
});

test('les vues énergie et rotation sont cadrées à partir de zéro', () => {
  const simulation = simulateTrajectory();
  for (const mode of ['energy', 'spin']) {
    const series = buildChartValues(simulation, mode);
    assert.equal(chartYDomain([series]).minY, 0);
  }
});

test('la préparation des séries distingue le tir actif et trois comparaisons', () => {
  const simulation = simulateTrajectory();
  const current = { simulation, metrics: { usefulRangeM: 42 }, label: 'Actuel' };
  const comparisons = ['B', 'C', 'D'].map((label) => ({ simulation, label }));
  const prepared = prepareChartSeries(current, comparisons, 'trajectory');

  assert.equal(prepared.series.length, 4);
  assert.deepEqual(prepared.series.map((series) => series.role), ['active', 'comparison', 'comparison', 'comparison']);
  assert.deepEqual(prepared.series.map((series) => series.lineWidth), [3.5, 2, 2, 2]);
  assert.deepEqual(prepared.series.map((series) => series.lineDash), [[], [10, 5], [10, 5], [10, 5]]);
  assert.deepEqual(prepared.series.map((series) => series.colorIndex), [0, 1, 2, 3]);
});

test('les guides et marqueurs de trajectoire suivent la visée et les points ATP', () => {
  const simulation = simulateTrajectory({ zeroDistanceM: 35 });
  const usefulDistance = simulation.points[Math.floor(simulation.points.length / 2)].x;
  const metrics = { usefulRangeM: usefulDistance };
  const guides = buildTrajectoryGuides(simulation);
  const markers = buildTrajectoryMarkers(simulation, metrics);

  assert.equal(guides.sightline.length, simulation.points.length);
  assert.ok(guides.upper.every((point, index) => Math.abs(point.y - guides.lower[index].y - 2 * ATP_TOLERANCE_M) < 1e-12));
  assert.equal(markers.useful.x, usefulDistance);
  assert.ok(markers.apex.y >= simulation.points[0].y);
  assert.deepEqual({ x: markers.impact.x, y: markers.impact.y }, {
    x: simulation.points.at(-1).x,
    y: simulation.points.at(-1).y,
  });
});

test('l’enveloppe ATP et ses marqueurs restent exclus des autres onglets', () => {
  const simulation = simulateTrajectory();
  for (const mode of ['sight', 'energy', 'drift', 'spin']) {
    const prepared = prepareChartSeries({ simulation, metrics: {} }, [], mode);
    assert.equal(prepared.trajectory, null, `aucun guide de trajectoire dans l’onglet ${mode}`);
  }
});

test('le cadrage annonce le facteur vertical réellement dessiné et ne dépasse jamais ×10', () => {
  const simulation = simulateTrajectory();
  const prepared = prepareChartSeries({ simulation, metrics: {} }, [], 'trajectory');
  const maxX = Math.max(...prepared.series[0].values.map((point) => point.x));
  const viewport = fitChartDomain({
    series: prepared.series,
    trajectory: prepared.trajectory,
    maxX,
    plotWidth: 900,
    plotHeight: 200,
  });
  const actual = (200 / (viewport.maxY - viewport.minY)) / (900 / maxX);

  assert.ok(viewport.verticalExaggeration > 0);
  assert.ok(viewport.verticalExaggeration <= 10);
  assert.ok(Math.abs(viewport.verticalExaggeration - actual) < 1e-12);
});
