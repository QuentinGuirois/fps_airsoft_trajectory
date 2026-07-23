import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const PHP = process.env.FAT_TEST_PHP || (process.platform === 'win32' ? 'C:\\tools\\php\\php.exe' : 'php');
const ORIGIN = 'http://127.0.0.1:8092';
const VERIFY_ORIGIN = 'http://127.0.0.1:8093';
const env = {
  ...process.env,
  APP_ENV: 'local',
  APP_ORIGIN: ORIGIN,
  APP_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  DB_DSN: process.env.FAT_TEST_DB_DSN || 'mysql:host=127.0.0.1;port=3308;dbname=fat_test;charset=utf8mb4',
  DB_USER: process.env.FAT_TEST_DB_USER || 'fat_test',
  DB_PASSWORD: process.env.FAT_TEST_DB_PASSWORD || 'fat_local_test_only',
  STORAGE_ROOT: 'storage',
  TRUSTED_HOST: '127.0.0.1:8092',
  MAIL_MODE: 'log',
  FEATURE_COMMUNITY: 'false',
  TURNSTILE_ENABLED: 'true',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_EXPECTED_HOSTNAME: '127.0.0.1',
  TURNSTILE_SITEVERIFY_URL: `${VERIFY_ORIGIN}/siteverify`,
  RADAR_GEOCODER_URL: `${VERIFY_ORIGIN}/geocode`,
};

function command(executable, args) {
  const result = spawnSync(executable, args, { cwd: ROOT, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

command(PHP, ['bin/reset-local-database.php', '--yes']);
const identities = JSON.parse(command(PHP, ['tests/radar-api-fixture.php']));

let tokenSequence = 0;
const token = (action) => `radar-test-${action}-${++tokenSequence}`;
const usedTokens = new Set();
let geocodeCalls = 0;
const helperServer = http.createServer((request, response) => {
  if (request.url?.startsWith('/geocode')) {
    geocodeCalls += 1;
    const query = new URL(request.url, VERIFY_ORIGIN).searchParams.get('q') || '';
    if (query.includes('limite ign')) {
      response.writeHead(429, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'quota local de recette' }));
      return;
    }
    if (query.includes('service indisponible')) {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'indisponible en recette' }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0.68484, 47.394144] },
        properties: {
          label: 'Place Jean Jaurès 37000 Tours',
          city: 'Tours',
          postcode: '37000',
          depcode: '37',
          context: '37, Indre-et-Loire, Centre-Val de Loire',
        },
      }],
    }));
    return;
  }
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => {
    const responseToken = new URLSearchParams(raw).get('response') || '';
    const action = ['radar_publish', 'radar_cancel', 'radar_delete', 'radar_report']
      .find((candidate) => responseToken.startsWith(`radar-test-${candidate}-`)) || '';
    const duplicate = usedTokens.has(responseToken);
    usedTokens.add(responseToken);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(!action || duplicate
      ? { success: false }
      : { success: true, hostname: '127.0.0.1', action, challenge_ts: new Date().toISOString() }));
  });
});

