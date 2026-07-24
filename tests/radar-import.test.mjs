import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const php = process.env.FAT_TEST_PHP || 'php';
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

test('le lot Radar est validé strictement sans donnée personnelle', () => {
  const result = spawnSync(php, ['tests/radar-import-unit.php'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    events: 46,
    primary: 15,
    secondary: 31,
    undisclosed: 1,
  });
});

test('la migration ajoute provenance, revendication, visibilité et garde-fous', async () => {
  const migration = await read('database', 'migrations', '006_radar_import_foundation.sql');
  for (const token of [
    'external_key', 'record_visibility', 'admin_preview_only', 'location_precision',
    'geocode_status', 'price_min_cents', 'price_max_cents', 'is_fixture',
    'radar_event_sources', 'source_fingerprint', 'radar_event_claims',
    'requires_pre_publication_check',
  ]) assert.ok(migration.includes(token), token);
  assert.match(migration, /DECIMAL\(9,6\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
  assert.match(migration, /state <> 'published'[\s\S]*record_visibility = 'public'[\s\S]*is_fixture = 0/);
});

test('l’importeur n’accepte que le preview admin et ne peut jamais publier', async () => {
  const importer = await read('bin', 'import-radar-events.php');
  assert.match(importer, /--owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL/);
  assert.match(importer, /\$result\['preview'\] !== 'admin'/);
  assert.match(importer, /'draft','visible','admin_preview_only','unclaimed'/);
  assert.match(importer, /requires_pre_publication_check=1/);
  assert.match(importer, /WHERE external_key=\?/);
  assert.match(importer, /if \(!\$options\['dryRun'\]\)/);
  assert.doesNotMatch(importer, /--publish|auto.?publish/i);
  assert.doesNotMatch(importer, /FAT_RADAR_SEED_OWNER_EMAIL\s*=\s*[^.…'"\s]/);
});

test('le public exclut previews et fixtures tandis que les écritures admin exigent session et CSRF', async () => {
  const [publicController, adminController, application] = await Promise.all([
    read('api', 'src', 'Controllers', 'PublicRadarController.php'),
    read('api', 'src', 'Controllers', 'RadarAdminController.php'),
    read('api', 'src', 'Application.php'),
  ]);
  assert.match(publicController, /record_visibility='public'/);
  assert.match(publicController, /is_fixture=0/);
  assert.doesNotMatch(publicController, /source_url|external_key|contact_email_ciphertext|exact_address\s*=>/);
  for (const method of ['review', 'publish']) {
    assert.match(adminController, new RegExp(`function ${method}[\\s\\S]*?require\\(\\$request, 'admin'\\)[\\s\\S]*?requireCsrf`));
  }
  assert.match(adminController, /confirmation'\] !== 'PUBLIER'/);
  for (const route of [
    '/admin/radar-events',
    '/admin/radar-events/{id}/review',
    '/admin/radar-events/{id}/publish',
  ]) assert.ok(application.includes(`'${route}'`), route);
});

test('les fixtures sont locales, privées, déterministes et refusées en production', async () => {
  const [generator, worker, sitemap] = await Promise.all([
    read('bin', 'generate-radar-fixtures.php'),
    read('service-worker.js'),
    read('sitemap.xml'),
  ]);
  assert.match(generator, /in_array\(\$count, \[1, 10, 50, 200\]/);
  assert.match(generator, /\$config->isProduction\(\)/);
  assert.match(generator, /'draft','visible','private','unclaimed'/);
  assert.match(generator, /is_fixture/);
  assert.match(generator, /DELETE FROM radar_events WHERE is_fixture=1/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)[\s\S]*fetch\(event\.request\)/);
  assert.doesNotMatch(sitemap, /fixture-radar|admin_preview_only|compte\/mes-parties/);
});
