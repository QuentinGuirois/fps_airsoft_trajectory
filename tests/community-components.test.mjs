import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HttpAccountRepository,
  HttpApiClient,
  HttpReplicaRepository,
  RepositoryError,
} from '../assets/js/community-repositories.js';
import { serializeCurveThumbnail } from '../assets/js/curve-thumbnail.js';
import {
  IMAGE_STATES,
  REPLICA_STATES,
  normalizeReplicaCardData,
  stateAfterReplicaUpdate,
} from '../assets/js/replica-card.js';
import { COMMUNITY_FIXTURE, FIXTURE_SIMULATION_RESULT } from './fixtures/community.fixture.mjs';
import { MockAccountRepository, MockReplicaRepository } from './helpers/mock-community-repositories.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('les repositories HTTP utilisent même origine, no-store, credentials et CSRF', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(url.endsWith('/me') && options.method === 'GET'
      ? { authenticated: true, csrfToken: 'csrf-123', user: { pseudo: 'Test' } }
      : { ok: true, replicas: [] });
  };
  const client = new HttpApiClient({ fetchImpl });
  const account = new HttpAccountRepository({ client });
  const replicas = new HttpReplicaRepository({ client });
  await account.getSession();
  await account.login({ identity: 'test@example.test', password: 'secret-long' });
  await replicas.list();
  await replicas.archive('replica/unsafe', 4);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.options.credentials, 'same-origin');
    assert.equal(call.options.cache, 'no-store');
  }
  assert.equal(calls[1].options.headers.get('X-CSRF-Token'), 'csrf-123');
  assert.match(calls[3].url, /replicas\/replica%2Funsafe$/);
  assert.equal(JSON.parse(calls[3].options.body).version, 4);
});

test('les erreurs API restent typées sans inventer de session', async () => {
  const client = new HttpApiClient({ fetchImpl: async () => jsonResponse({ code: 'unauthorized', message: 'Connexion requise.' }, 401) });
  await assert.rejects(() => new HttpAccountRepository({ client }).getSession(), (error) => (
    error instanceof RepositoryError && error.status === 401 && error.code === 'unauthorized'
  ));
});

test('le client lie fetch au contexte global requis par les navigateurs', async () => {
  let receiver;
  const fetchImpl = function fetchWithRequiredReceiver() {
    receiver = this;
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return jsonResponse({ turnstile: { enabled: true, siteKey: 'public-test' } });
  };
  const result = await new HttpAccountRepository({ client: new HttpApiClient({ fetchImpl }) }).getTurnstileConfig();
  assert.equal(receiver, globalThis);
  assert.equal(result.turnstile.enabled, true);
});

test('les mocks sont isolés dans tests et couvrent archivage et relance', async () => {
  const account = new MockAccountRepository(COMMUNITY_FIXTURE.session);
  const replicas = new MockReplicaRepository(COMMUNITY_FIXTURE.replicas);
  assert.equal((await account.getSession()).authenticated, true);
  assert.equal((await replicas.archive('fixture-published')).replica.state, 'archived');
  assert.equal((await replicas.retryBackgroundRemoval('fixture-failed')).replica.imageStatus, 'queued');
});

test('tous les états visuels existent et une modification sensible repasse published en pending', () => {
  assert.deepEqual(REPLICA_STATES, ['draft', 'pending', 'published', 'rejected', 'archived']);
  assert.deepEqual(IMAGE_STATES, ['queued', 'processing', 'ready', 'rejected', 'failed']);
  assert.equal(stateAfterReplicaUpdate('published', ['name']), 'published');
  for (const field of ['photoUrl', 'simUrl', 'massG', 'energyJ']) {
    assert.equal(stateAfterReplicaUpdate('published', [field]), 'pending');
  }
});