await new Promise((resolve, reject) => {
  helperServer.once('error', reject);
  helperServer.listen(8093, '127.0.0.1', resolve);
});
const server = spawn(PHP, ['-S', '127.0.0.1:8092', 'tests/api-router.php'], {
  cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
server.stderr.on('data', (chunk) => { stderr += chunk; });

async function waitForServer() {
  for (let index = 0; index < 50; index += 1) {
    try {
      if ((await fetch(`${ORIGIN}/api/v1/health`)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Serveur Radar indisponible : ${stderr}`);
}

async function api(path, {
  method = 'GET', body, identity, expected = 200, publicCache = false,
} = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method)) headers.Origin = ORIGIN;
  if (identity) headers.Cookie = identity.cookie;
  if (identity && !['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = identity.csrf;
  const response = await fetch(`${ORIGIN}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  assert.match(response.headers.get('cache-control') || '', publicCache ? /public/ : /no-store/);
  return payload;
}

try {
  await waitForServer();
  const empty = await api('/radar/events', { publicCache: true });
  assert.deepEqual(empty.events, []);

  const created = await api('/me/radar-events', {
    method: 'POST', body: {}, identity: identities.owner, expected: 201,
  });
  assert.equal(created.event.state, 'draft');
  assert.equal(created.event.rules.length, 7);
  const eventId = created.event.id;
  await api(`/me/radar-events/${eventId}`, { identity: identities.intruder, expected: 404 });
  await api(`/me/radar-events/${eventId}`, {
    method: 'PATCH',
    body: { version: created.event.version, title: 'CSRF refusé' },
    identity: { ...identities.owner, csrf: '' },
    expected: 403,
  });

  const start = new Date(Date.now() + 14 * 86400_000);
  const end = new Date(start.getTime() + 8 * 3600_000);
  const localInput = (date) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replace(' ', 'T');
  const rules = ['assault', 'dmr', 'sniper', 'cqb', 'detonating_grenades', 'co2_grenades', 'smoke_grenades']
    .map((type, index) => ({
      type,
      state: ['allowed', 'specific', 'forbidden', 'not_communicated'][index % 4],
      joules: index < 4 ? 1.2 + index * .3 : null,
      details: index === 1 ? 'Distance minimale de 20 m.' : null,
    }));
  await api(`/me/radar-events/${eventId}`, {
    method: 'PATCH',
    identity: identities.owner,
    expected: 422,
    body: {
      version: created.event.version,
      startLocal: localInput(start),
      endLocal: localInput(new Date(start.getTime() - 3600_000)),
    },
  });
  await api(`/me/radar-events/${eventId}`, {
    method: 'PATCH',
    identity: identities.owner,
    expected: 422,
    body: {
      version: created.event.version,
      rules: [{ type: 'assault', state: 'allowed', joules: 11 }],
    },
  });
  const patched = await api(`/me/radar-events/${eventId}`, {
    method: 'PATCH',
    identity: identities.owner,
    body: {
      version: created.event.version,
      title: 'Opération Tours API',
      venueName: 'Terrain des Rives',
      description: 'Partie de recette intégration avec toutes les informations obligatoires.',
      startLocal: localInput(start),
      endLocal: localInput(end),
      scenario: 'Contrôle de zone',
      level: 'Tous niveaux',
      beginnersWelcome: true,
      maxCapacity: 80,
      priceCents: 2500,
      minimumAge: 16,
      rentalDetails: 'AEG sur réservation',
      cateringDetails: 'Repas tiré du sac',
      toiletsAvailable: false,
      latitude: 47.394144,
      longitude: 0.68484,
      locationMethod: 'geocoded',
      locationConfirmed: true,
      locationVisibility: 'exact',
      exactAddress: 'Adresse privée de recette, Tours',
      publicLocationLabel: 'Terrain des Rives',
      city: 'Tours',
      postalCode: '37000',
      departmentCode: '37',
      department: 'Indre-et-Loire',
      region: 'Centre-Val de Loire',
      registrationUrl: 'https://example.org/inscription',
      contactEmail: 'organisateur@example.test',
      rules,
      links: [{ type: 'website', url: 'https://example.org' }],
    },
  });
  assert.equal(patched.event.locationConfirmed, true);
  assert.equal(patched.event.contactEmailConfigured, true);
  const exported = await api('/me/export', {
    method: 'POST',
    body: {},
    identity: identities.owner,
  });
  assert.equal(exported.radarEvents.find((event) => event.id === eventId).contact_email, 'organisateur@example.test');
  assert.equal(JSON.stringify(exported).includes('contact_email_ciphertext'), false);
  assert.equal((await api('/radar/events', { publicCache: true })).events.length, 0);
  await api(`/me/radar-events/${eventId}`, {
    method: 'PATCH', identity: identities.owner, expected: 422,
    body: { version: patched.event.version, registrationUrl: 'http://example.org/refuse' },
  });

  const published = await api(`/me/radar-events/${eventId}/publish`, {
    method: 'POST',
    identity: identities.owner,
    body: { version: patched.event.version, turnstileToken: token('radar_publish') },
  });
  assert.equal(published.event.state, 'published');

  const publicList = await api('/radar/events?city=Tours&beginner=1&rules=dmr&limit=20', { publicCache: true });
  assert.equal(publicList.events.length, 1);
  assert.equal(publicList.events[0].latitude, 47.394144);
  assert.equal(publicList.events[0].longitude, 0.68484);
  assert.equal(publicList.events[0].toiletsAvailable, false);
  assert.equal('availablePlaces' in publicList.events[0], false);
  assert.equal('availabilityStatus' in publicList.events[0], false);
  assert.equal('exactAddress' in publicList.events[0], false);
  assert.equal('contactEmail' in publicList.events[0], false);
  assert.equal(JSON.stringify(publicList).includes('Adresse privée'), false);
  assert.equal((await api('/radar/events?latitude=48.8566&longitude=2.3522&radiusKm=10', { publicCache: true })).count, 0);
  assert.equal((await api('/radar/events?bbox=0,47,1,48', { publicCache: true })).count, 1);
  const detail = await api(`/radar/events/${published.event.slug}`, { publicCache: true });
  assert.equal(detail.event.organizer.pseudo, 'RadarOwner');
  assert.match(detail.event.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  const geocoded = await api('/me/radar-geocode?q=place%20jean%20jaures%20tours', { identity: identities.owner });
  assert.deepEqual([geocoded.suggestions[0].latitude, geocoded.suggestions[0].longitude], [47.394144, 0.68484]);
  await api('/me/radar-geocode?q=place%20jean%20jaures%20tours', { identity: identities.owner });
  assert.equal(geocodeCalls, 1);
  await api('/me/radar-geocode?q=limite%20ign', { identity: identities.owner, expected: 429 });
  await api('/me/radar-geocode?q=service%20indisponible', { identity: identities.owner, expected: 503 });
  for (let index = 0; index < 116; index += 1) {
    await api('/me/radar-geocode?q=place%20jean%20jaures%20tours', { identity: identities.owner });
  }
  await api('/me/radar-geocode?q=place%20jean%20jaures%20tours', {
    identity: identities.owner,
    expected: 429,
  });

  const approximate = await api(`/me/radar-events/${eventId}`, {
    method: 'PATCH',
    identity: identities.owner,
    body: { version: published.event.version, locationVisibility: 'approximate' },
  });
  const approximatePublic = await api(`/radar/events/${approximate.event.slug}`, { publicCache: true });
  assert.equal(approximatePublic.event.locationVisibility, 'approximate');
  assert.equal(approximatePublic.event.latitude, null);
  assert.equal(approximatePublic.event.longitude, null);

  await api(`/radar/events/${approximate.event.slug}/report`, {
    method: 'POST',
    body: {
      reason: 'wrong_rules',
      message: 'Vérification de recette.',
      website: '',
      turnstileToken: token('radar_report'),
    },
    expected: 202,
  });
  const reports = await api('/admin/radar-reports', { identity: identities.admin });
  assert.equal(reports.reports.length, 1);
  assert.equal(reports.reports[0].event.ownerPseudo, 'RadarOwner');
  assert.match(reports.reports[0].event.history.updatedAt, /^\d{4}-\d{2}-\d{2}/);

  const hidden = await api(`/admin/radar-events/${eventId}/hide`, {
    method: 'POST',
    identity: identities.admin,
    body: { version: approximate.event.version, reason: 'Contrôle de recette administrateur.' },
  });
  assert.equal(hidden.moderationState, 'hidden');
  await api(`/radar/events/${approximate.event.slug}`, { expected: 404 });
  await api(`/admin/radar-events/${eventId}/restore`, {
    method: 'POST',
    identity: identities.admin,
    body: { version: approximate.event.version + 1 },
  });

  const cancelled = await api(`/me/radar-events/${eventId}/cancel`, {
    method: 'POST',
    identity: identities.owner,
    body: { version: approximate.event.version + 2, turnstileToken: token('radar_cancel') },
  });
  assert.equal(cancelled.event.state, 'cancelled');
  assert.equal((await api('/radar/events', { publicCache: true })).count, 0);
  assert.equal((await api(`/radar/events/${cancelled.event.slug}`, { publicCache: true })).event.state, 'cancelled');

  const forcePast = "require 'api/src/autoload.php'; $config=\\Fat\\Api\\Config::load(getcwd()); $db=\\Fat\\Api\\Database::connect($config); $statement=$db->prepare(\"UPDATE radar_events SET state='published',starts_at_utc=UTC_TIMESTAMP()-INTERVAL 2 DAY,ends_at_utc=UTC_TIMESTAMP()-INTERVAL 1 DAY,published_at=COALESCE(published_at,UTC_TIMESTAMP()-INTERVAL 3 DAY),cancelled_at=NULL,expires_at=UTC_TIMESTAMP()-INTERVAL 1 DAY,version=version+1 WHERE id=?\"); $statement->execute([$argv[1]]);";
  command(PHP, ['-r', forcePast, eventId]);
  command(PHP, ['bin/maintenance.php']);
  const expired = await api(`/me/radar-events/${eventId}`, { identity: identities.owner });
  assert.equal(expired.event.state, 'expired');
  await api(`/radar/events/${cancelled.event.slug}`, { expected: 404 });

  const duplicate = await api(`/me/radar-events/${eventId}/duplicate`, {
    method: 'POST', identity: identities.owner, body: {}, expected: 201,
  });
  assert.equal(duplicate.event.state, 'draft');
  await api(`/me/radar-events/${duplicate.event.id}`, {
    method: 'DELETE',
    identity: identities.owner,
    body: { version: duplicate.event.version, turnstileToken: token('radar_delete') },
    expected: 204,
  });
  await api(`/me/radar-events/${duplicate.event.id}`, { identity: identities.owner, expected: 404 });

  console.log('Radar API intégration: CSRF, validation, publication, confidentialité, filtres, IGN/cache/429/503/quota, signalement, modération, annulation, expiration, duplication, suppression et IDOR validés.');
} finally {
  server.kill('SIGTERM');
  helperServer.close();
  await delay(100);
  if (server.exitCode && server.exitCode !== 0) console.error(stderr);
}
