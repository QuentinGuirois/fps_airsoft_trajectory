import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const php = process.env.FAT_TEST_PHP || (process.platform === 'win32' ? 'C:\\tools\\php\\php.exe' : 'php');
const ownerEnvironment = 'FAT_RADAR_SEED_OWNER_EMAIL';
const seed = 'docs/fat-radar/fat-radar-events-seed-2026-07-24.json';
const databaseEnvironment = process.env.FAT_TEST_CONFIG_FILE
  ? { FAT_CONFIG_FILE: process.env.FAT_TEST_CONFIG_FILE }
  : {
      DB_DSN: process.env.FAT_TEST_DB_DSN || 'mysql:host=127.0.0.1;port=3308;dbname=fat_test;charset=utf8mb4',
      DB_USER: process.env.FAT_TEST_DB_USER || 'fat_test',
      DB_PASSWORD: process.env.FAT_TEST_DB_PASSWORD || 'fat_local_test_only',
    };
const env = {
  ...process.env,
  ...databaseEnvironment,
  APP_ENV: 'local',
  APP_ORIGIN: 'http://127.0.0.1:8094',
  APP_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  STORAGE_ROOT: 'storage',
  TRUSTED_HOST: '127.0.0.1:8094',
  TURNSTILE_ENABLED: 'false',
  FAT_RADAR_SEED_OWNER_EMAIL: 'admin@local.test',
};

function run(args, { expected = 0, extraEnv = {} } = {}) {
  const result = spawnSync(php, args, {
    cwd: root,
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
  });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result;
}

function scalar(sql) {
  const script = [
    'require "api/src/autoload.php";',
    '$config=Fat\\Api\\Config::load(getcwd());',
    '$db=Fat\\Api\\Database::connect($config);',
    `$value=$db->query(${JSON.stringify(sql)})->fetchColumn();`,
    'echo (string)$value;',
  ].join('');
  return Number(run(['-r', script]).stdout);
}

run(['bin/reset-local-database.php', '--yes']);
run(['bin/create-local-test-admin.php']);
assert.equal(scalar('SELECT COUNT(*) FROM radar_events'), 0);

const baseArguments = [
  'bin/import-radar-events.php',
  seed,
  `--owner-email-env=${ownerEnvironment}`,
  '--preview=admin',
];
const dryRun = run([...baseArguments, '--dry-run']);
assert.match(dryRun.stdout, /"created":46/);
assert.equal(scalar('SELECT COUNT(*) FROM radar_events'), 0);
assert.equal(scalar('SELECT COUNT(*) FROM radar_geocoding_cache'), 0);

const first = run(baseArguments);
assert.match(first.stdout, /"created":46/);
assert.equal(scalar("SELECT COUNT(*) FROM radar_events WHERE state='draft' AND record_visibility='admin_preview_only' AND requires_pre_publication_check=1 AND is_fixture=0"), 46);
assert.equal(scalar('SELECT COUNT(DISTINCT external_key) FROM radar_events'), 46);
assert.equal(scalar('SELECT COUNT(*) FROM radar_event_sources'), 46);
assert.equal(scalar("SELECT COUNT(*) FROM radar_events WHERE state='published'"), 0);

const second = run(baseArguments);
assert.match(second.stdout, /"updated":46/);
assert.equal(scalar('SELECT COUNT(*) FROM radar_events'), 46);
assert.equal(scalar('SELECT COUNT(*) FROM radar_event_sources'), 46);

const protectReviewed = [
  'require "api/src/autoload.php";',
  '$config=Fat\\Api\\Config::load(getcwd());',
  '$db=Fat\\Api\\Database::connect($config);',
  '$db->exec("UPDATE radar_events SET requires_pre_publication_check=0 WHERE external_key=\'primary-ftf-2026-07-25\'");',
].join('');
run(['-r', protectReviewed]);
const protectedRun = run(baseArguments);
assert.match(protectedRun.stdout, /primary-ftf-2026-07-25 : ignoré/);
assert.equal(scalar("SELECT requires_pre_publication_check FROM radar_events WHERE external_key='primary-ftf-2026-07-25'"), 0);

const missingOwner = run(baseArguments, { expected: 3, extraEnv: { FAT_RADAR_SEED_OWNER_EMAIL: '' } });
assert.doesNotMatch(missingOwner.stderr, /@/);

for (const count of [1, 10, 50, 200]) {
  run(['bin/generate-radar-fixtures.php', `--count=${count}`, '--replace']);
  assert.equal(scalar('SELECT COUNT(*) FROM radar_events WHERE is_fixture=1'), count);
  assert.equal(scalar("SELECT COUNT(*) FROM radar_events WHERE is_fixture=1 AND (state<>'draft' OR record_visibility<>'private')"), 0);
}
assert.equal(scalar("SELECT COUNT(*) FROM radar_events WHERE state='published' AND record_visibility='public' AND is_fixture=0"), 0);

console.log('Radar import intégration : migration fraîche, dry-run, 46 brouillons, idempotence, protection après revue, propriétaire obligatoire et fixtures 1/10/50/200 validés.');
