import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATP,
  airDensity,
  analyzeTrajectory,
  dragForceMagnitude,
  dragCoefficient,
  energyFromVelocity,
  findFlatSpin,
  fpsToMps,
  gravityAtLatitude,
  liftCoefficient,
  magnusForceMagnitude,
  normalizeShot,
  plottedSpinRatioDerivative,
  pointAtDistance,
  publishedLiftCoefficient,
  publishedRotationalTorque,
  sightModel,
  simulateTrajectory,
} from '../physics-core.js';

test('conversion 0,20 g à 100 m/s = 1 joule', () => {
  assert.ok(Math.abs(energyFromVelocity(0.0002, 100) - 1) < 1e-12);
  assert.ok(Math.abs(fpsToMps(328.0839895) - 100) < 1e-6);
});

test('atmosphère standard tempérée cohérente', () => {
  assert.ok(Math.abs(airDensity(20, 1013.25) - 1.204) < 0.01);
  assert.ok(gravityAtLatitude(47) > 9.8 && gravityAtLatitude(47) < 9.82);
  assert.ok(Math.abs(gravityAtLatitude(45) - 9.80555707645438) < 1e-12);
});

test('la normalisation conserve un diamètre personnalisé', () => {
  const shot = normalizeShot({ diameterMm: 5.95 });
  assert.ok(Math.abs(shot.diameterMm - 5.95) < 1e-12);
  assert.ok(Math.abs(shot.diameterM - 0.00595) < 1e-12);
});

test('la formule Cl imprimée reste disponible sans bornage artificiel', () => {
  assert.equal(publishedLiftCoefficient(0), 0);
  assert.ok(publishedLiftCoefficient(0.2) < 0, 'le Reverse Magnus doit être conservé');
  assert.ok(publishedLiftCoefficient(0.38) < 0, 'la formule imprimée reste négative sous sa racine');
  assert.ok(publishedLiftCoefficient(0.39) > 0, 'la formule imprimée devient positive au-dessus de sa racine');
  assert.ok(Math.abs(publishedLiftCoefficient(ATP.publishedReverseMagnusLimit)) < 1e-9);
  assert.notEqual(publishedLiftCoefficient(0.8), publishedLiftCoefficient(0.6));
  const cd = dragCoefficient(0.41, 40000);
  assert.ok(cd > 0.35 && cd < 0.6);
  assert.notEqual(dragCoefficient(0.8, 40000), dragCoefficient(0.6, 40000));
});

test('la courbe Cl utilisée reproduit les points de la figure ATP III-A-04', () => {
  assert.equal(liftCoefficient(0), 0);
  assert.ok(liftCoefficient(0.2) < 0);
  assert.ok(Math.abs(liftCoefficient(ATP.reverseMagnusLimit)) < 1e-9);
  assert.ok(Math.abs(liftCoefficient(0.39237) - 0.01230) < 0.001);
  assert.ok(Math.abs(liftCoefficient(0.41064) - 0.02706) < 0.001);
  assert.ok(Math.abs(liftCoefficient(0.41904) - 0.03347) < 0.001);
});

test('la relation de couple textuelle reste auditable mais la loi tracée ne crée pas de spin', () => {
  assert.ok(publishedRotationalTorque(10000, 0.003, 1.225) > 0);
  assert.equal(plottedSpinRatioDerivative(0), 0);
  assert.ok(plottedSpinRatioDerivative(0.2) > 0);
  assert.ok(plottedSpinRatioDerivative(0.5) < 0);
});

test('la force Magnus ATP ne reçoit pas le facteur 1/2 de la traînée', () => {
  assert.equal(dragForceMagnitude(1, 1, 1, 2), 2);
  assert.equal(magnusForceMagnitude(1, 1, 1, 2), 4);
});

test('une trajectoire par défaut se termine au sol avec des valeurs finies', () => {
  const simulation = simulateTrajectory();
  const last = simulation.points.at(-1);
  const metrics = analyzeTrajectory(simulation);
  assert.equal(last.y, 0);
  assert.ok(simulation.points.every((point) => point.y >= 0), 'aucun échantillon ne doit passer sous le sol');
  assert.ok(last.x > 20 && last.x < 120);
  assert.ok(metrics.usefulRangeM > 0);
  assert.ok(simulation.points.every((point) => Object.values(point).every(Number.isFinite)));
});

test('la portée utile tolère une hauteur de buste complète de 60 cm autour de la visée', () => {
  assert.equal(ATP.usefulTargetHeightM, 0.6);
  assert.equal(ATP.usefulEnvelopeM, ATP.usefulTargetHeightM);
  assert.equal(ATP.flatSpinEnvelopeM, 0.1524);

  const simulation = simulateTrajectory();
  const sight = sightModel(simulation);
  const metrics = analyzeTrajectory(simulation);
  let expectedRangeM = 0;
  let outside = false;
  for (const point of simulation.points) {
    const insideTarget = Math.abs(point.y - sight.yAt(point.x)) <= 0.6;
    if (!outside && insideTarget) expectedRangeM = point.x;
    else if (point.x > 1) outside = true;
  }
  assert.equal(metrics.usefulRangeM, expectedRangeM);
});

