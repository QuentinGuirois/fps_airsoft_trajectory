import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SimulationLinkError,
  createSimulationSnapshot,
  simulationShotFromUrl,
  simulationUrlsMatch,
} from '../assets/js/simulation-link-snapshot.js';
import { FIXTURE_SIMULATION_RESULT } from './fixtures/community.fixture.mjs';

const ORIGIN = 'https://fps-airsoft-trajectory.com';

class ResultWorker {
  constructor(result) {
    this.result = result;
    this.listeners = new Map();
    this.terminated = false;
    this.posted = null;
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  postMessage(message) {
    this.posted = message;
    queueMicrotask(() => this.listeners.get('message')?.({
      data: { ok: true, requestId: message.requestId, ...this.result },
    }));
  }
  terminate() { this.terminated = true; }
}

test('un lien F.A.T. complet provenant d’un autre onglet restitue tous les paramètres ATP', () => {
  const parsed = simulationShotFromUrl(
    `${ORIGIN}/?m=0.36&j=1.90&rpm=112500&z=42&w=13&wd=90&t=8&p=1002&a=-1.5&c=2&sh=1.4&oh=.06&lat=48&d=5.95#calculateur`,
    ORIGIN,
  );
  assert.deepEqual(parsed.shot, {
    massG: 0.36, energyJ: 1.9, initialRpm: 112500, zeroDistanceM: 42,
    windSpeedKmh: 13, windAngleDeg: 90, temperatureC: 8, pressureHpa: 1002,
    angleDeg: -1.5, cantDeg: 2, shootingHeightM: 1.4, scopeHeightM: 0.06,
    latitudeDeg: 48, diameterMm: 5.95,
  });
  assert.equal(new URL(parsed.url).hash, '');
});

test('l’ordre des paramètres et le fragment ne lient plus la card à un onglet précis', () => {
  assert.equal(simulationUrlsMatch(
    `${ORIGIN}/?m=0.36&j=1.90&rpm=112500#calculateur`,
    `${ORIGIN}/?rpm=112500&j=1.90&m=0.36`,
    ORIGIN,
  ), true);
  assert.equal(simulationUrlsMatch(`${ORIGIN}/?m=0.36&j=1.90`, `${ORIGIN}/?m=0.32&j=1.90`, ORIGIN), false);
});

test('la miniature est produite depuis le Worker ATP partagé au moment de l’enregistrement', async () => {
  let worker;
  const snapshot = await createSimulationSnapshot(`${ORIGIN}/?m=0.28&j=1.42&rpm=90000`, {
    origin: ORIGIN,
    workerFactory: () => (worker = new ResultWorker({
      ...FIXTURE_SIMULATION_RESULT,
      simulation: {
        ...FIXTURE_SIMULATION_RESULT.simulation,
        config: { massG: 0.28, energyJ: 1.42 },
      },
    })),
  });
  assert.equal(worker.posted.type, 'simulate');
  assert.deepEqual(worker.posted.shot, { massG: 0.28, energyJ: 1.42, initialRpm: 90000 });
  assert.equal(worker.terminated, true);
  assert.match(snapshot.curveThumbnailSvg, /^<svg/);
  assert.equal(snapshot.massG, 0.28);
  assert.equal(snapshot.energyJ, 1.42);
  assert.equal(snapshot.usefulRangeM, 51);
});

test('un lien externe ou incomplet reste refusé avant tout calcul', () => {
  assert.throws(() => simulationShotFromUrl('https://example.test/?m=0.28&j=1.2', ORIGIN), SimulationLinkError);
  assert.throws(() => simulationShotFromUrl(`${ORIGIN}/?m=0.28`, ORIGIN), SimulationLinkError);
});
