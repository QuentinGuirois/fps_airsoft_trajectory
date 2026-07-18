import { serializeCurveThumbnail } from '../../assets/js/curve-thumbnail.js';

export const FIXTURE_SIMULATION_RESULT = Object.freeze({
  simulation: {
    points: [
      { x: 0, y: 1.5 }, { x: 10, y: 1.54 }, { x: 20, y: 1.61 },
      { x: 30, y: 1.58 }, { x: 40, y: 1.39 }, { x: 50, y: 1.02 },
      { x: 60, y: 0.36 }, { x: 64, y: 0 },
    ],
  },
  metrics: {
    usefulRangeM: 51,
    maximumRangeM: 64,
    sight: { originY: 1.55 },
  },
});

export const FIXTURE_CURVE_SVG = serializeCurveThumbnail(FIXTURE_SIMULATION_RESULT);

const user = Object.freeze({
  pseudo: 'OPÉRATEUR FIXTURE',
  chrony: true,
  youtubeUrl: 'https://www.youtube.com/@fixture',
});

const base = Object.freeze({
  type: 'AEG',
  massG: 0.28,
  energyJ: 1.42,
  usefulRangeM: 51,
  maximumRangeM: 64,
  curveThumbSvg: FIXTURE_CURVE_SVG,
  simUrl: '/?m=0.28&j=1.42&h=auto',
  user,
});

export const COMMUNITY_FIXTURE = Object.freeze({
  session: Object.freeze({ authenticated: true, csrfToken: 'fixture-csrf', user: { id: 'fixture-user', pseudo: 'OPÉRATEUR FIXTURE' } }),
  replicas: Object.freeze([
    { ...base, id: 'fixture-published', name: 'RÉPLIQUE PUBLIÉE', state: 'published', imageStatus: 'ready', photoUrl: '/tests/fixtures/replica-side.fixture.webp' },
    { ...base, id: 'fixture-draft', name: 'RÉPLIQUE BROUILLON', state: 'draft', imageStatus: 'queued', photoUrl: '' },
    { ...base, id: 'fixture-pending', name: 'RÉPLIQUE EN MODÉRATION', state: 'pending', imageStatus: 'processing', photoUrl: '' },
    { ...base, id: 'fixture-rejected', name: 'PHOTO REJETÉE', state: 'rejected', imageStatus: 'rejected', photoUrl: '' },
    { ...base, id: 'fixture-failed', name: 'DÉTOURAGE ÉCHOUÉ', state: 'draft', imageStatus: 'failed', photoUrl: '' },
    { ...base, id: 'fixture-archived', name: 'RÉPLIQUE ARCHIVÉE', state: 'archived', imageStatus: 'ready', photoUrl: '/tests/fixtures/replica-side.fixture.webp' },
  ]),
});