test('le cas étalon ATP 0,20 g, 0,98 J et 120 000 RPM suit les figures III-A-02 à 04', () => {
  const simulation = simulateTrajectory({
    massG: 0.2,
    velocityMps: 100,
    initialRpm: 120000,
    shootingHeightM: 3,
    angleDeg: 0,
    temperatureC: 15,
  });
  const atOneSecond = simulation.points.reduce((nearest, point) => (
    Math.abs(point.time - 1) < Math.abs(nearest.time - 1) ? point : nearest
  ));
  assert.ok(Math.abs(atOneSecond.time - 1) < 0.003);
  assert.ok(atOneSecond.speedMps > 20 && atOneSecond.speedMps < 25);
  assert.ok(atOneSecond.rpm > 27000 && atOneSecond.rpm < 32000);
  assert.ok(atOneSecond.spinRatio > 0.415 && atOneSecond.spinRatio < 0.425);
  assert.ok(atOneSecond.cl > 0.03 && atOneSecond.cl < 0.04);
});

test('les RPM saisis sont directs et les anciens pourcentages restent lisibles', () => {
  const direct = normalizeShot({ initialRpm: 123456 });
  const legacy = normalizeShot({ massG: 0.36, velocityMps: fpsToMps(337), hopPercent: 59 });
  assert.equal(direct.initialRpm, 123456);
  assert.ok(Math.abs(legacy.initialRpm - 79091.6906799095) < 1e-6);
});

test('deux spins proches ne provoquent plus de bascule Magnus brutale', () => {
  const lower = analyzeTrajectory(simulateTrajectory({
    massG: 0.36, velocityMps: fpsToMps(337), hopPercent: 55, angleDeg: 3,
  }));
  const higher = analyzeTrajectory(simulateTrajectory({
    massG: 0.36, velocityMps: fpsToMps(337), hopPercent: 59, angleDeg: 3,
  }));
  assert.ok(Math.abs(higher.maximumRangeM - lower.maximumRangeM) < 3);
  assert.ok(Math.abs(higher.apexHeightM - lower.apexHeightM) < 0.1);
});

test('le réglage automatique trouve un tir tendu et s’aligne sur le pas de 250 RPM', () => {
  const input = { massG: 0.36, velocityMps: fpsToMps(337) };
  const recommendation = findFlatSpin(input, { incrementRpm: 250 });
  assert.equal(recommendation.initialRpm % 250, 0);
  assert.ok(recommendation.initialRpm > 120000 && recommendation.initialRpm < 135000);
  assert.ok(recommendation.flatRangeM > 45);

  const nearby = [-250, 0, 250].map((offset) => simulateTrajectory({
    ...input,
    initialRpm: recommendation.initialRpm + offset,
    angleDeg: 0,
  }));
  assert.ok(nearby.every((simulation) => analyzeTrajectory(simulation).apexHeightM < 1.8));
});

test('aucun réglage représentatif ne produit une hauteur sous le sol', () => {
  const shots = [
    { hopPercent: 0 },
    { hopPercent: 130 },
    { angleDeg: -10, hopPercent: 130 },
    { windSpeedKmh: 100, windAngleDeg: 180, hopPercent: 130 },
  ];
  for (const shot of shots) {
    const simulation = simulateTrajectory(shot);
    assert.ok(simulation.points.every((point) => point.y >= 0), JSON.stringify(shot));
  }
});

test('le zéro optique place la visée sur la trajectoire sans modifier le canon', () => {
  const simulation = simulateTrajectory({ angleDeg: 0, zeroDistanceM: 35, hopPercent: 0 });
  const point = pointAtDistance(simulation.points, 35);
  const sight = sightModel(simulation);
  assert.equal(simulation.config.angleDeg, 0);
  assert.equal(sight.zeroResolved, true);
  assert.ok(point);
  assert.ok(Math.abs(point.y - sight.yAt(35)) < 0.02);
});

test('changer le zéro optique ne modifie aucun point de la trajectoire', () => {
  const nearZero = simulateTrajectory({ angleDeg: 0, zeroDistanceM: 20 });
  const farZero = simulateTrajectory({ angleDeg: 0, zeroDistanceM: 50 });
  assert.deepEqual(nearZero.points, farZero.points);
});

test('l’angle du canon est appliqué directement et reste sous le contrôle utilisateur', () => {
  const horizontal = simulateTrajectory({ angleDeg: 0, hopPercent: 0 });
  const elevated = simulateTrajectory({ angleDeg: 5, hopPercent: 0 });
  assert.equal(horizontal.config.angleDeg, 0);
  assert.equal(elevated.config.angleDeg, 5);
  assert.ok(analyzeTrajectory(elevated).apexHeightM > analyzeTrajectory(horizontal).apexHeightM);
});

test('un vent venant de droite produit une dérive latérale', () => {
  const calm = simulateTrajectory({ windSpeedKmh: 0, hopPercent: 0 });
  const windy = simulateTrajectory({ windSpeedKmh: 15, windAngleDeg: 90, hopPercent: 0 });
  const calm30 = pointAtDistance(calm.points, 30);
  const windy30 = pointAtDistance(windy.points, 30);
  assert.ok(Math.abs(calm30.z) < 1e-8);
  assert.ok(Math.abs(windy30.z) > 0.05);
});

test('à énergie égale et sans spin, une bille plus lourde conserve mieux son énergie à 30 m', () => {
  const light = pointAtDistance(simulateTrajectory({ massG: 0.2, energyJ: 1.5, hopPercent: 0 }).points, 30);
  const heavy = pointAtDistance(simulateTrajectory({ massG: 0.32, energyJ: 1.5, hopPercent: 0 }).points, 30);
  assert.ok(light && heavy);
  assert.ok(heavy.energyJ > light.energyJ);
});

test('la solution varie peu lorsque le pas est divisé par deux', () => {
  const normal = analyzeTrajectory(simulateTrajectory({ dt: 0.001 }));
  const fine = analyzeTrajectory(simulateTrajectory({ dt: 0.0005 }));
  assert.ok(Math.abs(normal.maximumRangeM - fine.maximumRangeM) < 0.25);
});
