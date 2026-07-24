import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deepSlugFromPath,
  eventMatchesFilters,
  haversineKm,
  isWgs84,
  RADAR_CITIES,
  RADAR_LAUNCH_NOTICE_KEY,
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
  assert.equal(eventMatchesFilters({
    ...tours,
    rules: [{ type: 'cqb', state: 'not_communicated' }],
  }, { rules: new Set(['cqb']) }), false);
  assert.equal(eventMatchesFilters({
    ...tours,
    rules: [{ type: 'cqb', state: 'forbidden' }],
  }, { rules: new Set(['cqb']) }), false);
  assert.equal(eventMatchesFilters(tours, {
    position: { latitude: 48.8566, longitude: 2.3522 },
    radiusKm: 10,
  }), false);
});

test('les limites de rayon 10, 25, 50 et 100 km distinguent un point dedans et dehors', () => {
  const origin = { latitude: 46.6, longitude: 2.4 };
  const latitudeAtDistance = (distanceKm) => origin.latitude + distanceKm / 6371.0088 * 180 / Math.PI;
  for (const radiusKm of [10, 25, 50, 100]) {
    const inside = { ...tours, latitude: latitudeAtDistance(radiusKm - 0.01), longitude: origin.longitude };
    const outside = { ...tours, latitude: latitudeAtDistance(radiusKm + 0.01), longitude: origin.longitude };
    const filters = { position: origin, radiusKm };
    assert.equal(eventMatchesFilters(inside, filters), true, `${radiusKm} km intérieur`);
    assert.equal(eventMatchesFilters(outside, filters), false, `${radiusKm} km extérieur`);
    assert.ok(haversineKm(origin.latitude, origin.longitude, inside.latitude, inside.longitude) < radiusKm);
    assert.ok(haversineKm(origin.latitude, origin.longitude, outside.latitude, outside.longitude) > radiusKm);
  }
});

test('les onze grandes villes restent un calque décoratif séparé jusqu’au zoom 7', async () => {
  const [map, css] = await Promise.all([
    read('assets', 'js', 'radar', 'radar-map.js'),
    read('assets', 'radar.css'),
  ]);
  assert.equal(RADAR_CITIES.length, 11);
  assert.deepEqual(RADAR_CITIES.find(([name]) => name === 'PARIS'), ['PARIS', 48.8566, 2.3522]);
  assert.match(map, /map\.getZoom\(\) <= 7/);
  assert.match(map, /interactive:\s*false/);
  assert.match(map, /keyboard:\s*false/);
  assert.match(map, /aria-hidden/);
  assert.match(css, /\.radar-cities-pane\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.radar-city-marker\s*\{[^}]*pointer-events:\s*none/s);
});

test('la popup de lancement est versionnée, accessible et réservée à la racine du Radar', async () => {
  const [html, map] = await Promise.all([
    read('parties-airsoft', 'index.html'),
    read('assets', 'js', 'radar', 'radar-map.js'),
  ]);
  assert.equal(RADAR_LAUNCH_NOTICE_KEY, 'fat.radar.launch-notice.v1');
  assert.match(html, /RADAR EN DÉPLOIEMENT/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /ME CONNECTER \/ CRÉER MON COMPTE/);
  assert.match(html, /data-radar-launch-close>VOIR LA CARTE/);
  assert.match(map, /windowRef\.location\.pathname !== '\/parties-airsoft\/'/);
  assert.match(map, /event\.key !== 'Tab'/);
  assert.match(map, /addEventListener\('cancel'/);
});

test('la politique serveur des liens accepte les plateformes officielles et refuse les motifs défensifs', () => {
  const php = process.env.FAT_TEST_PHP || (process.platform === 'win32' ? 'C:\\tools\\php\\php.exe' : 'php');
  const result = spawnSync(php, ['tests/radar-link-safety-unit.php'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /cas sûrs et dangereux validés/);
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

test('le public ne reçoit jamais adresse exacte, email chiffré, brouillon ou fixture', async () => {
  const controller = await read('api', 'src', 'Controllers', 'PublicRadarController.php');
  assert.match(controller, /\$hasPublicPin = \(/);
  assert.match(controller, /\$row\['location_precision'\] === 'city'/);
  assert.match(controller, /\$row\['location_precision'\] !== 'undisclosed'/);
  assert.match(controller, /'latitude' => \$hasPublicPin/);
  assert.match(controller, /'longitude' => \$hasPublicPin/);
  assert.match(controller, /"r\.record_visibility='public'"/);
  assert.match(controller, /r\.is_fixture=0/);
  assert.match(controller, /'updatedAt' => \$this->atom\(\$row\['updated_at'\]\)/);
  assert.match(controller, /'toiletsAvailable' =>/);
  assert.doesNotMatch(controller, /exact_address\s*=>|contact_email_ciphertext\s*=>/);
  assert.doesNotMatch(controller, /availablePlaces|availabilityStatus/);
  assert.match(controller, /state='published'.*record_visibility='public'.*is_fixture=0.*moderation_state='visible'.*ends_at_utc>UTC_TIMESTAMP\(\)/s);
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
  assert.match(worker, /fat-v3-2026-07-24-50/);
  for (const asset of [
    '/parties-airsoft/',
    '/assets/radar.css?v=20260724-50',
    '/assets/js/radar/radar-map.js?v=20260724-50',
    '/data/radar-france-departments.geojson',
  ]) assert.ok(worker.includes(`'${asset}'`), asset);
  const optional = worker.match(/const OPTIONAL = \[([\s\S]*?)\n\];/)?.[1] || '';
  assert.doesNotMatch(optional, /\/compte\//);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/compte\/'\)/);
});

test('les pointeurs exacts et approximatifs utilisent le vert acide sans pointillés', async () => {
  const [css, map] = await Promise.all([
    read('assets', 'radar.css'),
    read('assets', 'js', 'radar', 'radar-map.js'),
  ]);
  assert.match(css, /\.radar-marker-shell\.is-approximate \.radar-pin\s*\{[^}]*background:\s*var\(--acid\)/s);
  assert.doesNotMatch(css, /\.radar-marker-shell\.is-approximate \.radar-pin\s*\{[^}]*border[^}]*dashed/s);
  assert.match(css, /\.radar-legend i\[data-tone="approximate"\]\s*\{[^}]*background:\s*var\(--acid\)/s);
  assert.doesNotMatch(css, /\.radar-legend i\[data-tone="approximate"\]\s*\{[^}]*dashed/s);
  assert.doesNotMatch(css, /\bdashed\b|\bdotted\b/);
  assert.match(map, /AUTORISÉ/);
  assert.match(map, /SPÉCIFIQUE — VOIR DÉTAIL/);
  assert.match(map, /PREUVE OFFICIELLE ↗/);
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
