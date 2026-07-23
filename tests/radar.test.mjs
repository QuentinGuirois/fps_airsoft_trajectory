import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deepSlugFromPath,
  eventMatchesFilters,
  haversineKm,
  isWgs84,
  toLeafletLatLng,
} from '../assets/js/radar/radar-map.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

const tours = {
  title: 'Tours',
  startsAt: '2026-08-01T07:00:00Z',
  beginnersWelcome: true,
  rentalDetails: 'AEG',
  latitude: 47.394144,
  longitude: 0.68484,
  city: 'Tours',
  departmentCode: '37',
  department: 'Indre-et-Loire',
  region: 'Centre-Val de Loire',
  rules: [{ type: 'cqb', state: 'allowed' }],
};

test('les helpers WGS84 conservent explicitement l’ordre latitude puis longitude', () => {
  assert.equal(isWgs84(tours.latitude, tours.longitude), true);
  assert.deepEqual(toLeafletLatLng(tours), [47.394144, 0.68484]);
  assert.deepEqual(toLeafletLatLng({ latitude: 44.837789, longitude: -0.57918 }), [44.837789, -0.57918]);
  assert.deepEqual(toLeafletLatLng({ latitude: 48.573405, longitude: 7.752111 }), [48.573405, 7.752111]);
  assert.equal(toLeafletLatLng({ latitude: 200, longitude: 0 }), null);
  assert.ok(haversineKm(47.394144, 0.68484, 44.837789, -0.57918) > 290);
  assert.ok(haversineKm(47.394144, 0.68484, 44.837789, -0.57918) < 310);
});

test('les filtres date, lieu, débutants, location, règles et rayon se combinent', () => {
  assert.equal(eventMatchesFilters(tours, {
    location: 'indre et loire',
    from: '2026-07-31',
    to: '2026-08-02',
    beginner: true,
    rental: true,
    rules: new Set(['cqb']),
  }), true);
  assert.equal(eventMatchesFilters(tours, { location: 'Bordeaux' }), false);
  assert.equal(eventMatchesFilters(tours, { rules: new Set(['sniper']) }), false);
  assert.equal(eventMatchesFilters(tours, {
    position: { latitude: 48.8566, longitude: 2.3522 },
    radiusKm: 10,
  }), false);
});

test('les URL profondes Radar acceptent seulement un slug borné', () => {
  assert.equal(deepSlugFromPath('/parties-airsoft/operation-tours-1234/'), 'operation-tours-1234');
  assert.equal(deepSlugFromPath('/parties-airsoft/'), '');
  assert.equal(deepSlugFromPath('/parties-airsoft/<script>/'), '');
});

test('la page publique est indexable, éditoriale et autonome sans CDN', async () => {
  const html = await read('parties-airsoft', 'index.html');
  assert.match(html, /F\.A\.T\. \/\/ RADAR DES PARTIES/);
  assert.match(html, /<h1>Parties d’airsoft en France : trouvez votre prochaine partie<\/h1>/);
  assert.match(html, /rel="canonical" href="https:\/\/fps-airsoft-trajectory\.com\/parties-airsoft\/"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /leaflet-1\.9\.4\/leaflet\.js/);
  assert.match(html, /leaflet\.markercluster-1\.5\.3\/leaflet\.markercluster\.js/);
  for (const control of ['today', 'saturday', 'sunday', 'weekend', 'detonating_grenades', 'co2_grenades']) {
    assert.ok(html.includes(control), control);
  }
  assert.match(html, /UTILISER MA POSITION/);
  assert.doesNotMatch(html, /unpkg|jsdelivr|cdnjs|support\.js|DC-[A-Z0-9]/i);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
});

