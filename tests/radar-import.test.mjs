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
    events: 40,
    rules: 280,
    known: 3,
    dateOnly: 22,
  });
});

test('la migration ajoute provenance, revendication, visibilité et garde-fous', async () => {
  const [foundation, evidence] = await Promise.all([
    read('database', 'migrations', '006_radar_import_foundation.sql'),
    read('database', 'migrations', '007_radar_rule_evidence.sql'),
  ]);
  for (const token of [
    'external_key', 'record_visibility', 'admin_preview_only', 'location_precision',
    'geocode_status', 'price_min_cents', 'price_max_cents', 'is_fixture',
    'radar_event_sources', 'source_fingerprint', 'radar_event_claims',
    'requires_pre_publication_check',
  ]) assert.ok(foundation.includes(token), token);
  assert.match(foundation, /DECIMAL\(9,6\)/);
  assert.match(foundation, /ADD COLUMN IF NOT EXISTS/);
  assert.match(foundation, /state <> 'published'[\s\S]*record_visibility = 'public'[\s\S]*is_fixture = 0/);
  for (const token of [
    'evidence_url', 'evidence_locator', 'evidence_excerpt', 'evidence_scope',
    'evidence_checked_at', "'organizer'", "'registration'",
  ]) assert.ok(evidence.includes(token), token);
  assert.match(evidence, /not_communicated[\s\S]*joules IS NULL[\s\S]*details='NC'/);
});

test('l’importeur synchronise en preview et la publication production reste figée et contrôlée', async () => {
  const [importer, productionPublisher, databaseAccess, commandAccess] = await Promise.all([
    read('bin', 'import-radar-events.php'),
    read('bin', 'publish-radar-import-production.php'),
    read('database', '.htaccess'),
    read('bin', '.htaccess'),
  ]);
  assert.match(importer, /--owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL/);
  assert.match(importer, /\$result\['preview'\] !== 'admin'/);
  assert.match(importer, /'draft','visible','admin_preview_only','unclaimed'/);
  assert.match(importer, /requires_pre_publication_check=1/);
  assert.match(importer, /WHERE external_key=\?/);
  assert.match(importer, /if \(!\$options\['dryRun'\]\)/);
  assert.match(importer, /evidence_url/);
  assert.match(importer, /link_type IN \('organizer','registration'\)/);
  assert.match(importer, /VALUES \(\?,\?,\?,\?,\?\)/);
  assert.doesNotMatch(importer, /--publish|auto.?publish/i);
  assert.doesNotMatch(importer, /FAT_RADAR_SEED_OWNER_EMAIL\s*=\s*[^.…'"\s]/);
  assert.match(productionPublisher, /RADAR_PRODUCTION_SEED_SHA256/);
  assert.match(productionPublisher, /--preflight/);
  assert.match(productionPublisher, /--apply/);
  assert.match(productionPublisher, /APP_ENV=production|isProduction\(\)/);
  assert.match(productionPublisher, /doublon interne/);
  assert.match(productionPublisher, /doublon en base/);
  assert.match(productionPublisher, /postalCode.*city/s);
  assert.match(productionPublisher, /sourceUrl.*https:\/\//s);
  assert.match(productionPublisher, /geocode_status.*validated/s);
  assert.match(productionPublisher, /state='published',record_visibility='public'/);
  assert.match(productionPublisher, /beginTransaction\(\)/);
  assert.doesNotMatch(productionPublisher, /DELETE FROM radar_events/);
  assert.match(databaseAccess, /^Require all denied\s*$/);
  assert.match(commandAccess, /^Require all denied\s*$/);
});

test('l’enrichisseur reste officiel, mis en cache et sans contournement anti-bot', async () => {
  const [enricher, publisher, report] = await Promise.all([
    read('bin', 'enrich-radar-events.php'),
    read('bin', 'publish-radar-import-local.php'),
    read('docs', 'fat-radar', 'fat-radar-events-enriched-2026-07-24.report.md'),
  ]);
  assert.match(enricher, /--offline-cache=/);
  assert.match(enricher, /User-Agent: F\.A\.T\.-Radar/);
  assert.match(enricher, /count\(\$explicitJoules\) === 1/);
  assert.match(enricher, /Aucun contournement ni déduction/);
  assert.match(publisher, /APP_ENV/);
  assert.match(publisher, /DELETE FROM radar_events/);
  assert.match(report, /Sources officielles contrôlées/);
  assert.match(report, /\| 404 \|/);
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
