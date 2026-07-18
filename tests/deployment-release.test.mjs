import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('GitHub teste main et ne déploie que via l’environnement production', async () => {
  const workflow = await read('.github/workflows/production.yml');
  assert.match(workflow, /pull_request:[\s\S]*branches: \[main\]/);
  assert.match(workflow, /push:[\s\S]*branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: production-release/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /vars\.DEPLOY_LIVE_ENABLED == 'true'/);
  for (const secret of ['DEPLOY_HOST', 'DEPLOY_PORT', 'DEPLOY_USER', 'DEPLOY_SSH_KEY', 'DEPLOY_HOST_KEY', 'DEPLOY_PATH']) {
    assert.ok(workflow.includes(`secrets.${secret}`), secret);
  }
  assert.doesNotMatch(workflow, /StrictHostKeyChecking=no|ssh-keyscan|rsync\s+[^\n]*--delete/);
});

test('l’archive exclut données privées et lie le cache PWA au SHA', async () => {
  const [attributes, workflow, verifier] = await Promise.all([
    read('.gitattributes'), read('.github/workflows/production.yml'), read('bin/verify-release-archive.sh'),
  ]);
  for (const path of ['/.github', '/config', '/docs', '/tests', '/storage']) {
    assert.match(attributes, new RegExp(`${path.replace('/', '\\/')} export-ignore`));
  }
  assert.match(workflow, /git archive HEAD/);
  assert.match(workflow, /fat-v3-\$\{process\.env\.GITHUB_SHA\}/);
  assert.match(workflow, /verify-release-archive\.sh/);
  for (const excluded of ['\\.git', '\\.github', 'docs', 'tests', 'node_modules', 'config', 'storage']) {
    assert.ok(verifier.includes(excluded), excluded);
  }
  assert.match(verifier, /\.env/);
});

test('le déploiement sauvegarde, migre, active atomiquement et restaure sur échec', async () => {
  const [deploy, rollback] = await Promise.all([
    read('bin/deploy-release.sh'), read('bin/rollback-release.sh'),
  ]);
  assert.match(deploy, /flock -n/);
  assert.match(deploy, /mariadb-dump|mysqldump/);
  assert.match(deploy, /single-transaction/);
  assert.match(deploy, /FAT_CONFIG_FILE=.*bin\/migrate\.php/);
  assert.match(deploy, /mv -Tf/);
  assert.match(deploy, /api\/v1\/health/);
  assert.match(deploy, /Health check en échec, release précédente restaurée/);
  assert.match(deploy, /initial-dry-run\.ok/);
  assert.match(deploy, /keep_releases/);
  assert.match(rollback, /Release de rollback absente/);
  assert.match(rollback, /mv -Tf/);
  assert.match(rollback, /release initiale restaurée/);
});

test('security.txt fournit un contact, une expiration, une canonique et une politique', async () => {
  const security = await read('.well-known/security.txt');
  assert.match(security, /^Contact: mailto:contact@fps-airsoft-trajectory\.com$/m);
  assert.match(security, /^Expires: 2027-07-18T00:00:00Z$/m);
  assert.match(security, /^Canonical: https:\/\/fps-airsoft-trajectory\.com\/\.well-known\/security\.txt$/m);
  assert.match(security, /^Policy: https:\/\/fps-airsoft-trajectory\.com\/mentions-legales\/#signalement$/m);
});

test('les tests API restent portables entre Windows local et Linux CI', async () => {
  const api = await read('tests/api.integration.mjs');
  assert.match(api, /process\.platform === 'win32'/);
  assert.match(api, /FAT_TEST_DB_DSN/);
  assert.match(api, /FAT_TEST_SKIP_DB_RESET/);
  assert.match(api, /join\(ROOT, 'storage', 'logs', 'mail-test\.jsonl'\)/);
});