test('une card refuse blob, data, photo externe et raster non-WebP, mais conserve un WebP même origine', () => {
  const base = COMMUNITY_FIXTURE.replicas[0];
  for (const photoUrl of ['blob:https://fps-airsoft-trajectory.com/a', 'data:image/png;base64,AA', 'https://evil.test/a.webp', '/uploads/replica.png']) {
    assert.equal(normalizeReplicaCardData({ ...base, photoUrl }).photoUrl, '');
  }
  assert.equal(normalizeReplicaCardData(base).photoUrl, '/tests/fixtures/replica-side.fixture.webp');
});

test('la miniature sérialise les points Worker reçus sans importer le moteur', async () => {
  const svg = serializeCurveThumbnail(FIXTURE_SIMULATION_RESULT);
  assert.match(svg, /^<svg/);
  assert.match(svg, /curve-thumb-path/);
  assert.match(svg, />51 m</);
  assert.match(svg, />64 m</);
  const source = await read('assets', 'js', 'curve-thumbnail.js');
  assert.doesNotMatch(source, /physics-core|trajectory\.worker|simulateTrajectory|analyzeTrajectory/);
});

test('login, confirmations email et armurerie restent privés, sans faux OAuth, localStorage compte ou sitemap', async () => {
  const [login, emailConfirmation, accountActive, armory, sitemap, repositories, entry, loginApp] = await Promise.all([
    read('compte', 'index.html'),
    read('compte', 'verifier-email.html'),
    read('compte', 'compte-active.html'),
    read('compte', 'armurerie.html'),
    read('sitemap.xml'),
    read('assets', 'js', 'community-repositories.js'),
    read('assets', 'js', 'armory-entry.js'),
    read('assets', 'js', 'account-login.js'),
  ]);
  for (const html of [login, emailConfirmation, accountActive, armory]) {
    assert.match(html, /meta name="robots" content="noindex,nofollow,noarchive"/);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    assert.doesNotMatch(html, /fat\.account\.v1|blob-url/);
  }
  assert.match(login, /data-oauth-unavailable hidden/);
  assert.match(emailConfirmation, /Vérifie ton email/);
  assert.match(emailConfirmation, /Clique sur le lien de vérification/);
  assert.match(emailConfirmation, /href="\/compte\/"/);
  assert.match(loginApp, /redirect\('\/compte\/verifier-email\.html'\)/);
  assert.match(accountActive, /Ton compte est activé/);
  assert.match(accountActive, /ME CONNECTER/);
  assert.match(loginApp, /redirect\('\/compte\/compte-active\.html'\)/);
  assert.doesNotMatch(sitemap, /\/compte\//);
  assert.doesNotMatch(`${repositories}\n${entry}`, /localStorage|Mock|fixture/i);
});

test('l’archivage est réversible dans les textes et aucune suppression physique n’est proposée', async () => {
  const [html, app] = await Promise.all([read('compte', 'armurerie.html'), read('assets', 'js', 'armory.js')]);
  assert.match(html, /ARCHIVAGE RÉVERSIBLE/);
  assert.match(html, /restaurable/);
  assert.match(app, /replicaRepository\.archive/);
  assert.doesNotMatch(`${html}\n${app}`, /deleteReplica|suppression définitive|DELETE FROM/i);
});

test('le service worker cache seulement les shells et contourne toutes les réponses API privées', async () => {
  const worker = await read('service-worker.js');
  assert.match(worker, /const CACHE = 'fat-v3-2026-07-18-33'/);
  for (const path of ['/compte/', '/compte/verifier-email.html', '/compte/compte-active.html', '/compte/armurerie.html', '/assets/js/replica-card.js?v=20260718-28', '/assets/js/account-login.js?v=20260718-34', '/assets/js/account-login-entry.js?v=20260718-34', '/assets/js/community-repositories.js?v=20260718-33', '/assets/js/turnstile-client.js?v=20260718-30']) {
    assert.ok(worker.includes(`'${path}'`), path);
  }
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)[\s\S]*event\.respondWith\(fetch\(event\.request\)\);[\s\S]*return;/);
  assert.ok((await stat(join(root, 'tests', 'fixtures', 'replica-side.fixture.webp'))).size <= 102_400);
});