test('la carte administrative locale contient les 96 départements métropolitains et la Corse', async () => {
  const path = join(root, 'data', 'radar-france-departments.geojson');
  const geojson = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(geojson.type, 'FeatureCollection');
  assert.equal(geojson.features.length, 96);
  const serialized = JSON.stringify(geojson);
  assert.match(serialized, /2A/);
  assert.match(serialized, /2B/);
  assert.ok((await stat(path)).size < 150_000);
});

test('le public ne reçoit jamais adresse exacte, email chiffré ou faux point approximatif', async () => {
  const controller = await read('api', 'src', 'Controllers', 'PublicRadarController.php');
  assert.match(controller, /\$exact = \$row\['location_visibility'\] === 'exact'/);
  assert.match(controller, /'latitude' => \$exact/);
  assert.match(controller, /'longitude' => \$exact/);
  assert.match(controller, /'updatedAt' => \$this->atom\(\$row\['updated_at'\]\)/);
  assert.match(controller, /'toiletsAvailable' =>/);
  assert.doesNotMatch(controller, /exact_address\s*=>|contact_email_ciphertext\s*=>/);
  assert.doesNotMatch(controller, /availablePlaces|availabilityStatus/);
  assert.match(controller, /state='published'.*moderation_state='visible'.*ends_at_utc>UTC_TIMESTAMP\(\)/s);
});

test('le schéma et les routes couvrent cycle de vie, règles, signalement et modération', async () => {
  const [migration, app, maintenance] = await Promise.all([
    read('database', 'migrations', '005_radar.sql'),
    read('api', 'src', 'Application.php'),
    read('bin', 'maintenance.php'),
  ]);
  for (const table of ['radar_events', 'radar_event_rules', 'radar_event_links', 'radar_event_reports', 'radar_geocoding_cache']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const route of [
    '/radar/events', '/radar/events/{slug}', '/me/radar-events',
    '/me/radar-events/{id}/publish', '/me/radar-events/{id}/cancel',
    '/me/radar-events/{id}/duplicate', '/me/radar-geocode',
    '/admin/radar-reports', '/admin/radar-events/{id}/hide',
  ]) assert.ok(app.includes(`'${route}'`), route);
  assert.match(maintenance, /state='expired'/);
});

test('le cache PWA inclut seulement le Radar public et contourne compte et API', async () => {
  const worker = await read('service-worker.js');
  assert.match(worker, /fat-v3-2026-07-23-47/);
  for (const asset of [
    '/parties-airsoft/',
    '/assets/radar.css?v=20260723-47',
    '/assets/js/radar/radar-map.js?v=20260723-47',
    '/data/radar-france-departments.geojson',
  ]) assert.ok(worker.includes(`'${asset}'`), asset);
  const optional = worker.match(/const OPTIONAL = \[([\s\S]*?)\n\];/)?.[1] || '';
  assert.doesNotMatch(optional, /\/compte\//);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/compte\/'\)/);
});

test('l’espace organisateur matérialise les cinq étapes et aucune donnée démo runtime', async () => {
  const [html, owner, seed] = await Promise.all([
    read('compte', 'mes-parties.html'),
    read('assets', 'js', 'radar', 'my-radar-events.js'),
    read('bin', 'seed-radar-local.php'),
  ]);
  assert.equal((html.match(/data-step-indicator="/g) || []).length, 5);
  assert.doesNotMatch(html, /data-theme-slot/);
  assert.doesNotMatch(html, /MODE NUIT|MODE JOUR|DISPONIBILITÉ|PLACES DISPONIBLES/);
  assert.match(html, /name="toiletsAvailable" required/);
  assert.match(html, /NOMBRE MAXIMAL DE JOUEURS/);
  assert.match(html, /data-autosave-status/);
  assert.match(html, /RECHERCHER AVEC L’IGN/);
  assert.match(owner, /scheduleSave/);
  assert.match(owner, /locationConfirmed/);
  assert.match(seed, /APP_ENV=local|isProduction/);
  assert.doesNotMatch(`${html}\n${owner}`, /Opération recette|Tours API|example\.test/);
});
